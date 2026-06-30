import { z } from 'zod'

import type { EffectDef, EnemyModifierOutput } from '../types.js'

/**
 * Schema for the `enemyProductionModifier` effect's params.
 *
 * An *offensive* production modifier carried by an attack: while the attack is
 * unlocked, apply `value` to the **opponent's** `field` at the given pipeline
 * `stage`. `field` is a `Modifier` target (a resource rate, a generator output,
 * or `clickIncome` / `globalMultiplier`) — like `baseModifier`'s `field`, it's a
 * plain `z.string()` so the schema-driven editor form can introspect it; the
 * valid set is enforced by the editor dropdown and validated against the mode's
 * addressable targets at load (`validateModeDefinition`), so an authored typo
 * fails loudly.
 *
 * For a passive attack the modifier applies continuously while unlocked (e.g.
 * `field: "r0", stage: "multiplicative", value: 0.9` reduces the opponent's wood
 * production 10%). `collectEnemyDebuffs` owns the wiring; the effect itself only
 * describes the bonus.
 */
const schema = z.strictObject({
  stage: z.enum(['additive', 'multiplicative', 'global']),
  field: z.string(),
  value: z.number(),
})

/** Params for the `enemyProductionModifier` effect (inferred from its schema). */
export type EnemyProductionModifierParams = z.infer<typeof schema>

/**
 * State-independent: echoes the authored modifier as an
 * {@link EnemyModifierOutput}. Whether it actually applies (the attack is an
 * unlocked passive one held by the *other* player) is decided by
 * `collectEnemyDebuffs`, which owns this output. Unlike `baseModifier` there is
 * no owned-count compounding — an attack is unlocked or it isn't.
 */
function apply(p: EnemyProductionModifierParams): EnemyModifierOutput {
  return { kind: 'enemyModifier', modifier: { stage: p.stage, field: p.field, value: p.value } }
}

export const enemyProductionModifier: EffectDef<EnemyProductionModifierParams> = { schema, apply }
