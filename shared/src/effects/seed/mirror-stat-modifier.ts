import { z } from 'zod'

import { MODIFIER_STAGES } from '../../modifiers/types.js'
import type { EffectDef, MirrorModifierOutput } from '../types.js'

/**
 * Schema for the `mirrorStatModifier` effect's params.
 *
 * A *mirrored production bonus* carried by a pact: while the pact is in force,
 * the beneficiary's `field` gains a bonus scaled by one **enemy** stat —
 * `perUnit` per unit of `source`, bounded by `cap`.
 *
 *  - `source: "generator:g0", field: "r0", stage: "multiplicative", perUnit:
 *    0.02, cap: 0.5` — +2% wood per enemy woodcutter, up to +50%;
 *  - `source: "r0:rate", field: "clickIncome", stage: "additive", perUnit:
 *    0.1` — each click pays a tenth of the enemy's wood rate extra.
 *
 * `source` is an enemy-stat key (`enemyStatKeys`: stockpiles, pact-free
 * `:rate`s, `peakCps`, `score`, entity counts) and `field` an enemy-debuff
 * target (`enemyDebuffTargets`: resource rates, `clickIncome`, the virtual
 * `highlightFactor` — multiplicative only, as for a debuff). Both are plain
 * `z.string()`s so the schema-driven editor form can introspect them; the
 * `/dev.html` pickers offer only catalog keys and `validateModeDefinition`
 * rejects the rest at load.
 *
 * `perUnit` and `cap` are positive: a pact is a buff by definition (a
 * `guardModifierValue('bonus')` in spirit, on a rule rather than a value).
 * `cap` bounds the *bonus* — the added amount, or the excess over 1 — not the
 * source stat, so `cap: 0.5` on a multiplicative rule means "at most ×1.5".
 */
const schema = z.strictObject({
  source: z.string(),
  field: z.string(),
  stage: z.enum(MODIFIER_STAGES),
  perUnit: z.number().positive(),
  cap: z.number().positive().optional(),
})

/** Params for the `mirrorStatModifier` effect (inferred from its schema). */
export type MirrorStatModifierParams = z.infer<typeof schema>

/**
 * State-independent: echoes the authored rule as a {@link MirrorModifierOutput}.
 * Not `dynamic` — it reads nothing off the *owner's* state; the number moves
 * with the partner's, which only `collectPactBonuses` (the output's owner) can
 * see. `apply` receives the beneficiary's state by contract and ignores it.
 */
function apply(p: MirrorStatModifierParams): MirrorModifierOutput {
  return {
    kind: 'mirrorModifier',
    source: p.source,
    field: p.field,
    stage: p.stage,
    perUnit: p.perUnit,
    cap: p.cap,
  }
}

export const mirrorStatModifier: EffectDef<MirrorStatModifierParams> = {
  schema,
  apply,
  // Only the pact collectors read this output; `activePact` is declared ahead
  // of its reader (plan 44), as for `mirrorCostModifier`.
  hosts: ['passivePact', 'activePact'],
}
