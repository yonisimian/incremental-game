import { z } from 'zod'

import type { AttackAlertOutput, EffectDef } from '../types.js'

/**
 * Schema for the `attackAlert` effect's params (plan 41).
 *
 * Grants the owner an early warning of enemy active strikes: while a pending
 * enemy strike is due within `leadSec` game seconds, the server includes it in
 * the owner's opponent view (`OpponentView.incomingAttacks`) and the client
 * shows a countdown. `revealAttack` adds the attack's id to that warning, which
 * the client resolves to a name — without it the warning says only that
 * *something* is coming.
 *
 * `leadSec` scales with the owned count in `collectAttackAlert` (`leadSec ×
 * owned`), so "+1 second per level" is one authored ref on a multi-level node.
 * `revealAttack` is a flag and does not scale. A grant must carry at least one
 * of the two — a ref granting neither would be a node that is bought and does
 * nothing.
 *
 * The lead is deliberately not clamped to any attack's prepare time: a lead
 * longer than the delay simply means the warning appears at activation.
 */
const schema = z
  .strictObject({
    /** Seconds of warning granted, per owned level. */
    leadSec: z.number().positive().optional(),
    /** Whether the warning names the incoming attack. */
    revealAttack: z.boolean().optional(),
  })
  .refine((p) => p.leadSec !== undefined || p.revealAttack === true, {
    message: 'attackAlert must grant a lead (leadSec), a reveal (revealAttack: true), or both',
  })

/** Params for the `attackAlert` effect (inferred from its schema). */
export type AttackAlertParams = z.infer<typeof schema>

/**
 * State-independent: echoes the authored grant as an {@link AttackAlertOutput}.
 * The owned-count scaling and the cross-grant fold happen in
 * `collectAttackAlert`, which owns this output.
 */
function apply(p: AttackAlertParams): AttackAlertOutput {
  return { kind: 'attackAlert', leadSec: p.leadSec ?? 0, revealAttack: p.revealAttack ?? false }
}

export const attackAlert: EffectDef<AttackAlertParams> = { schema, apply }
