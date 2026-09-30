import { z } from 'zod'

import type { EffectDef, PactSlotsOutput } from '../types.js'

/**
 * Schema for the `pactSlots` effect's params.
 *
 * The pact twin of `attackSlots`: grants room to *hold* pacts of one kind.
 * Authored on the mode it is the round's base budget; on an upgrade it is a
 * raise, scaled by the owned count (`value × owned`) in `pactLimit`. Once a
 * player holds their limit of a kind, every upgrade that would unlock another
 * pact of that kind is unbuyable (`purchaseBlockReason` → `'pact-slots'`).
 *
 * Per kind, opt-in (a kind no `pactSlots` effect names is uncapped), a base of
 * zero authorable by omission, additive only — every rule `attackSlots` has, for
 * the same reasons.
 */
const schema = z.strictObject({
  /** Which kind of pact this budget covers. */
  pactKind: z.enum(['active', 'passive']),
  /** Slots granted, per owned level. */
  value: z.number().int().positive(),
})

/** Params for the `pactSlots` effect (inferred from its schema). */
export type PactSlotsParams = z.infer<typeof schema>

/**
 * State-independent: echoes the authored grant as a {@link PactSlotsOutput}.
 * The owned-count scaling and the cross-grant summing happen in `pactLimit`.
 */
function apply(p: PactSlotsParams): PactSlotsOutput {
  return { kind: 'pactSlots', pactKind: p.pactKind, value: p.value }
}

export const pactSlots: EffectDef<PactSlotsParams> = { schema, apply }
