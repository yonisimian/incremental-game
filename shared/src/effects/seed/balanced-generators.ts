import { z } from 'zod'

import type { ModeDefinition } from '../../modes/types.js'
import type { Modifier } from '../../modifiers/types.js'
import type { PlayerState } from '../../types.js'
import type { EffectDef } from '../types.js'

/**
 * Schema for the `balancedGenerators` effect's params.
 *
 * A global multiplicative production bonus applies when generator ownership is
 * balanced. The bonus scales from no bonus for a highly skewed spread to a full
 * `multiplier` when every generator has the same non-zero ownership.
 */
const schema = z.strictObject({
  multiplier: z.number().gt(1),
})

/** Params for the `balancedGenerators` effect (inferred from its schema). */
export type BalancedGeneratorsParams = z.infer<typeof schema>

/**
 * Returns a multiplicative multiplier that scales with how evenly generators are
 * owned. The bonus is `null` when there are no generators or when the average
 * ownership is zero.
 */
function apply(
  p: BalancedGeneratorsParams,
  state: Readonly<PlayerState>,
  mode: ModeDefinition,
): readonly Modifier[] | null {
  const gens = mode.generators
  if (gens.length === 0) return null

  const counts = gens.map((gen) => state.generators[gen.id] ?? 0)
  const total = counts.reduce((sum, count) => sum + count, 0)
  if (total <= 0) return null

  const avg = total / counts.length
  // Mean absolute deviation, normalized by the mean, gives a 0..1 skew measure;
  // balanceRatio is 1 at perfect equality and 0 once ownership is heavily skewed.
  const deviation = counts.reduce((sum, count) => sum + Math.abs(count - avg), 0) / counts.length
  const balanceRatio = Math.max(0, 1 - deviation / avg)
  if (balanceRatio <= 0) return null

  // Interpolate between no bonus (1) and the full `multiplier`. `multiplier < 1`
  // is clamped to a no-op — this effect only ever grants a bonus, never a penalty.
  const value = 1 + balanceRatio * Math.max(0, p.multiplier - 1)
  return mode.resources.map((resource) => ({
    stage: 'multiplicative',
    field: resource,
    value,
  }))
}

export const balancedGenerators: EffectDef<BalancedGeneratorsParams> = {
  schema,
  apply,
  dynamic: true,
}
