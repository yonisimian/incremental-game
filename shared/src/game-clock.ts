/**
 * The round clock and the purchase timeline — the two `meta` keys every
 * time-dependent mechanic reads.
 *
 * Both live in `meta` (like the highlight and the battery charge) so they ride
 * the existing state broadcast with no wire change, and both are measured in
 * *game* seconds: the clock advances only while the round ticks, so a pause or a
 * slow tick can never pay out time nobody played.
 *
 * The readers are total — a missing or corrupt value reads as "no time / no
 * purchases" rather than throwing — because `meta` is untyped and arrives from
 * the wire.
 */

import type { PlayerState } from './types.js'

/** `meta` key holding the round's elapsed game seconds. */
export const GAME_SEC_KEY = 'gameSec'

/**
 * `meta` key holding, per upgrade id, the game second of each purchase.
 *
 * An array rather than a single number so a repeatable upgrade's *levels* can be
 * dated individually — what a bonus that accrues "from this level onwards" needs.
 * Only upgrades the mode actually clocks get the full timeline (see
 * `timedUpgradeIds`); everything else keeps just its first buy, so a linear
 * unlimited upgrade bought hundreds of times can't grow the broadcast state.
 */
export const PURCHASE_TIMES_KEY = 'purchaseTimes'

/** Elapsed game seconds this round, or `0` before the first tick. */
export function readGameSec(state: Readonly<PlayerState>): number {
  const raw = state.meta[GAME_SEC_KEY]
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : 0
}

/** Advance the round clock by one tick. The sole writer of {@link GAME_SEC_KEY}. */
export function advanceGameSec(state: PlayerState, tickSec: number): void {
  state.meta[GAME_SEC_KEY] = readGameSec(state) + tickSec
}

/**
 * The game seconds at which each level of `upgradeId` was bought, oldest first —
 * empty when it was never bought (or when the snapshot predates the recording).
 *
 * `[0]` is the first buy, which is what a clock anchors to; later entries date
 * the later levels. Non-numeric entries are dropped rather than trusted, so a
 * corrupt snapshot degrades to a shorter timeline instead of poisoning the math.
 */
export function readPurchaseTimes(
  state: Readonly<PlayerState>,
  upgradeId: string,
): readonly number[] {
  const all = state.meta[PURCHASE_TIMES_KEY]
  if (typeof all !== 'object' || all === null) return []
  const times = (all as Record<string, unknown>)[upgradeId]
  if (!Array.isArray(times)) return []
  return times.filter((t): t is number => typeof t === 'number' && Number.isFinite(t))
}

/**
 * Date a purchase of `upgradeId` at the current game second.
 *
 * `full` decides how much history is kept: `true` appends every level (for the
 * upgrades a time-scaled bonus reads), `false` records only the first buy and
 * then leaves the entry alone.
 */
export function recordPurchaseTime(state: PlayerState, upgradeId: string, full: boolean): void {
  const all = (state.meta[PURCHASE_TIMES_KEY] as Record<string, number[]> | undefined) ?? {}
  const times = all[upgradeId] ?? []
  if (times.length === 0 || full) times.push(readGameSec(state))
  all[upgradeId] = times
  state.meta[PURCHASE_TIMES_KEY] = all
}
