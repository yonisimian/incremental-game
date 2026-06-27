import { z } from 'zod'

import type { BaseModifierOutput } from '../types.js'
import type { EffectDef } from '../types.js'

/**
 * Schema for the `baseModifier` effect's params.
 *
 * The flat per-upgrade production bonus: while the owning upgrade is held, apply
 * `value` to `field` at the given pipeline `stage`. `field` may name a resource
 * (e.g. `r0`), a generator (e.g. `g0`), or `clickIncome` / `globalMultiplier` —
 * matching what the legacy `modifiers` array accepted. The owned-count
 * compounding happens in `collectModifiers`, which owns the
 * {@link BaseModifierOutput} kind.
 */
const schema = z.strictObject({
  stage: z.enum(['additive', 'multiplicative', 'global']),
  field: z.string(),
  value: z.number(),
})

/** Params for the `baseModifier` effect (inferred from its schema). */
export type BaseModifierParams = z.infer<typeof schema>

/**
 * State-independent: echoes the authored bonus as a {@link BaseModifierOutput}.
 * The owned-count compounding and generator-target routing happen in
 * `collectModifiers`, which owns this output.
 */
function apply(p: BaseModifierParams): BaseModifierOutput {
  return { kind: 'baseModifier', stage: p.stage, field: p.field, value: p.value }
}

export const baseModifier: EffectDef<BaseModifierParams> = { schema, apply }
