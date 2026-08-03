import { MAX_CPS } from '@game/shared'

// The purchase validators are pure game rules built from shared primitives, so
// they live in `@game/shared` (shared with the headless strategy simulator) and
// are re-exported here for existing server/test call sites.
export {
  isValidPurchase,
  isValidGeneratorPurchase,
  isValidGeneratorSell,
  isValidAttackActivation,
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
