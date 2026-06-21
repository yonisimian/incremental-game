import { z } from 'zod'

import type { ModeDefinition } from '../../modes/types.js'
import type { Modifier } from '../../modifiers/types.js'
import type { PlayerState } from '../../types.js'
import type { EffectDef } from '../types.js'

/**
 * Schema for the `dominantGenerator` effect's params.
 *
 * "The generator with the highest amount gains an additional boost": the
 * generator(s) holding the maximum owned count are multiplied by `multiplier`.
 * Ties all receive the boost.
 */
const schema = z.strictObject({
  multiplier: z.number(),
})

/** Params for the `dominantGenerator` effect (inferred from its schema). */
export type DominantGeneratorParams = z.infer<typeof schema>

/**
 * Emits a multiplicative modifier for every generator tied at the maximum owned
 * count; `null` when no generators are owned. Multi-modifier return covers ties.
 */
function apply(
  p: DominantGeneratorParams,
  state: Readonly<PlayerState>,
  mode: ModeDefinition,
): Modifier[] | null {
  let max = 0
  for (const gen of mode.generators) {
    max = Math.max(max, state.generators[gen.id] ?? 0)
  }
  if (max <= 0) return null
  return mode.generators
    .filter((gen) => (state.generators[gen.id] ?? 0) === max)
    .map((gen) => ({ stage: 'multiplicative', field: gen.id, value: p.multiplier }))
}

export const dominantGenerator: EffectDef<DominantGeneratorParams> = { schema, apply }
