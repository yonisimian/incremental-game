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
 */

import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

import {
  allEnvelopes,
  AVAILABLE_MODES,
  isPacingEnvelope,
  loadTree,
  parseStrategy,
  simResultsToScores,
  simulate,
  validateEnvelope,
  type BalanceEnvelope,
  type QueueStrategy,
  type SimGoal,
  type SimResult,
  type TargetEnvelope,
} from '@game/shared'

const ROOT = dirname(fileURLToPath(import.meta.url))
const STRATEGY_ROOT = join(ROOT, '..', 'shared', 'strategies')

const SUGGEST = process.argv.includes('--suggest')

// Register every mode's tree before simulating (mirrors the server's startup).
const require = createRequire(import.meta.url)
for (const mode of AVAILABLE_MODES) {
  loadTree(JSON.parse(readFileSync(require.resolve(`@game/shared/trees/${mode}.json`), 'utf8')))
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
    // Phase 6 wires score/race pacing; until then callers skip pacing envelopes.
    throw new Error('pacing envelopes are not yet supported by the balance gate')
  }
  const last = envelope.checkpoints[envelope.checkpoints.length - 1]
  return { kind: 'timed', durationSec: last.timeSec }
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

  if (SUGGEST) printSuggestion(envelope, results)

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
    if (isPacingEnvelope(envelope)) {
      console.info(`\n· ${envelope.mode}:${envelope.goalType}: pacing envelope (not yet gated)`)
      continue
    }
    if (!checkTimed(envelope)) allPass = false
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
