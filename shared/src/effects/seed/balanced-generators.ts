import { z } from 'zod'

import type { ModeDefinition } from '../../modes/types.js'
import type { Modifier } from '../../modifiers/types.js'
import type { PlayerState } from '../../types.js'
import type { EffectDef } from '../types.js'

/**
 * Schema for the `balancedGenerators` effect's params.
 *
 * "Gain a boost when all generators are owned in equal amounts": when every
 * generator holds the same (non-zero) owned count, a single global production
 * multiplier of `multiplier` applies.
 */
const schema = z.strictObject({
  multiplier: z.number(),
})

/** Params for the `balancedGenerators` effect (inferred from its schema). */
export type BalancedGeneratorsParams = z.infer<typeof schema>

/**
 * Returns a global multiplier when all generators are owned in equal, non-zero
 * amounts; `null` otherwise (including when no generators exist or any is unowned).
 */
function apply(
  p: BalancedGeneratorsParams,
  state: Readonly<PlayerState>,
  mode: ModeDefinition,
): Modifier | null {
  const gens = mode.generators
  if (gens.length === 0) return null
  const first = state.generators[gens[0].id] ?? 0
  if (first <= 0) return null
  for (const gen of gens) {
    if ((state.generators[gen.id] ?? 0) !== first) return null
  }
  return { stage: 'global', field: 'globalMultiplier', value: p.multiplier }
}

export const balancedGenerators: EffectDef<BalancedGeneratorsParams> = { schema, apply }
