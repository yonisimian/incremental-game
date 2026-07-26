/**
 * Balance gate — the CI/pre-push check that keeps the authored strategy corpus
 * inside each mode's target envelope.
 *
 * For every envelope in the shared registry it loads that mode's authored
 * strategies (`shared/strategies/<mode>/*.json`), runs them through the shared
 * `simulate()` at the envelope's goal, and validates the result. It prints a
 * per-strategy summary plus a copy-pasteable "suggested bands" table (P10/P90 of
 * the observed scores) to make re-baselining cheap, and exits non-zero if any
 * envelope fails `minViableStrategies` or the spread limit.
 *
 * The Node-only strategy loader lives here (not in `shared/src`, which ships to
 * the browser) per docs/plans/24-envelope-integration.md (D5). The script reuses
 * the exact `simulate()` + projection + validators the dev panel uses, so the CI
 * verdict and the dev-panel verdict can never diverge.
 *
 * Usage:
 *   tsx scripts/check-balance.ts            # validate; exit non-zero on failure
 *   tsx scripts/check-balance.ts --suggest  # also print suggested bands, never fail
 *   tsx scripts/check-balance.ts --analyze  # also print coverage findings (non-gating)
 */

import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

import {
  allEnvelopes,
  analyzeCoverage,
  analyzeDominance,
  analyzePacing,
  AVAILABLE_MODES,
  firstTimeAtScore,
  getModeDefinition,
  isPacingEnvelope,
  loadBalance,
  loadTree,
  parseStrategy,
  simResultsToScores,
  simulate,
  validateEnvelope,
  validatePacing,
  type BalanceEnvelope,
  type GameMode,
  type PacingCheckpoint,
  type PacingEnvelope,
  type QueueStrategy,
  type SimGoal,
  type SimResult,
  type TargetEnvelope,
} from '@game/shared'

const ROOT = dirname(fileURLToPath(import.meta.url))
const STRATEGY_ROOT = join(ROOT, '..', 'shared', 'strategies')

const SUGGEST = process.argv.includes('--suggest')
const ANALYZE = process.argv.includes('--analyze')

// Register every mode's tree, then its balance sidecar, before simulating. The
// tree loads the mode (gameplay data); the sidecar registers its envelopes
// (dev/CI metadata) — envelopes are validated against the loaded mode's goals.
const require = createRequire(import.meta.url)
for (const mode of AVAILABLE_MODES) {
  loadTree(JSON.parse(readFileSync(require.resolve(`@game/shared/trees/${mode}.json`), 'utf8')))
  loadBalance(
    JSON.parse(readFileSync(require.resolve(`@game/shared/balance/${mode}.json`), 'utf8')),
  )
}

/** Load and parse every authored strategy JSON for a mode. */
function loadStrategies(mode: string): QueueStrategy[] {
  const dir = join(STRATEGY_ROOT, mode)
  let files: string[]
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.json'))
  } catch {
    return []
  }
  return files.sort().map((f) => parseStrategy(JSON.parse(readFileSync(join(dir, f), 'utf8'))))
}

/** The simulation goal an envelope's strategies should be run at. */
function goalForEnvelope(envelope: BalanceEnvelope): SimGoal {
  if (isPacingEnvelope(envelope)) {
    if (envelope.goalType === 'buy-upgrade') return { kind: 'race_to_buy' }
    // target-score: run until the final (largest) score milestone.
    const target = Math.max(...envelope.checkpoints.map((cp) => cp.atScore ?? 0))
    return { kind: 'score', target }
  }
  const last = envelope.checkpoints[envelope.checkpoints.length - 1]
  return { kind: 'timed', durationSec: last.timeSec }
}

/** Elapsed time to a pacing milestone (mirrors `validatePacing`'s internal rule). */
function pacingTime(result: SimResult, cp: PacingCheckpoint): number | null {
  if (cp.atScore !== undefined) return firstTimeAtScore(result, cp.atScore)
  return result.goalReached ? (result.snapshots.at(-1)?.timeSec ?? null) : null
}

/** Linear-interpolated percentile (0–100) of an unsorted numeric sample. */
function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  if (sorted.length === 1) return sorted[0]
  const rank = (p / 100) * (sorted.length - 1)
  const lo = Math.floor(rank)
  const hi = Math.ceil(rank)
  const frac = rank - lo
  return sorted[lo] + (sorted[hi] - sorted[lo]) * frac
}

function fmt(n: number): string {
  return n >= 100 ? Math.round(n).toString() : n.toFixed(1)
}

