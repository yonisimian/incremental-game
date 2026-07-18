import { z } from 'zod'

import type { ModeDefinition } from '../../modes/types.js'
import type { Modifier } from '../../modifiers/types.js'
import type { PlayerState } from '../../types.js'
import type { EffectDef } from '../types.js'

/**
 * Schema for the `dominantGenerator` effect's params.
 *
 * "The generator with the highest amount gains an additional boost": the single
 * generator holding the maximum owned count is multiplied by `multiplier`. Ties
 * are broken deterministically in favor of the earliest generator in definition
 * order.
 */
const schema = z.strictObject({
  multiplier: z.number(),
})

/** Params for the `dominantGenerator` effect (inferred from its schema). */
export type DominantGeneratorParams = z.infer<typeof schema>

/**
 * Emits a single multiplicative modifier for the generator holding the maximum
 * owned count; `null` when no generators are owned. This function is stateless,
 * so ties are resolved deterministically by definition order: the earliest
 * generator in `mode.generators` among those at the maximum wins the bonus.
 */
function apply(
  p: DominantGeneratorParams,
  state: Readonly<PlayerState>,
  mode: ModeDefinition,
): Modifier[] | null {
  let max = 0
  let leaderId: string | null = null

  for (const gen of mode.generators) {
    const owned = state.generators[gen.id] ?? 0
    if (owned > max) {
      max = owned
      leaderId = gen.id
    }
  }

  if (max <= 0 || leaderId === null) return null
  return [{ stage: 'multiplicative', field: leaderId, value: p.multiplier }]
}

export const dominantGenerator: EffectDef<DominantGeneratorParams> = { schema, apply }
