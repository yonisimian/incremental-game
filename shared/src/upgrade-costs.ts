import type { UpgradeDefinition } from './types.js'

export type CostScaling =
  | { readonly type: 'linear'; readonly baseCost: number; readonly factor: number }
  | { readonly type: 'exponential'; readonly baseCost: number; readonly factor: number }

/** Per-level cost multiplier (1.0 at level 0), applied uniformly to each currency (D8). */
function costScaleMultiplier(scaling: CostScaling, level: number): number {
  if (scaling.type === 'linear') {
    return (scaling.baseCost + scaling.factor * level) / scaling.baseCost
  }
  // exponential
  return scaling.factor ** level
}

/** Cost map for the next level, with `costScaling` (if any) applied per-currency (D8). */
export function getUpgradeNextCost(
  def: UpgradeDefinition,
  currentLevel: number,
): Record<string, number> {
  const scaling = def.costScaling
  const mult = scaling ? costScaleMultiplier(scaling, currentLevel) : 1
  const out: Record<string, number> = {}
  for (const [currency, amount] of Object.entries(def.cost)) {
    out[currency] = scaling ? Math.round(amount * mult) : amount
  }
  return out
}

/** Total cost map for buying `levelsToBuy` consecutive levels from `currentLevel`. */
export function getUpgradeBulkCost(
  def: UpgradeDefinition,
  currentLevel: number,
  levelsToBuy: number,
): Record<string, number> {
  const out: Record<string, number> = {}
  if (levelsToBuy <= 0) return out
  for (let i = 0; i < levelsToBuy; i++) {
    const cost = getUpgradeNextCost(def, currentLevel + i)
    for (const [currency, amount] of Object.entries(cost)) {
      out[currency] = (out[currency] ?? 0) + amount
    }
  }
  return out
}

export function getMaxAffordableUpgradeLevels(
  def: UpgradeDefinition,
  currentLevel: number,
  budget: Readonly<Record<string, number>>,
): number {
  const maxAllow =
    def.purchaseLimit === Infinity ? Infinity : Math.max(0, def.purchaseLimit - currentLevel)
  if (maxAllow === 0) return 0
  let low = 0
  let high = maxAllow === Infinity ? 64 : maxAllow
  // binary search for largest n with cost <= budget (cost is monotonic in n)
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (isCostAffordable(budget, getUpgradeBulkCost(def, currentLevel, mid))) low = mid
    else high = mid - 1
  }
  return low
}

/** True if `resources` covers every currency required by `cost`. */
export function isCostAffordable(
  resources: Readonly<Record<string, number>>,
  cost: Readonly<Record<string, number>>,
): boolean {
  return Object.entries(cost).every(([currency, amount]) => (resources[currency] ?? 0) >= amount)
}

/** Sum of all currency amounts in the next-level cost (score-equivalent total — D9). */
export function getUpgradeCostTotal(def: UpgradeDefinition, currentLevel: number): number {
  return Object.values(getUpgradeNextCost(def, currentLevel)).reduce((sum, amt) => sum + amt, 0)
}

/**
 * The currency an upgrade is paid in — used to drive the single-currency
 * highlight mechanic (bot plans, dev-sim). Upgrade costs are single-currency
 * today, so this returns that currency; `fallback` is used only when the cost
 * map is empty. When multi-currency costs are introduced (Phase 2), this needs
 * a deliberate selection rule (e.g. weighted by production rate or scarcity)
 * rather than picking an arbitrary key.
 */
export function getCostCurrency(def: UpgradeDefinition, fallback: string): string {
  return Object.keys(def.cost)[0] ?? fallback
}