/**
 * Print the non-gating coverage findings (Phase 8a): which mechanics no viable
 * build uses (dead candidates) and which every viable build uses (mandatory).
 */
function printCoverage(mode: GameMode, results: SimResult[], viableNames: Set<string>): void {
  const report = analyzeCoverage(getModeDefinition(mode), results, viableNames)
  const dead = report.mechanics.filter((m) => m.finding === 'dead')
  const mandatory = report.mechanics.filter((m) => m.finding === 'mandatory')
  console.info(`  ── coverage (${report.viableCount} viable build(s), non-gating) ──`)
  if (dead.length === 0 && mandatory.length === 0) {
    console.info('     every mechanic is used by some-but-not-all viable builds')
    return
  }
  for (const m of dead) {
    console.info(`     dead       ${m.kind.padEnd(9)} ${m.id}  (0 viable builds use it)`)
  }
  for (const m of mandatory) {
    console.info(
      `     mandatory  ${m.kind.padEnd(9)} ${m.id}  (all ${report.viableCount} viable builds use it)`,
    )
  }
}

/** Print cost-normalized dominance findings (overpowered mechanics; non-gating). */
function printDominance(
  mode: GameMode,
  strategies: QueueStrategy[],
  results: SimResult[],
  viableNames: Set<string>,
  goal: SimGoal,
): void {
  const modeDef = getModeDefinition(mode)
  const report = analyzeDominance(modeDef, strategies, results, viableNames, (s, m) =>
    simulate(s, { modeDef: m, goal }),
  )
  const overpowered = report.rows.filter((r) => r.finding === 'overpowered')
  console.info(
    `  ── dominance (median ROI ${fmt(report.medianRoi)}, flag ≥${report.roiMultiple}×, non-gating) ──`,
  )
  if (overpowered.length === 0) {
    console.info('     no mechanic dominates its price')
    return
  }
  for (const r of overpowered) {
    const roi = r.roi === Infinity ? 'free' : `ROI ${fmt(r.roi)}`
    const share = `${(r.share * 100).toFixed(0)}% of contribution`
    console.info(`     overpowered ${r.kind.padEnd(9)} ${r.id}  (${roi}, ${share})`)
  }
}

/** Print per-build engagement stats (decisions / first action / idle; non-gating). */
function printPacing(results: SimResult[], viableNames: Set<string>): void {
  const report = analyzePacing(results, viableNames)
  if (report.rows.length === 0) return
  console.info('  ── pacing (per viable build, non-gating) ──')
  for (const r of report.rows) {
    const ttfa = r.timeToFirstActionSec === null ? 'never' : `${fmt(r.timeToFirstActionSec)}s`
    const idle = `${(r.idleFraction * 100).toFixed(0)}% idle`
    console.info(
      `     ${r.name.padEnd(34)} ${String(r.decisions).padStart(3)} decisions   1st @ ${ttfa.padStart(6)}   ${idle}`,
    )
  }
}

/** Print the observed P10/P90 spread per checkpoint as a suggested-bands block. */
function printSuggestion(envelope: TargetEnvelope, results: SimResult[]): void {
  const scores = simResultsToScores(results, envelope)
  console.info('\n  Suggested bands (P10 / P90 of observed scores — a starting point, not gospel):')
  envelope.checkpoints.forEach((cp, i) => {
    const at = scores.map((s) => s.scoresAtCheckpoints[i])
    const p10 = percentile(at, 10)
    const p90 = percentile(at, 90)
    console.info(
      `    { timeSec: ${cp.timeSec}, minScore: ${fmt(p10)}, maxScore: ${fmt(p90)}, phase: '${cp.phase}' },` +
        `  // now [${cp.minScore}, ${cp.maxScore}]`,
    )
  })
}

/** Print the observed P10/P90 spread per milestone as a suggested-time-bands block. */
function printPacingSuggestion(envelope: PacingEnvelope, results: SimResult[]): void {
  console.info('\n  Suggested time bands (P10 / P90 of observed times — a starting point):')
  for (const cp of envelope.checkpoints) {
    const times = results.map((r) => pacingTime(r, cp)).filter((t): t is number => t !== null)
    const p10 = percentile(times, 10)
    const p90 = percentile(times, 90)
    const at = cp.atScore !== undefined ? `atScore: ${cp.atScore}, ` : ''
    console.info(
      `    { ${at}minTimeSec: ${fmt(p10)}, maxTimeSec: ${fmt(p90)}, phase: '${cp.phase}' },` +
        `  // now [${cp.minTimeSec}, ${cp.maxTimeSec}]`,
    )
  }
}

