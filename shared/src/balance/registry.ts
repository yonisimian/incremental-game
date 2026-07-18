/**
 * Registry mapping `mode:goalType` to its balance envelope. Timed goals use a
 * score-band `TargetEnvelope`; goal-terminated goals (target-score / buy-upgrade)
 * use a time-band `PacingEnvelope`. Union-typed from the start so adding a goal
 * type is a pure data addition — see docs/plans/24-envelope-integration.md.
 */

import { IDLER_TIMED_ENVELOPE } from '../modes/idler-envelope.js'
import type { GameMode } from '../types.js'
import type { PacingEnvelope, TargetEnvelope } from './types.js'

/** Either kind of balance envelope, keyed in the registry by `mode:goalType`. */
export type BalanceEnvelope = TargetEnvelope | PacingEnvelope

/** True when the envelope is a time-band pacing envelope (score/race), not a score-band one. */
export function isPacingEnvelope(envelope: BalanceEnvelope): envelope is PacingEnvelope {
  return 'maxTimeSpread' in envelope
}

const ENVELOPES: Record<string, BalanceEnvelope | undefined> = {
  'idler:timed': IDLER_TIMED_ENVELOPE,
}

/** Look up the balance envelope for a mode + goal type, or `undefined` if none is authored. */
export function envelopeFor(
  mode: GameMode,
  goalType: TargetEnvelope['goalType'],
): BalanceEnvelope | undefined {
  return ENVELOPES[`${mode}:${goalType}`]
}
