import { z } from 'zod'

import type { EffectDef, PactUnlockOutput } from '../types.js'

/**
 * Schema for the `unlockPact` effect's params.
 *
 * While the owning upgrade is held, the named pact becomes available in the
 * international relationship panel. `pact` is a plain `z.string()` (like
 * `panelUnlock`'s `panel`) so the schema-driven editor form can introspect it;
 * the valid set is enforced by the editor dropdown and validated against the
 * mode's `pacts` at load (`validateModeDefinition`), so an authored typo fails
 * loudly. The pact has no behavior of its own; this only gates its appearance.
 * A pact that no owned upgrade unlocks is hidden (see `isPactUnlocked`).
 */
const schema = z.strictObject({
  pact: z.string(),
})

/** Params for the `unlockPact` effect (inferred from its schema). */
export type UnlockPactParams = z.infer<typeof schema>

/**
 * State-independent: echoes the authored pact id as a {@link PactUnlockOutput}.
 * Whether the gate is actually satisfied (the upgrade is owned) is decided by
 * `isPactUnlocked`, which owns this output.
 */
function apply(p: UnlockPactParams): PactUnlockOutput {
  return { kind: 'pactUnlock', pact: p.pact }
}

export const unlockPact: EffectDef<UnlockPactParams> = { schema, apply }