/** Validate one timed envelope; returns true on pass. */
function checkTimed(envelope: TargetEnvelope): boolean {
  const strategies = loadStrategies(envelope.mode)
  const label = `${envelope.mode}:${envelope.goalType}`

  if (strategies.length === 0) {
    console.error(`✗ ${label}: no strategies found under shared/strategies/${envelope.mode}/`)
    return false
  }

  const goal = goalForEnvelope(envelope)
  const results = strategies.map((s) => simulate(s, { goal }))
  // D1: perfect-timing only — pass the same projection as both variants.
  const scores = simResultsToScores(results, envelope)
  const report = validateEnvelope(envelope, scores, scores)
  const byName = new Map(results.map((r) => [r.name, r]))

  console.info(`\n${report.pass ? '✓' : '✗'} ${label}  (perfect-timing only)`)
  console.info(
    `  viable: ${report.viableCount}/${strategies.length} (need ${envelope.minViableStrategies})` +
      `   spread: ${report.spreadRatio === null ? 'n/a' : `${report.spreadRatio.toFixed(3)} (max ${envelope.maxStrategySpread})`}`,
  )
  for (const s of report.strategies) {
    const mark = s.viable ? 'viable ' : '       '
    const r = byName.get(s.name)
    const stalled = r ? r.notReached.length : 0
    const stalledNote = stalled > 0 ? `  (${stalled} action(s) never fired)` : ''
    console.info(`    ${mark} ${fmt(s.perfectScore).padStart(8)}  ${s.name}${stalledNote}`)
  }
  if (report.exploitWarnings.length > 0) {
    console.info(`  ⚠ exploit candidates (exceed maxScore): ${report.exploitWarnings.join(', ')}`)
  }

  if (ANALYZE) {
    const viableNames = new Set(report.strategies.filter((s) => s.viable).map((s) => s.name))
    printCoverage(envelope.mode, results, viableNames)
    printDominance(envelope.mode, strategies, results, viableNames, goal)
    printPacing(results, viableNames)
  }

  if (SUGGEST) printSuggestion(envelope, results)

  return report.pass
}

/** Validate one pacing (score / race) envelope; returns true on pass. */
function checkPacing(envelope: PacingEnvelope): boolean {
  const strategies = loadStrategies(envelope.mode)
  const label = `${envelope.mode}:${envelope.goalType}`

  if (strategies.length === 0) {
    console.error(`✗ ${label}: no strategies found under shared/strategies/${envelope.mode}/`)
    return false
  }

  const goal = goalForEnvelope(envelope)
  const results = strategies.map((s) => simulate(s, { goal }))
  const report = validatePacing(envelope, results)

  console.info(`\n${report.pass ? '✓' : '✗'} ${label}  (time-to-milestone)`)
  console.info(
    `  viable: ${report.viableCount}/${strategies.length} (need ${envelope.minViableStrategies})` +
      `   spread: ${report.spreadRatio === null ? 'n/a' : `${report.spreadRatio.toFixed(3)} (max ${envelope.maxTimeSpread})`}`,
  )
  for (const s of report.strategies) {
    const mark = s.viable ? 'viable ' : '       '
    const time = s.timeSec === null ? '   —' : `${s.timeSec.toFixed(1)}s`
    console.info(`    ${mark} ${time.padStart(8)}  ${s.name}`)
  }
  if (report.exploitWarnings.length > 0) {
    console.info(`  ⚠ exploit candidates (suspiciously fast): ${report.exploitWarnings.join(', ')}`)
  }

  if (ANALYZE) {
    const viableNames = new Set(report.strategies.filter((s) => s.viable).map((s) => s.name))
    printCoverage(envelope.mode, results, viableNames)
    printDominance(envelope.mode, strategies, results, viableNames, goal)
    printPacing(results, viableNames)
  }

  if (SUGGEST) printPacingSuggestion(envelope, results)

  return report.pass
}

function main(): void {
  const envelopes = allEnvelopes()
  if (envelopes.length === 0) {
    console.info('No envelopes registered — nothing to check.')
    return
  }

  let allPass = true
  for (const envelope of envelopes) {
    const ok = isPacingEnvelope(envelope) ? checkPacing(envelope) : checkTimed(envelope)
    if (!ok) allPass = false
  }

  if (SUGGEST) {
    console.info('\n(--suggest: bands not enforced this run)')
    return
  }

  if (!allPass) {
    console.error('\nBalance check FAILED — corpus falls outside the target envelope.')
    process.exit(1)
  }
  console.info('\nBalance check passed.')
}

main()
