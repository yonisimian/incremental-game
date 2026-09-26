import { z } from 'zod'

import { parsePurchaseTarget } from '../addressable.js'
import type { EffectDef, MirrorCostOutput } from '../types.js'

/**
 * Schema for the `mirrorCostModifier` effect's params.
 *
 * A *mirrored discount* carried by a pact: while the pact is in force, what
 * `target` names is cheaper for the beneficiary **for as long as the enemy is
 * ahead of them on it** — "they already bought what you are about to buy".
 * `target` is a key from the purchase-target catalog — `upgrades` /
 * `generators` for a whole scope, `purchases` for both, or `upgrade:<id>` /
 * `generator:<id>` for one entity — the same vocabulary `enemyCostModifier`
 * inflates with. Like that effect's `target` it
 * is a plain `z.string()` so the schema-driven editor form can introspect it;
 * the `/dev.html` picker offers only catalog keys and `validateModeDefinition`
 * rejects the rest at load.
 *
 *  - `target: "upgrades", costFactor: 0.75` — every upgrade the enemy owns more
 *    levels of costs the beneficiary 25% less;
 *  - `target: "generator:g2", scalingFactor: 0.8` — while the enemy has more
 *    sawmills, the beneficiary's sawmill price curve grows 20% slower.
 *
 * Both factors are strictly inside `(0, 1)`: a pact is a buff by definition,
 * so a factor at or above `1` would author a pact that penalizes its own
 * signatory (the mirror image of `enemyCostModifier`'s `>= 1`). At least one
 * must be present — a ref setting neither would be a no-op.
 *
 * The factor is per *entity*, not per level: buying five sawmills while the
 * enemy is one ahead discounts all five. Bounding it to the level gap would
 * push a level bound through every bulk-price path; accepted for v1.
 */
const schema = z
  .strictObject({
    target: z.string(),
    costFactor: z.number().positive().lt(1).optional(),
    scalingFactor: z.number().positive().lt(1).optional(),
  })
  .refine((p) => p.costFactor !== undefined || p.scalingFactor !== undefined, {
    message:
      'mirrorCostModifier must set costFactor or scalingFactor (a ref setting neither is inert)',
    path: ['costFactor'],
  })

/** Params for the `mirrorCostModifier` effect (inferred from its schema). */
export type MirrorCostModifierParams = z.infer<typeof schema>

/**
 * State-independent: splits the authored target and echoes the discount as a
 * {@link MirrorCostOutput}. Whether — and on which entities — it actually
 * applies is decided by `collectPactCostFactors`, which owns this output and is
 * the one place that can compare both players' levels. `apply` receives the
 * beneficiary's state by contract but has no use for it.
 */
function apply(p: MirrorCostModifierParams): MirrorCostOutput[] | null {
  const targets = parsePurchaseTarget(p.target)
  if (!targets) return null
  // `purchases` names both scopes, so it discounts each as its own output.
  return targets.map((t) => ({
    kind: 'mirrorCost',
    scope: t.scope,
    id: t.id,
    costFactor: p.costFactor,
    scalingFactor: p.scalingFactor,
  }))
}

export const mirrorCostModifier: EffectDef<MirrorCostModifierParams> = {
  schema,
  apply,
  // Passive only until active pacts have a lifecycle: on an active pact nothing reads it.
  hosts: ['passivePact'],
}
