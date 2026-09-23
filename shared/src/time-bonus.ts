/**
 * Time-scaled bonuses: a "clock" upgrade whose payout grows the longer you have
 * owned it (plan 13, re-expressed as effects).
 *
 * Three effects compose one clock, and they are deliberately separate so the tree
 * can sell the mechanic in stages:
 *
 *  1. `timeScaledModifier` — the payout. Anchored to the `clock` upgrade's first
 *     purchase, it accrues `perMinute` of bonus for every minute since, and is
 *     what actually reaches the production pipeline.
 *  2. `timeFactorBoost` — a raise to that accrual rate, per owned level. Each
 *     level counts only from **its own** purchase onward, so buying one late
 *     doesn't retroactively reprice time already elapsed.
 *  3. `timeRetroactive` — flips that: every boost counts from the clock's start,
 *     which is the one-off jackpot at the end of the branch.
 *
 * Everything is derived from the purchase timeline in `meta` (see
 * {@link readPurchaseTimes}) rather than from an accumulator advanced per tick.
 * That keeps the whole mechanic a **pure function of history**: no invariant to
 * maintain across the server tick, the client's optimistic prediction, and the
 * headless simulator, and no way for the three to drift.
 */

import { applyEffect, normalizeEffectOutputs } from './effects/registry.js'
import type { EffectOutput, TimeFactorBoostOutput } from './effects/types.js'
import { readGameSec, readPurchaseTimes } from './game-clock.js'
import type { ModeDefinition } from './modes/types.js'
import type { EffectRef, PlayerState } from './types.js'

/**
 * The effect types that make up a time clock. `timedUpgradeIds` reads this to
 * decide whose purchase timeline must be kept in full, and
 * `validateModeDefinition` to know which refs carry a `clock` id worth checking.
 */
export const TIME_EFFECT_TYPES = [
  'timeScaledModifier',
  'timeFactorBoost',
  'timeRetroactive',
] as const

/** Whether `type` names one of the clock effects (see {@link TIME_EFFECT_TYPES}). */
export function isTimeEffectType(type: string): boolean {
  return (TIME_EFFECT_TYPES as readonly string[]).includes(type)
}

/** Cached per mode — the id set is pure topology, so it never changes for a mode. */
const timedIdCache = new WeakMap<ModeDefinition, ReadonlySet<string>>()

/**
 * The upgrades whose *every* purchase must be dated: the clocks themselves (any
 * id a time effect names as its `clock`) plus the upgrades carrying a
 * `timeFactorBoost`, whose levels are priced individually.
 *
 * Everything else keeps only its first-buy timestamp, which is what stops a cheap
 * unlimited upgrade from growing an ever-longer array inside the state broadcast.
 * Read from raw refs (no `applyEffect`) so this stays available to
 * `applyPurchase` without running the pipeline.
 */
export function timedUpgradeIds(mode: ModeDefinition): ReadonlySet<string> {
  const cached = timedIdCache.get(mode)
  if (cached) return cached

  const ids = new Set<string>()
  const scan = (refs: readonly EffectRef[] | undefined, ownerId?: string): void => {
    for (const ref of refs ?? []) {
      if (!isTimeEffectType(ref.type)) continue
      if (typeof ref.clock === 'string') ids.add(ref.clock)
      if (ref.type === 'timeFactorBoost' && ownerId !== undefined) ids.add(ownerId)
    }
  }
  scan(mode.effects)
  for (const upgrade of mode.upgrades) scan(upgrade.effects, upgrade.id)

  timedIdCache.set(mode, ids)
  return ids
}

/**
 * The game second a clock started — its `clock` upgrade's first purchase — or
 * `undefined` while it was never bought. `at(0)` rather than `[0]` because an
 * empty timeline is the normal state, not an index error.
 */
function clockStart(state: Readonly<PlayerState>, clock: string): number | undefined {
  return readPurchaseTimes(state, clock).at(0)
}

/** Whether an effect output is a clock-rate boost. */
function isTimeFactorBoostOutput(out: EffectOutput): out is TimeFactorBoostOutput {
  return 'kind' in out && out.kind === 'timeFactorBoost'
}

