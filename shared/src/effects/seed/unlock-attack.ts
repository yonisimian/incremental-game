import { z } from 'zod'

import type { AttackUnlockOutput, EffectDef } from '../types.js'

/**
 * Schema for the `unlockAttack` effect's params.
 *
 * While the owning upgrade is held, the named attack becomes available in the
 * attack panel. `attack` is a free-form stable id (like `panelUnlock`'s `panel`)
 * — there is no central attack registry yet, so it isn't validated at load time.
 * The attack has no behavior of its own; this only gates its appearance. An
 * attack that no owned upgrade unlocks is hidden (see `isAttackUnlocked`).
 */
const schema = z.strictObject({
  attack: z.string(),
})

/** Params for the `unlockAttack` effect (inferred from its schema). */
export type UnlockAttackParams = z.infer<typeof schema>

/**
 * State-independent: echoes the authored attack id as an
 * {@link AttackUnlockOutput}. Whether the gate is actually satisfied (the
 * upgrade is owned) is decided by `isAttackUnlocked`, which owns this output.
 */
function apply(p: UnlockAttackParams): AttackUnlockOutput {
  return { kind: 'attackUnlock', attack: p.attack }
}

export const unlockAttack: EffectDef<UnlockAttackParams> = { schema, apply }
