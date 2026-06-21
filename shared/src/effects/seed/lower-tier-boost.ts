import { z } from 'zod'

import type { ModeDefinition } from '../../modes/types.js'
import type { Modifier } from '../../modifiers/types.js'
import type { PlayerState } from '../../types.js'
import type { EffectDef } from '../types.js'

/**
 * Schema for the `lowerTierBoost` effect's params.
 *
 * "Lower-tier generators boost higher tiers": each generator is multiplied by
 * `1 + perUnit * (units owned across all lower-tier generators)`. Tier order is
 * the order generators appear in `mode.generators`.
 */
const schema = z.strictObject({
  perUnit: z.number(),
})

/** Params for the `lowerTierBoost` effect (inferred from its schema). */
export type LowerTierBoostParams = z.infer<typeof schema>

/**
 * Emits one multiplicative modifier per higher-tier generator that owns units
 * and has at least one lower-tier unit to draw from. Multi-modifier return: a
 * single effect touches several generator fields at once.
 */
function apply(
  p: LowerTierBoostParams,
  state: Readonly<PlayerState>,
  mode: ModeDefinition,
): Modifier[] {
  const mods: Modifier[] = []
  let lowerOwned = 0
  for (const gen of mode.generators) {
    const owned = state.generators[gen.id] ?? 0
    if (lowerOwned > 0 && owned > 0) {
      mods.push({ stage: 'multiplicative', field: gen.id, value: 1 + p.perUnit * lowerOwned })
    }
    lowerOwned += owned
  }
  return mods
}

export const lowerTierBoost: EffectDef<LowerTierBoostParams> = { schema, apply }
