import { z } from 'zod'

import { parseEnemyCostTarget } from '../addressable.js'
import type { EffectDef, EnemyCostOutput } from '../types.js'

/**
 * Schema for the `enemyCostModifier` effect's params.
 *
 * An *offensive* cost inflation carried by a passive attack: while the attack is
 * unlocked, the opponent pays more for what `target` names. `target` is a key
 * from the enemy-cost catalog — `upgrades` / `generators` for a whole scope, or
 * `upgrade:<id>` / `generator:<id>` for one entity. Like `baseModifier`'s
 * `field` it's a plain `z.string()` so the schema-driven editor form can
 * introspect it; the `/dev.html` picker offers only catalog keys and
 * `validateModeDefinition` rejects the rest at load, so an authored typo fails
 * loudly rather than producing an attack that does nothing.
 *
 *  - `target: "upgrades", costFactor: 1.25` — every upgrade costs the opponent
 *    25% more;
 *  - `target: "generator:g0", scalingFactor: 1.1` — their first generator's
 *    price curve grows 10% faster, base price unchanged.
 *
 * Both factors are `>= 1`: on a *friendly* `generatorCost` upgrade a factor
 * below 1 is the whole point, but on an attack it would gift the victim a
 * discount, which is never intended authoring (the same reasoning as
 * `guardModifierValue`'s debuff intent). At least one must be present — a ref
 * setting neither would be a no-op.
 */
const schema = z
  .strictObject({
    target: z.string(),
    costFactor: z.number().min(1).optional(),
    scalingFactor: z.number().min(1).optional(),
  })
  .refine((p) => p.costFactor !== undefined || p.scalingFactor !== undefined, {
    message:
      'enemyCostModifier must set costFactor or scalingFactor (a ref setting neither is inert)',
    path: ['costFactor'],
  })

/** Params for the `enemyCostModifier` effect (inferred from its schema). */
export type EnemyCostModifierParams = z.infer<typeof schema>

/**
 * State-independent: splits the authored target and echoes the inflation as an
 * {@link EnemyCostOutput}. Whether it actually applies (the attack is an
 * unlocked passive one held by the *other* player) is decided by
 * `collectEnemyCostFactors`, which owns this output. Unlike `baseModifier` there
 * is no owned-count compounding — an attack is unlocked or it isn't.
 */
function apply(p: EnemyCostModifierParams): EnemyCostOutput | null {
  const parsed = parseEnemyCostTarget(p.target)
  if (!parsed) return null
  return {
    kind: 'enemyCost',
    scope: parsed.scope,
    id: parsed.id,
    costFactor: p.costFactor,
    scalingFactor: p.scalingFactor,
  }
}

export const enemyCostModifier: EffectDef<EnemyCostModifierParams> = {
  schema,
  apply,
  // Only `collectEnemyCostFactors` reads this output, and it walks the *passive*
  // attacks a player holds — anywhere else the inflation would never be gathered.
  hosts: ['passiveAttack'],
}
