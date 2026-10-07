// @game/shared — activation cooldowns: the rest after an attack's (or, later, a
// pact's) effect ends, before it can be activated again.
//
// One `PlayerState.cooldowns` list serves every activatable kind; `kind` keeps
// the id namespaces apart. Entries are judged at read time against the owner's
// game clock, so the server's sweep only bounds the array — the same split as
// debuff windows (`activeDebuffExpiresAtSec` / `openDebuffWindows`).

import { readGameSec } from './game-clock.js'
import type { Cooldown, PlayerState } from './types.js'

/**
 * Game-clock time the cooldown on `(kind, id)` lifts, or `null` when it is not
 * cooling down. An elapsed entry the server has not swept yet reads as `null`
 * (`untilSec === gameSec` is already ready), so a caller never needs to know
 * about the sweep.
 */
export function cooldownUntilSec(
  state: Readonly<PlayerState>,
  kind: Cooldown['kind'],
  id: string,
): number | null {
  const gameSec = readGameSec(state)
  const entry = state.cooldowns?.find((c) => c.kind === kind && c.id === id)
  return entry && entry.untilSec > gameSec ? entry.untilSec : null
}

/**
 * Start (or restart) the cooldown on `(kind, id)`, lifting at `untilSec`.
 * Replaces any existing entry for the same pair, so an id is never listed twice.
 */
export function startCooldown(
  state: PlayerState,
  kind: Cooldown['kind'],
  id: string,
  untilSec: number,
): void {
  const others = (state.cooldowns ?? []).filter((c) => c.kind !== kind || c.id !== id)
  state.cooldowns = [...others, { kind, id, untilSec }]
}

/** Drop the cooldowns that have lifted by `gameSec`; delete the field once empty. */
export function sweepCooldowns(state: PlayerState, gameSec: number): void {
  if (!state.cooldowns) return
  const live = state.cooldowns.filter((c) => c.untilSec > gameSec)
  if (live.length > 0) state.cooldowns = live
  else delete state.cooldowns
}
