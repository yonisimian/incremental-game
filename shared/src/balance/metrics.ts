/**
 * Mechanic balance detector — coverage, dominance, and pacing signals.
 *
 * Three layered reads: coverage (this section) is the smallest, highest-certainty
 * read — a pure, binary set-membership over a mode's authored strategy corpus;
 * dominance (cost-normalized ablation ROI) answers "too good for its price?";
 * pacing answers "is the build ever idle-starved?".
 *
 * Coverage: for each mechanic (upgrade, generator, or the click action) it
 * reports the set of **viable** strategies that actually fired it during their
 * run, and flags the two extremes:
 *
 *   - used by **zero** viable builds  → `dead` (candidate dead content)
 *   - used by **every** viable build  → `mandatory` (boring-required or auto-OP)
 *
 * Both are pure set membership — no thresholds to defend. "Viable" is decided
 * upstream by the same envelope validators the balance gate already runs; this
 * module just takes the viable name set. It is engine-agnostic: it reads only the
 * `events[]` a `SimResult` already carries, so it needs no re-simulation and no
 * registry access. A forced-use probe that distinguishes a *corpus* gap from a
 * genuine *content* gap could layer on top of this, but is not yet built.
 */

import { scaledCost } from '../cost.js'
import type { ModeDefinition } from '../modes/types.js'
import type { SimResult } from '../simulation/simulate.js'
import type { QueueStrategy } from '../simulation/strategy.js'
import type { CostEntry } from '../types.js'

/** What kind of mechanic a coverage row describes. */
export type MechanicKind = 'upgrade' | 'generator' | 'click'

/** The binary finding for a single mechanic. */
export type CoverageFinding = 'dead' | 'mandatory' | 'fine'

/** Coverage of one mechanic across the viable corpus. */
export interface MechanicCoverage {
  /** Mechanic id — an upgrade/generator id, or the literal `'click'`. */
  readonly id: string
  readonly kind: MechanicKind
  /** Names of the viable strategies that fired this mechanic at least once. */
  readonly usedBy: readonly string[]
  /** `usedBy.length / viableCount` (0 when there are no viable strategies). */
  readonly coverage: number
  readonly finding: CoverageFinding
}

/** The per-mode coverage report. */
export interface CoverageReport {
  /** How many of the supplied results were viable. */
  readonly viableCount: number
  readonly mechanics: readonly MechanicCoverage[]
}

/** The id portion of an event label (`'buy:u0'` → `'u0'`, `'gen:g0'` → `'g0'`). */
function labelId(label: string): string {
  return label.slice(label.indexOf(':') + 1)
}

/** The set of mechanic ids a single run actually fired (from its event log). */
function mechanicsUsed(result: SimResult): ReadonlySet<string> {
  const used = new Set<string>()
  for (const e of result.events) {
    switch (e.kind) {
      case 'buy':
      case 'buy_generator':
        used.add(labelId(e.label))
        break
      case 'set_click_rate':
        // `click:<cps>` — a rate of 0 disables clicking, so it doesn't count.
        if (Number(labelId(e.label)) > 0) used.add('click')
        break
      default:
        break
    }
  }
  return used
}

/**
 * Classify every mechanic in `mode` by how many of the **viable** results fired
 * it. `viable` is the set of viable strategy names (decided by the envelope
 * validators); results whose name is absent are ignored.
 */
