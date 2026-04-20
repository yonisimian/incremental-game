import { MAX_CPS } from '@game/shared'
import type { PlayerState, UpgradeDefinition, UpgradeId } from '@game/shared'

/**
 * Validate a click action against the rate limit.
 * Uses server-side timestamps (not client-provided) to prevent bypass.
 * Mutates `recentTimestamps` to maintain the sliding window.
 * Returns true if the click is valid.
 */
export function isValidClick(recentTimestamps: number[]): boolean {
  const now = Date.now()

  // Prune timestamps older than 1 second
  const cutoff = now - 1000
  while (recentTimestamps.length > 0 && recentTimestamps[0] < cutoff) {
    recentTimestamps.shift()
  }

  if (recentTimestamps.length >= MAX_CPS) return false
  recentTimestamps.push(now)
  return true
}

/**
 * Validate a purchase action.
 * Returns true if the player can afford the upgrade and doesn't already own it
 * (or can re-buy it if repeatable).
 * For idler mode, checks the correct currency (wood or ale) based on costCurrency.
 */
export function isValidPurchase(
  state: PlayerState,
  upgradeId: UpgradeId,
  upgradeMap: ReadonlyMap<UpgradeId, UpgradeDefinition>,
): boolean {
  const def = upgradeMap.get(upgradeId)
  if (!def) return false

  // One-shot upgrades can only be purchased once
  if (!def.repeatable && state.upgrades[upgradeId]) return false

  // Dual-currency: check the correct balance
  if (def.costCurrency) {
    const balance = def.costCurrency === 'wood' ? (state.wood ?? 0) : (state.ale ?? 0)
    return balance >= def.cost
  }

  // Clicker: uses generic currency
  if (state.currency < def.cost) return false
  return true
}
