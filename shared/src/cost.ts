import type { CostEntry, CostScope, PlayerState } from './types.js'

/**
 * Scaled price of a single {@link CostEntry} at `level` (`baseCost` is the
 * level-0 price). A flat entry (no `scaleType`/`scaleFactor`) returns `baseCost`
 * unchanged; `linear` grows additively (`baseCost + scaleFactor*level`) and
 * `exponential` compounds (`baseCost * scaleFactor**level`). Shared by upgrade
 * and generator costs.
 */
export function scaledCost(entry: CostEntry, level: number): number {
  const { baseCost, scaleType, scaleFactor } = entry
  if (scaleType === undefined || scaleFactor === undefined) return baseCost
  if (scaleType === 'linear') return baseCost + scaleFactor * level
  return baseCost * scaleFactor ** level
}

/** Whether a cost entry's price is constant across levels (no effective growth). */
export function isFlatCost(entry: CostEntry): boolean {
  const { scaleType, scaleFactor } = entry
  if (scaleType === undefined || scaleFactor === undefined) return true
  if (scaleType === 'linear') return scaleFactor === 0
  return scaleFactor === 1
}

// ─── Cost factors ────────────────────────────────────────────────────

/**
 * A reshaping of a cost curve: one multiplier on its price and one on its
 * growth. `1` is neutral on both, below 1 makes the entity cheaper (a friendly
 * `generatorCost` upgrade) and above 1 dearer (an `enemyCostModifier` attack).
 *
 * Shared by upgrades and generators — the two priced entities differ in how many
 * currencies they take, not in how a factor bends their curve.
 */
export interface CostFactors {
  /**
   * Multiplies the price at every level (e.g. `0.95` = 5% cheaper, `1.25` = 25%
   * dearer), on both exponential and linear curves.
   */
  readonly costFactor: number
  /** Multiplies the growth portion (`scaleFactor - 1`) of the cost curve. */
  readonly scalingFactor: number
}

/** No reshaping at all — the authored curve, unchanged. */
export const NEUTRAL_COST_FACTORS: CostFactors = { costFactor: 1, scalingFactor: 1 }

/** Whether these factors leave the curve untouched. */
export function isNeutralCostFactors(factors: CostFactors): boolean {
  return factors.costFactor === 1 && factors.scalingFactor === 1
}

/**
 * Compose two factor pairs by multiplying each knob. Multiplication is
 * commutative, so a reduction and an inflation on the same entity land on the
 * same price whichever order they're combined in.
 */
export function combineCostFactors(a: CostFactors, b: CostFactors): CostFactors {
  if (isNeutralCostFactors(b)) return a
  if (isNeutralCostFactors(a)) return b
  return {
    costFactor: a.costFactor * b.costFactor,
    scalingFactor: a.scalingFactor * b.scalingFactor,
  }
}

/**
 * Apply cost factors to a single {@link CostEntry}, returning a reshaped copy
 * (the entry itself when the factors are neutral). `costFactor` scales the price
 * at every level — `baseCost` alone for exponential (the multiplier carries
 * through `base · rⁿ`), `baseCost` and the per-level increment for linear. The
 * *growth* is scaled by `scalingFactor` (exponential: `1 + (scaleFactor-1)*sf`,
 * so a neutral 1.0 curve stays flat; linear: the increment `× sf`).
 *
 * Callers apply this to the curve **before** rounding the scaled price, so the
 * factor is folded in once and both sides of the network land on the same
 * integer.
 */
export function applyCostFactors(entry: CostEntry, factors: CostFactors): CostEntry {
  if (isNeutralCostFactors(factors)) return entry
  const scaledBase = entry.baseCost * factors.costFactor
  if (entry.scaleType === undefined || entry.scaleFactor === undefined)
    return { ...entry, baseCost: scaledBase }
  return {
    ...entry,
    baseCost: scaledBase,
    scaleFactor:
      entry.scaleType === 'exponential'
        ? 1 + (entry.scaleFactor - 1) * factors.scalingFactor
        : entry.scaleFactor * factors.costFactor * factors.scalingFactor,
  }
}

/**
 * The cost inflation the opponent's passive attacks currently inflict on this
 * player for one entity — the victim-side read of
 * {@link PlayerState.incomingCostFactors}.
 *
 * Entries naming no `id` apply to every entity of their scope; entries naming
 * one apply only to it. Several stack multiplicatively, matching how friendly
 * `generatorCost` reductions stack. Neutral when nothing is inflicted, which is
 * the overwhelmingly common case (no allocation, no work).
 */
export function incomingCostFactors(
  state: Readonly<PlayerState>,
  scope: CostScope,
  id: string,
): CostFactors {
  const incoming = state.incomingCostFactors
  if (incoming === undefined || incoming.length === 0) return NEUTRAL_COST_FACTORS
  let costFactor = 1
  let scalingFactor = 1
  for (const entry of incoming) {
    if (entry.scope !== scope) continue
    if (entry.id !== undefined && entry.id !== id) continue
    costFactor *= entry.costFactor ?? 1
    scalingFactor *= entry.scalingFactor ?? 1
  }
  return costFactor === 1 && scalingFactor === 1
    ? NEUTRAL_COST_FACTORS
    : { costFactor, scalingFactor }
}