export function analyzeCoverage(
  mode: ModeDefinition,
  results: readonly SimResult[],
  viable: ReadonlySet<string>,
): CoverageReport {
  const viableResults = results.filter((r) => viable.has(r.name))
  const viableCount = viableResults.length
  const usedPerResult = new Map(viableResults.map((r) => [r.name, mechanicsUsed(r)]))

  const rowFor = (id: string, kind: MechanicKind): MechanicCoverage => {
    const usedBy = viableResults
      .filter((r) => usedPerResult.get(r.name)?.has(id))
      .map((r) => r.name)
    const coverage = viableCount === 0 ? 0 : usedBy.length / viableCount
    const finding: CoverageFinding =
      usedBy.length === 0
        ? 'dead'
        : viableCount > 0 && usedBy.length === viableCount
          ? 'mandatory'
          : 'fine'
    return { id, kind, usedBy, coverage, finding }
  }

  const mechanics: MechanicCoverage[] = [
    ...mode.upgrades.map((u) => rowFor(u.id, 'upgrade')),
    ...mode.generators.map((g) => rowFor(g.id, 'generator')),
    ...(mode.clicksEnabled ? [rowFor('click', 'click')] : []),
  ]

  return { viableCount, mechanics }
}

// ─── Effect-neutralized ablation + cost-normalized dominance ────────────────
//
// Coverage (8a) answers "does anyone use this?"; dominance answers "is it too
// good for its price?". We measure a mechanic's *contribution* by ablation —
// re-running each build with that mechanic's production neutralized and diffing
// the final score — then normalize by the score-equivalent cost the build paid
// for it. A load-bearing-but-fairly-priced upgrade (high contribution, high
// cost) is correct design; a *cheap* mechanic that dwarfs its peers' ROI is
// overpowered. Clicking is the canonical example: it is free, so any positive
// contribution gives it infinite ROI.
//
// Ablation is **effect-neutralization, not action-removal**: we keep the buy
// action and all prerequisites satisfied and only zero the mechanic's output in
// the pipeline (upgrade → strip its `effects`; generator → zero its production
// rate; click → drop the strategy's `set_click_rate` actions). This module stays
// engine-agnostic by taking an injected re-sim callback — it never imports
// `simulate`, only the pure `ModeDefinition`/`QueueStrategy` transforms.

/** A reference to one mechanic to ablate. */
export interface MechanicRef {
  readonly kind: MechanicKind
  /** Upgrade/generator id, or the literal `'click'`. */
  readonly id: string
}

/**
 * The dominance finding for a single mechanic.
 *
 * `gateway` marks an upgrade whose effects include a **sim-reachability gate**
 * (`systemUnlock` / `generatorUnlock`): neutralizing it doesn't just zero its
 * own production, it disables the entire subsystem it unlocks, so the measured
 * ablation contribution absorbs that subsystem's whole value. Such nodes are
 * excluded from the ROI ranking (their ROI is not a meaningful price signal).
 */
export type DominanceFinding = 'overpowered' | 'gateway' | 'fine'

/** Dominance of one mechanic across the viable corpus. */
export interface DominanceRow {
  readonly id: string
  readonly kind: MechanicKind
  /** How many viable builds fired this mechanic. */
  readonly users: number
  /** Sum of positive per-build ablation deltas (score lost when neutralized). */
  readonly contribution: number
  /** `contribution` as a fraction of the corpus's total positive contribution. */
  readonly share: number
  /** Score-equivalent price the builds paid for it (0 for free mechanics). */
  readonly costScoreEquiv: number
  /** `contribution / costScoreEquiv`; `Infinity` when the mechanic is free. */
  readonly roi: number
  readonly finding: DominanceFinding
}

/** The per-mode dominance report. */
export interface DominanceReport {
  /** Median ROI across costed mechanics with positive contribution. */
  readonly medianRoi: number
  /** A mechanic is overpowered if its ROI ≥ this multiple of the median. */
  readonly roiMultiple: number
  readonly rows: readonly DominanceRow[]
}

/** Injected re-simulation hook: run `strategy` against `mode`, return the result. */
export type ResimFn = (strategy: QueueStrategy, mode: ModeDefinition) => SimResult

