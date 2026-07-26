/**
 * Registry mapping each `mode` to its balance envelopes. Timed goals use a
 * score-band `TargetEnvelope`; goal-terminated goals (target-score / buy-upgrade)
 * use a time-band `PacingEnvelope`. Envelopes are **development / CI metadata**
 * authored in a sidecar (`shared/balance/<mode>.json`) and registered by
 * `loadBalance`.
 *
 * The registry is empty in production (gameplay never calls `loadBalance`), so
 * `envelopeFor` / `allEnvelopes` **fail soft**: an unregistered mode yields no
 * envelope, exactly as a missing key does.
 */

import type { GameMode } from '../types.js'
import type { BalanceEnvelope, PacingEnvelope, TargetEnvelope } from './types.js'

export type { BalanceEnvelope } from './types.js'

/** Loaded envelopes, keyed by mode. Empty until `loadBalance` registers a sidecar. */
const BALANCE_REGISTRY = new Map<GameMode, BalanceEnvelope[]>()

/** True when the envelope is a time-band pacing envelope (score/race), not a score-band one. */
export function isPacingEnvelope(envelope: BalanceEnvelope): envelope is PacingEnvelope {
  return 'maxTimeSpread' in envelope
}

/**
 * Register a mode's authored envelopes. Idempotent: re-registering the same mode
 * overwrites it. Called by `loadBalance` after parsing + validating a sidecar.
 */
export function registerBalance(mode: GameMode, envelopes: BalanceEnvelope[]): void {
  BALANCE_REGISTRY.set(mode, envelopes)
}

/** Look up the balance envelope for a mode + goal type, or `undefined` if none is registered. */
export function envelopeFor(
  mode: GameMode,
  goalType: TargetEnvelope['goalType'],
): BalanceEnvelope | undefined {
  return BALANCE_REGISTRY.get(mode)?.find((e) => e.goalType === goalType)
}

/** All registered envelopes across loaded modes (used by the CI balance gate). */
export function allEnvelopes(): BalanceEnvelope[] {
  return [...BALANCE_REGISTRY.values()].flat()
}
