import { z } from 'zod'

import type { GeneratorCostOutput } from '../types.js'
import type { EffectDef } from '../types.js'

/**
 * Schema for the `generatorCost` effect's params.
 *
 * The "price decrease" / "price factor decrease" track: while the owning upgrade
 * is owned, the named generator's cost curve is reduced. `costFactor` scales the
 * base cost (e.g. `0.95` = 5% cheaper); `scalingFactor` scales the growth portion
 * of `costScaling` (e.g. `0.98` = 2% slower price growth). Both default to `1`
 * (no change) and compound with the owning upgrade's owned count.
 */
const schema = z.strictObject({
  generator: z.string(),
  costFactor: z.number().optional(),
  scalingFactor: z.number().optional(),
})

/** Params for the `generatorCost` effect (inferred from its schema). */
export type GeneratorCostParams = z.infer<typeof schema>

/**
 * State-independent: echoes the authored reduction as a {@link GeneratorCostOutput}.
 * The owned-count compounding and multi-upgrade stacking happen in
 * `collectGeneratorCostFactors`, which owns this output.
 */
function apply(p: GeneratorCostParams): GeneratorCostOutput {
  return {
    kind: 'generatorCost',
    generator: p.generator,
    costFactor: p.costFactor,
    scalingFactor: p.scalingFactor,
  }
}

export const generatorCost: EffectDef<GeneratorCostParams> = { schema, apply }
