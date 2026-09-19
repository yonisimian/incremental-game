import { z } from 'zod'

import type { AttackSlotsOutput, EffectDef } from '../types.js'

/**
 * Schema for the `attackSlots` effect's params (plan 38).
 *
 * Grants room to *hold* attacks of one kind. Authored on the mode it is the
 * round's base budget; on an upgrade it is a raise, scaled by the owned count
 * (`value × owned`) in `attackLimit`. Once a player holds their limit of a kind,
 * every upgrade that would unlock another attack of that kind is unbuyable
 * (`purchaseBlockReason` → `'attack-slots'`), so an attack tree with a budget is
 * a *choice* rather than an inventory.
 *
 * Per kind rather than one pooled budget, so a mode can price permanent passive
 * value and burst active value separately. A kind no `attackSlots` effect in the
 * mode names at all is uncapped — the mechanic is opt-in, and the idler kept
 * working untouched until a base was authored.
 *
 * A base of **zero** is authorable by omission: a mode that grants slots only
 * from an upgrade caps the kind at `0` until that upgrade is bought, which is
 * how a tree can show the attack panel yet make the *first* slot a purchase.
 * `value` itself stays a positive integer — a grant of nothing would be a node
 * that is bought and does nothing.
 *
 * Additive only. A multiplicative op on a small integer count buys nothing but
 * rounding questions.
 */
const schema = z.strictObject({
  /** Which kind of attack this budget covers. */
  attackKind: z.enum(['active', 'passive']),
  /** Slots granted, per owned level. */
  value: z.number().int().positive(),
})

/** Params for the `attackSlots` effect (inferred from its schema). */
export type AttackSlotsParams = z.infer<typeof schema>

/**
 * State-independent: echoes the authored grant as an {@link AttackSlotsOutput}.
 * The owned-count scaling and the cross-grant summing happen in `attackLimit`,
 * which owns this output.
 */
function apply(p: AttackSlotsParams): AttackSlotsOutput {
  return { kind: 'attackSlots', attackKind: p.attackKind, value: p.value }
}

export const attackSlots: EffectDef<AttackSlotsParams> = { schema, apply }
