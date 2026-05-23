import type { UpgradeDefinition } from './types.js'

export type CostScaling =
  | { readonly type: 'linear'; readonly baseCost: number; readonly factor: number }
  | { readonly type: 'exponential'; readonly baseCost: number; readonly factor: number }

export function getUpgradeNextCost(def: UpgradeDefinition, currentLevel: number): number {
  if (!('costScaling' in def) || !def.costScaling) return def.cost
  const s = def.costScaling
  const base = s.baseCost
  const lvl = currentLevel
  if (s.type === 'linear') {
    return base + s.factor * lvl
  }
  // exponential
  return Math.round(base * s.factor ** lvl)
}

export function getUpgradeBulkCost(
  def: UpgradeDefinition,
  currentLevel: number,
  levelsToBuy: number,
): number {
  if (levelsToBuy <= 0) return 0
  if (!('costScaling' in def) || !def.costScaling) return def.cost * levelsToBuy
  const s = def.costScaling
  const base = s.baseCost
  const start = currentLevel
  if (s.type === 'linear') {
    // Sum_{i=0..n-1} (base + factor*(start + i))
    // = n*base + factor*(n*start + n*(n-1)/2)
    const n = levelsToBuy
    return n * base + s.factor * (n * start + (n * (n - 1)) / 2)
  }
  // exponential: base * factor^{start} * (factor^{n} - 1) / (factor - 1)
  const n = levelsToBuy
  if (s.factor === 1) {
    return base * n * s.factor ** start
  }
  const numerator = s.factor ** n - 1
  return Math.round(base * s.factor ** start * (numerator / (s.factor - 1)))
}

export function getMaxAffordableUpgradeLevels(
  def: UpgradeDefinition,
  currentLevel: number,
  budget: number,
): number {
  const maxAllow =
    def.purchaseLimit === Infinity ? Infinity : Math.max(0, def.purchaseLimit - currentLevel)
  if (maxAllow === 0) return 0
  let low = 0
  let high = maxAllow === Infinity ? 64 : maxAllow
  // binary search for largest n with cost <= budget
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    const cost = getUpgradeBulkCost(def, currentLevel, mid)
    if (cost <= budget) low = mid
    else high = mid - 1
  }
  return low
}
