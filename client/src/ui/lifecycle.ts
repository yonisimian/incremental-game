import { activeDebuffExpiresAtSec, activePactExpiresAtSec, cooldownUntilSec } from '@game/shared'
import type { AttackBlockReason, PlayerState } from '@game/shared'
import type { Countdown } from './format-number.js'

// Where an activation is in its timed life, and the countdown that phase shows
// — one reading for the attack and relations cards and the data panel's rows,
// so their countdowns never disagree. Each card maps the phase to its own
// classes.

/** A timed phase: striking (attacks only), the window open, or the rest after it. */
export type LifecyclePhase = 'preparing' | 'active' | 'cooling'

/** A phase and its countdown. */
export interface LifecycleCountdown<P extends LifecyclePhase = LifecyclePhase> extends Countdown {
  readonly phase: P
}

/**
 * The timed phase of attack `attackId`, from its `attackBlockReason` (which
 * already ranks pending, then the open window, then the rest stamped behind
 * it), or `null` when it is in none.
 */
export function attackLifecycle(
  player: Readonly<PlayerState>,
  attackId: string,
  reason: AttackBlockReason | null,
): LifecycleCountdown | null {
  switch (reason) {
    case 'already-preparing': {
      const readyAt = player.pendingAttacks.find((p) => p.attack === attackId)?.readyAtSec
      return readyAt === undefined
        ? null
        : { phase: 'preparing', template: 'Striking in {}s', untilSec: readyAt }
    }
    case 'already-active': {
      const expiresAt = activeDebuffExpiresAtSec(player, attackId)
      return expiresAt === null
        ? null
        : { phase: 'active', template: 'Active for {}s', untilSec: expiresAt }
    }
    case 'cooling-down': {
      const until = cooldownUntilSec(player, 'attack', attackId)
      return until === null ? null : { phase: 'cooling', template: 'Ready in {}s', untilSec: until }
    }
    default:
      return null
  }
}

/** The timed phase of active pact `pactId` — window open, then cooling down — or `null`. */
export function pactLifecycle(
  player: Readonly<PlayerState>,
  pactId: string,
): LifecycleCountdown<'active' | 'cooling'> | null {
  const expiresAt = activePactExpiresAtSec(player, pactId)
  if (expiresAt !== null)
    return { phase: 'active', template: 'Active for {}s', untilSec: expiresAt }
  const until = cooldownUntilSec(player, 'pact', pactId)
  return until === null ? null : { phase: 'cooling', template: 'Ready in {}s', untilSec: until }
}
