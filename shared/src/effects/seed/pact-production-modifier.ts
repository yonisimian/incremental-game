import { z } from 'zod'

import { MODIFIER_STAGES } from '../../modifiers/types.js'
import { guardModifierValue } from '../../modifiers/value-guard.js'
import type { EffectDef, PactModifierOutput } from '../types.js'

/**
 * Schema for the `pactProductionModifier` effect's params.
 *
 * A *flat production bonus* carried by a pact: while the pact is in force, the
 * beneficiary's `field` takes `value` at `stage` — no enemy stat involved,
 * unlike `mirrorStatModifier`. On an active pact that is a timed buff for the
 * signer (and, if `mutual`, the partner):
 *
 *  - `field: "clickIncome", stage: "multiplicative", value: 2` — clicks pay
 *    double while the window is open;
 *  - `field: "r0", stage: "multiplicative", value: 1.25` — +25% wood.
 *
 * `field` is from the same catalog as `mirrorStatModifier`'s (resource rates,
 * `clickIncome`, the virtual `highlightFactor` — multiplicative only), for the
 * same reason: a pact bonus merges in after generator output is folded. A plain
 * `z.string()` so the editor form can introspect it; `validateModeDefinition`
 * rejects the rest at load. `value` is guarded as a *bonus*.
 */
const schema = z
  .strictObject({
    stage: z.enum(MODIFIER_STAGES),
    field: z.string(),
    value: z.number(),
  })
  .superRefine(guardModifierValue('bonus', 'pactProductionModifier'))

/** Params for the `pactProductionModifier` effect (inferred from its schema). */
export type PactProductionModifierParams = z.infer<typeof schema>

/**
 * State-independent: echoes the authored modifier as a
 * {@link PactModifierOutput}. Whether it applies — the pact is in force — is
 * `collectPactBonuses`' call, which keeps the modifier verbatim.
 */
function apply(p: PactProductionModifierParams): PactModifierOutput {
  return { kind: 'pactModifier', modifier: { stage: p.stage, field: p.field, value: p.value } }
}

export const pactProductionModifier: EffectDef<PactProductionModifierParams> = {
  schema,
  apply,
  hosts: ['passivePact', 'activePact'],
}
