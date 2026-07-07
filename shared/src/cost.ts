import type { CostEntry } from './types.js'

/**
 * Scaled price of a single {@link CostEntry} at `level` (`base` is the level-0
 * price). A flat entry (no `scaleType`/`scaleFactor`) returns `base` unchanged;
 * `linear` grows additively (`base * (1 + scaleFactor*level)`) and `exponential`
 * compounds (`base * scaleFactor**level`). Shared by upgrade and generator costs.
 */
export function scaledCost(entry: CostEntry, level: number): number {
  const { base, scaleType, scaleFactor } = entry
  if (scaleType === undefined || scaleFactor === undefined) return base
  if (scaleType === 'linear') return base * (1 + scaleFactor * level)
  return base * scaleFactor ** level
}

/** Whether a cost entry's price is constant across levels (no effective growth). */
export function isFlatCost(entry: CostEntry): boolean {
  const { scaleType, scaleFactor } = entry
  if (scaleType === undefined || scaleFactor === undefined) return true
  if (scaleType === 'linear') return scaleFactor === 0
  return scaleFactor === 1
}