/**
 * Effect types that gate **sim reachability** rather than production: an upgrade
 * carrying one of these unlocks a whole subsystem the simulation reads
 * (`systemUnlock` → the click/highlight input systems, consulted by
 * `isSystemUnlocked`; `generatorUnlock` → a generator's purchasability,
 * consulted by `isGeneratorUnlocked`). Ablating such a node by stripping its
 * effects also strips the gate, so its measured contribution is contaminated by
 * everything it unlocks. `panelUnlock` is intentionally absent: it gates only UI
 * panels, never a sim buy, so neutralizing it doesn't change simulated income.
 */
const SIM_GATE_EFFECT_TYPES: ReadonlySet<string> = new Set(['systemUnlock', 'generatorUnlock'])

/** Whether `upgradeId` carries a sim-reachability gate (see {@link SIM_GATE_EFFECT_TYPES}). */
function isGatewayUpgrade(mode: ModeDefinition, upgradeId: string): boolean {
  const upgrade = mode.upgrades.find((u) => u.id === upgradeId)
  return (upgrade?.effects ?? []).some((e) => SIM_GATE_EFFECT_TYPES.has(e.type))
}

/**
 * Clone `mode` with the mechanic's production contribution neutralized: an
 * upgrade keeps its cost/prereqs but emits no effects; a generator keeps its
 * cost but produces nothing. `click` is not a mode-level mechanic — neutralize
 * it via {@link neutralizeClick} on the strategy instead — so it is returned
 * unchanged here.
 */
export function neutralizeMechanic(mode: ModeDefinition, ref: MechanicRef): ModeDefinition {
  if (ref.kind === 'upgrade') {
    return {
      ...mode,
      upgrades: mode.upgrades.map((u) => (u.id === ref.id ? { ...u, effects: [] } : u)),
    }
  }
  if (ref.kind === 'generator') {
    return {
      ...mode,
      generators: mode.generators.map((g) =>
        g.id === ref.id ? { ...g, production: { ...g.production, rate: 0 } } : g,
      ),
    }
  }
  return mode
}

/** Clone `strategy` with clicking disabled (all `set_click_rate` actions dropped). */
export function neutralizeClick(strategy: QueueStrategy): QueueStrategy {
  return { ...strategy, actions: strategy.actions.filter((a) => a.kind !== 'set_click_rate') }
}

/** How many times a build fired a given upgrade/generator (one event per level). */
function countUses(result: SimResult, id: string): number {
  let n = 0
  for (const e of result.events) {
    if ((e.kind === 'buy' || e.kind === 'buy_generator') && labelId(e.label) === id) n++
  }
  return n
}

/** Mean of a resource's positive per-tick income over a run (0 if never produced). */
function resourceEarnRate(result: SimResult, resource: string): number {
  let sum = 0
  let n = 0
  for (const s of result.snapshots) {
    const r = s.incomePerSec[resource] ?? 0
    if (r > 0) {
      sum += r
      n++
    }
  }
  return n > 0 ? sum / n : 0
}

/** Cumulative raw price of buying `levels` of a mechanic, per currency. */
function mechanicRawCost(
  cost: Readonly<Record<string, CostEntry>>,
  levels: number,
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [res, entry] of Object.entries(cost)) {
    let sum = 0
    for (let lvl = 0; lvl < levels; lvl++) sum += scaledCost(entry, lvl)
    out[res] = sum
  }
  return out
}

/**
 * Convert a raw multi-currency cost to a single score-equivalent number. The
 * score resource is counted at face value; every other currency is valued by
 * opportunity cost — how much score the build could have earned in the time it
 * takes to earn that currency (`amount * scoreRate / resourceRate`), using each
 * resource's mean positive earn rate over the run. Non-produced currencies fall
 * back to face value to avoid divide-by-zero.
 */
function scoreEquivCost(
  raw: Record<string, number>,
  result: SimResult,
  scoreResource: string,
): number {
  const scoreRate = resourceEarnRate(result, scoreResource)
  let total = 0
  for (const [res, amt] of Object.entries(raw)) {
    if (res === scoreResource) {
      total += amt
      continue
    }
    const rate = resourceEarnRate(result, res)
    const factor = scoreRate > 0 && rate > 0 ? scoreRate / rate : 1
    total += amt * factor
  }
  return total
}

