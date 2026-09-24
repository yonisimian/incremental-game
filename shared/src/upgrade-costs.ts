import type { PlayerState, UpgradeDefinition } from './types.js'
import type { CostFactors } from './cost.js'
import { applyCostFactors, incomingCostFactors, scaledCost } from './cost.js'

/**
 * The cost factors in force for one upgrade — the upgrade-side twin of
 * `collectGeneratorCostFactors`, and the seam every upgrade price goes through.
 *
 * Today that is exactly the inflation an opponent's passive attacks inflict
 * (upgrades have no friendly cost-reduction effect yet; a `generatorCost`-style
 * one would compose here).
 */
export function upgradeCostFactors(state: Readonly<PlayerState>, upgradeId: string): CostFactors {
  return incomingCostFactors(state, 'upgrade', upgradeId)
}

/**
 * Cost map for the next level, with each currency's per-level scaling applied.
 *
 * `factors` reshapes every currency's curve before the price is rounded, so a
 * factor is folded in exactly once and both sides of the network agree on the
 * resulting integer. It is required rather than defaulted on purpose: a price
 * quoted without the factors in force would disagree with the price the server
 * charges, and requiring it makes the compiler — not a rejected purchase — find
 * the call site that forgot. Pass `upgradeCostFactors(state, def.id)` where a
 * player state is in hand, `NEUTRAL_COST_FACTORS` where there is no opponent
 * (the dev simulator, balance metrics).
 */
export function getUpgradeNextCost(
  def: UpgradeDefinition,
  currentLevel: number,
  factors: CostFactors,
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [currency, entry] of Object.entries(def.cost)) {
    out[currency] = Math.round(scaledCost(applyCostFactors(entry, factors), currentLevel))
  }
  return out
}

/** Total cost map for buying `levelsToBuy` consecutive levels from `currentLevel`. */
export function getUpgradeBulkCost(
  def: UpgradeDefinition,
  currentLevel: number,
  levelsToBuy: number,
  factors: CostFactors,
): Record<string, number> {
  const out: Record<string, number> = {}
  if (levelsToBuy <= 0) return out
  for (let i = 0; i < levelsToBuy; i++) {
    const cost = getUpgradeNextCost(def, currentLevel + i, factors)
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
  factors: CostFactors,
): number {
  const maxAllow =
    def.purchaseLimit === Infinity ? Infinity : Math.max(0, def.purchaseLimit - currentLevel)
  if (maxAllow === 0) return 0
  let low = 0
  let high = maxAllow === Infinity ? 64 : maxAllow
  // binary search for largest n with cost <= budget (cost is monotonic in n)
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (isCostAffordable(budget, getUpgradeBulkCost(def, currentLevel, mid, factors))) low = mid
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
export function getUpgradeCostTotal(
  def: UpgradeDefinition,
  currentLevel: number,
  factors: CostFactors,
): number {
  return Object.values(getUpgradeNextCost(def, currentLevel, factors)).reduce(
    (sum, amt) => sum + amt,
    0,
  )
}

/**
 * The currency an upgrade is paid in — used to drive the single-currency
 * highlight mechanic (bot plans, dev-sim). Upgrade costs are single-currency
 * today, so this returns that currency; `fallback` is used only when the cost
 * map is empty. When multi-currency costs are introduced, this needs a
 * deliberate selection rule (e.g. weighted by production rate or scarcity)
 * rather than picking an arbitrary key.
 */
export function getCostCurrency(def: UpgradeDefinition, fallback: string): string {
  return Object.keys(def.cost)[0] ?? fallback
}
