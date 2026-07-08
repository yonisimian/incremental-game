import type { CostEntry } from './types.js'

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
