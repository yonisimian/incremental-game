import {
  MAX_CPS,
  canAffordGenerator,
  isMaxed,
  isPrerequisiteSatisfied,
  isChoiceGroupAvailable,
  getUpgradeNextCost,
  isCostAffordable,
} from '@game/shared'
import type { GeneratorDefinition, PlayerState, UpgradeDefinition } from '@game/shared'

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
 * Returns true if the player can afford the upgrade, doesn't already own it
 * beyond its max level, and all prerequisites are owned.
 */
export function isValidPurchase(
  state: PlayerState,
  upgradeId: string,
  upgradeMap: ReadonlyMap<string, UpgradeDefinition>,
): boolean {
  const def = upgradeMap.get(upgradeId)
  if (!def) return false

  const owned = state.upgrades[upgradeId] ?? 0
  if (isMaxed(def, owned)) return false

  // All prerequisites must be satisfied
  if (!isPrerequisiteSatisfied(def.prerequisites, state)) return false

  // Only one choice from a mutual-exclusion group may be selected.
  if (!isChoiceGroupAvailable(def, state, Array.from(upgradeMap.values()))) return false

  // Every currency in the cost map must be affordable.
  return isCostAffordable(state.resources, getUpgradeNextCost(def, owned))
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
