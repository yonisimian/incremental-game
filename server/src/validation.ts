import { MAX_CPS, canAffordGenerator } from '@game/shared'
import type {
  GeneratorDefinition,
  ModeDefinition,
  PlayerState,
  UpgradeDefinition,
} from '@game/shared'

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
 */
export function isValidPurchase(
  state: PlayerState,
  upgradeId: string,
  upgradeMap: ReadonlyMap<string, UpgradeDefinition>,
  mode: ModeDefinition,
): boolean {
  const def = upgradeMap.get(upgradeId)
  if (!def) return false

  // One-shot upgrades can only be purchased once
  if (!def.repeatable && (state.upgrades[upgradeId] ?? 0) > 0) return false

  // Check the correct resource balance
  const costResource = def.costCurrency ?? mode.scoreResource
  const balance = state.resources[costResource] ?? 0
  return balance >= def.cost
}

/**
 * Validate a generator purchase.
 * Returns true if the generator exists and the player can afford the next copy.
 */
export function isValidGeneratorPurchase(
  state: PlayerState,
  generatorId: string,
  generatorMap: ReadonlyMap<string, GeneratorDefinition>,
): boolean {
  const def = generatorMap.get(generatorId)
  if (!def) return false
  return canAffordGenerator(state, def)
}
