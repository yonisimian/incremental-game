/**
 * Mechanic balance detector — Phase 8a: coverage / mandatory set-membership.
 *
 * See docs/plans/25-envelope-integration.md (Phase 8). This is the smallest,
 * highest-certainty signal in the detector: a pure, binary set-membership read
 * over a mode's authored strategy corpus. For each mechanic (upgrade, generator,
 * or the click action) it reports the set of **viable** strategies that actually
 * fired it during their run, and flags the two extremes:
 *
 *   - used by **zero** viable builds  → `dead` (candidate dead content)
 *   - used by **every** viable build  → `mandatory` (boring-required or auto-OP)
 *
 * Both are pure set membership — no thresholds to defend. "Viable" is decided
 * upstream by the same envelope validators the balance gate already runs; this
 * module just takes the viable name set. It is engine-agnostic: it reads only the
 * `events[]` a `SimResult` already carries, so it needs no re-simulation and no
 * registry access. The forced-use probe that distinguishes a *corpus* gap from a
 * genuine *content* gap is Phase 8c, layered on top of this.
 */

import type { ModeDefinition } from '../modes/types.js'
import type { SimResult } from '../simulation/simulate.js'

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