/** Median of a numeric list (0 for an empty list). */
function median(values: readonly number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

/**
 * Rank every mechanic by cost-normalized contribution across the viable corpus.
 * For each mechanic used by ≥1 viable build, ablate it in that build (via the
 * injected `resim`), sum the positive score deltas as its contribution, and
 * divide by the score-equivalent cost the builds paid. A free mechanic with
 * positive contribution has infinite ROI; a costed mechanic whose ROI is at
 * least `roiMultiple`× the corpus median is flagged overpowered.
 *
 * Upgrades that carry a sim-reachability gate (see {@link isGatewayUpgrade}) are
 * classified `gateway` and skipped for ablation: neutralizing them would strip
 * the gate and mis-attribute a whole subsystem's value to one cheap node. They
 * are kept as informational rows (users/cost only) but never ranked, so they
 * distort neither the median nor the overpowered flag.
 *
 * @param strategies The corpus strategies (needed to re-simulate); matched to
 *   `baseline` by name.
 * @param baseline The un-ablated results (source of the reference score + events).
 * @param viable The set of viable strategy names.
 * @param resim Runs a strategy against a (possibly neutralized) mode.
 * @param roiMultiple ROI-over-median threshold for "overpowered" (default 3).
 */
export function analyzeDominance(
  mode: ModeDefinition,
  strategies: readonly QueueStrategy[],
  baseline: readonly SimResult[],
  viable: ReadonlySet<string>,
  resim: ResimFn,
  roiMultiple = 3,
): DominanceReport {
  const scoreResource = mode.scoreResource
  const stratByName = new Map(strategies.map((s) => [s.name, s]))
  const baseByName = new Map(baseline.map((r) => [r.name, r]))
  const viableNames = [...viable].filter((n) => stratByName.has(n) && baseByName.has(n))

  const refs: MechanicRef[] = [
    ...mode.upgrades.map((u): MechanicRef => ({ kind: 'upgrade', id: u.id })),
    ...mode.generators.map((g): MechanicRef => ({ kind: 'generator', id: g.id })),
    ...(mode.clicksEnabled ? [{ kind: 'click', id: 'click' } as MechanicRef] : []),
  ]
  const costOf = new Map<string, Readonly<Record<string, CostEntry>>>([
    ...mode.upgrades.map((u) => [u.id, u.cost] as const),
    ...mode.generators.map((g) => [g.id, g.cost] as const),
  ])

  interface Raw {
    ref: MechanicRef
    users: number
    contribution: number
    cost: number
    gateway: boolean
  }
  const raws: Raw[] = refs.map((ref) => {
    const gateway = ref.kind === 'upgrade' && isGatewayUpgrade(mode, ref.id)
    let contribution = 0
    let cost = 0
    let users = 0
    for (const name of viableNames) {
      const strat = stratByName.get(name)!
      const base = baseByName.get(name)!
      const used = ref.kind === 'click' ? firedClick(base) : countUses(base, ref.id) > 0
      if (!used) continue
      users++
      // Gateways carry a sim-reachability gate: ablating them strips the gate and
      // mis-attributes a whole subsystem's value, so leave contribution at 0.
      if (!gateway) {
        const ablated =
          ref.kind === 'click'
            ? resim(neutralizeClick(strat), mode)
            : resim(strat, neutralizeMechanic(mode, ref))
        contribution += Math.max(0, base.finalScore - ablated.finalScore)
      }
      if (ref.kind !== 'click') {
        const entry = costOf.get(ref.id)
        if (entry)
          cost += scoreEquivCost(
            mechanicRawCost(entry, countUses(base, ref.id)),
            base,
            scoreResource,
          )
      }
    }
    return { ref, users, contribution, cost, gateway }
  })

  const totalPositive = raws.reduce((s, r) => s + Math.max(0, r.contribution), 0)
  const costedRois = raws
    .filter((r) => r.contribution > 0 && r.cost > 0)
    .map((r) => r.contribution / r.cost)
  const med = median(costedRois)

  const rows: DominanceRow[] = raws.map((r) => {
    const roi = r.cost > 0 ? r.contribution / r.cost : r.contribution > 0 ? Infinity : 0
    const overpowered =
      !r.gateway &&
      r.contribution > 0 &&
      (roi === Infinity || (med > 0 && roi >= roiMultiple * med))
    return {
      id: r.ref.id,
      kind: r.ref.kind,
      users: r.users,
      contribution: r.contribution,
      share: totalPositive > 0 ? Math.max(0, r.contribution) / totalPositive : 0,
      costScoreEquiv: r.cost,
      roi,
      finding: r.gateway ? 'gateway' : overpowered ? 'overpowered' : 'fine',
    }
  })

  return { medianRoi: med, roiMultiple, rows }
}

/** Whether a build ever enabled clicking (`set_click_rate` with cps > 0). */
function firedClick(result: SimResult): boolean {
  for (const e of result.events) {
    if (e.kind === 'set_click_rate' && Number(labelId(e.label)) > 0) return true
  }
  return false
}

// ─── Pacing / engagement stats ───────────────────────────────────────
//
// A build can sit inside the score envelope yet still be no fun — three cheap
// reads over data the sim already emits catch the common failure modes:
//
//   - **decisions**: how many distinct authored actions actually fired. A build
//     that makes three choices in a 35 s round is passive, not interactive.
//   - **time-to-first-action**: a dead opening (nothing happening for the first
//     several seconds) is unfun regardless of the final score.
//   - **idle fraction**: the share of the run spent with no action firing *and*
//     flat income — the player watching a number tick up with nothing to do.
//
// This is pure over `events[]` + `snapshots[]`; no re-simulation, no thresholds
// to defend — it reports the numbers and lets the reader judge.

/** Per-strategy engagement stats. */
export interface EngagementRow {
  readonly name: string
  /** Distinct authored actions that fired (count-buys collapse to one decision). */
  readonly decisions: number
  /** Fire time of the first action, or `null` if the build never acted. */
  readonly timeToFirstActionSec: number | null
  /** Fraction of ticks with no action firing and flat total income (0..1). */
  readonly idleFraction: number
}

/** The per-mode pacing report (viable builds only). */
export interface EngagementReport {
  readonly rows: readonly EngagementRow[]
}

/** Sum of a snapshot's per-resource income rates. */
function totalIncome(snapshot: SimResult['snapshots'][number]): number {
  let sum = 0
  for (const rate of Object.values(snapshot.incomePerSec)) sum += rate
  return sum
}

/**
 * Engagement stats for every viable build. Pure: reads only the `events[]` and
 * `snapshots[]` a `SimResult` already carries.
 */
export function analyzePacing(
  results: readonly SimResult[],
  viable: ReadonlySet<string>,
): EngagementReport {
  const rows = results
    .filter((r) => viable.has(r.name))
    .map((r): EngagementRow => {
      const decisions = new Set(r.events.map((e) => e.index)).size
      const timeToFirstActionSec =
        r.events.length > 0 ? Math.min(...r.events.map((e) => e.timeSec)) : null

      let idle = 0
      let denom = 0
      for (let i = 1; i < r.snapshots.length; i++) {
        denom++
        const s = r.snapshots[i]
        const prev = r.snapshots[i - 1]
        if (s.event === '' && totalIncome(s) === totalIncome(prev)) idle++
      }
      const idleFraction = denom > 0 ? idle / denom : 0

      return { name: r.name, decisions, timeToFirstActionSec, idleFraction }
    })
  return { rows }
}