/** One owned upgrade's raise to a clock's accrual rate, with its levels dated. */
export interface TimeFactorBoost {
  /** Added to the clock's rate per minute, per level. */
  readonly perMinute: number
  /** How many levels of the owning upgrade are held. */
  readonly levels: number
  /** Game second each held level was bought, oldest first (may be shorter than `levels`). */
  readonly times: readonly number[]
}

/**
 * Collect every owned upgrade's `timeFactorBoost` for one clock.
 *
 * The owned count is *not* folded into `perMinute` here the way other collectors
 * fold it: each level is priced from its own purchase time, so the levels stay
 * separate until {@link timeBonusFraction} dates them. Mode-level refs are
 * collected too (one level, dated from the clock's own start, since a mode-level
 * effect is never "bought").
 */
export function collectTimeFactorBoosts(
  state: Readonly<PlayerState>,
  mode: ModeDefinition,
  clock: string,
): TimeFactorBoost[] {
  const boosts: TimeFactorBoost[] = []

  const collect = (
    refs: readonly EffectRef[] | undefined,
    levels: number,
    times: readonly number[],
  ): void => {
    for (const ref of refs ?? []) {
      // Skip unrelated effects without running them, matching `collectBatteryParams`.
      if (ref.type !== 'timeFactorBoost') continue
      for (const o of normalizeEffectOutputs(applyEffect(ref, state, mode))) {
        if (isTimeFactorBoostOutput(o) && o.clock === clock) {
          boosts.push({ perMinute: o.perMinute, levels, times: times.slice(0, levels) })
        }
      }
    }
  }

  const start = clockStart(state, clock)
  collect(mode.effects, 1, start === undefined ? [] : [start])
  for (const upgrade of mode.upgrades) {
    const owned = state.upgrades[upgrade.id] ?? 0
    if (owned > 0) collect(upgrade.effects, owned, readPurchaseTimes(state, upgrade.id))
  }
  return boosts
}

/**
 * Whether any owned upgrade makes this clock's boosts retroactive (see
 * {@link TimeRetroactiveOutput}). Reads raw refs — the output is a bare echo of
 * the authored `clock`, so running the effect would tell us nothing more.
 */
export function isTimeBonusRetroactive(
  state: Readonly<PlayerState>,
  mode: ModeDefinition,
  clock: string,
): boolean {
  const names = (refs: readonly EffectRef[] | undefined): boolean =>
    (refs ?? []).some((ref) => ref.type === 'timeRetroactive' && ref.clock === clock)

  if (names(mode.effects)) return true
  return mode.upgrades.some(
    (upgrade) => (state.upgrades[upgrade.id] ?? 0) > 0 && names(upgrade.effects),
  )
}

/**
 * The bonus fraction a clock has accrued right now — `0.4` meaning "+40%" — or
 * `null` while the clock has not been bought (its payout is then inactive rather
 * than neutral, so a `multiplicative` target isn't multiplied by 1 for nothing).
 *
 * ```text
 * fraction = basePerMinute · (now − start)/60
 *          + Σ boosts Σ levels  perMinute · (now − levelStart)/60
 * ```
 *
 * where `start` is the clock's first purchase and `levelStart` is each boost
 * level's own purchase — or `start` for all of them once the clock is
 * retroactive. A level with no recorded purchase time (a hand-built state, or a
 * snapshot from before the timeline was kept) contributes nothing rather than
 * guessing, so it starts paying from the next purchase onwards instead of
 * inventing history.
 */
export function timeBonusFraction(
  state: Readonly<PlayerState>,
  mode: ModeDefinition,
  clock: string,
  basePerMinute: number,
): number | null {
  const start = clockStart(state, clock)
  if (start === undefined) return null

  const now = readGameSec(state)
  const minutesSince = (from: number): number => Math.max(0, (now - Math.max(from, start)) / 60)

  const elapsedMin = minutesSince(start)
  let fraction = basePerMinute * elapsedMin

  const retroactive = isTimeBonusRetroactive(state, mode, clock)
  for (const boost of collectTimeFactorBoosts(state, mode, clock)) {
    if (retroactive) {
      fraction += boost.perMinute * boost.levels * elapsedMin
      continue
    }
    for (const purchasedAt of boost.times) {
      fraction += boost.perMinute * minutesSince(purchasedAt)
    }
  }
  return fraction
}
