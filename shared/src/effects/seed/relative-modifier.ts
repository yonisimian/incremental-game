import { z } from 'zod'

import type { Modifier } from '../../modifiers/types.js'
import type { PlayerState } from '../../types.js'
import type { EffectDef } from '../types.js'
import { readSourceValue } from '../addressable.js'

/**
 * Schema for the `relativeModifier` effect's params.
 *
 * The data-driven generalization of `peakCpsClickBonus`: read a scalar from
 * `source` (a state field — see the addressable-field catalog), scale it by
 * `factor`, and contribute it to `field` at the given pipeline `stage`.
 *
 * `source` is a namespaced key (`resource:r0` = a stockpile, `meta:peakCps` =
 * live peak CPS). `field` is a `Modifier` target (`clickIncome`,
 * `globalMultiplier`, a resource rate, or a generator). `factor` defaults to
 * `1`. `validateModeDefinition` rejects an unknown `source`/`field` at boot.
 *
 * Because it returns a raw {@link Modifier} (not a `baseModifier` output), the
 * value is applied verbatim — it does *not* compound with the owning upgrade's
 * owned count, matching `peakCpsClickBonus`.
 */
const schema = z.strictObject({
  source: z.string(),
  field: z.string(),
  stage: z.enum(['additive', 'multiplicative', 'global']),
  factor: z.number().optional(),
})

/** Params for the `relativeModifier` effect (inferred from its schema). */
export type RelativeModifierParams = z.infer<typeof schema>

/**
 * Reads `source` from state and emits a modifier on `field`. For `additive` the
 * value is `source × factor`; for `multiplicative`/`global` it's `1 + source ×
 * factor` (so a source of 0 is a no-op rather than zeroing income). Inactive
 * (returns `null`) when the source is non-positive or unrecognized — the same
 * guard `peakCpsClickBonus` uses, which also keeps a 0 source from neutralizing
 * a multiplicative target.
 */
function apply(p: RelativeModifierParams, state: Readonly<PlayerState>): Modifier | null {
  const v = readSourceValue(p.source, state)
  if (v === null || v <= 0) return null
  const factor = p.factor ?? 1
  const value = p.stage === 'additive' ? v * factor : 1 + v * factor
  return { stage: p.stage, field: p.field, value }
}

export const relativeModifier: EffectDef<RelativeModifierParams> = { schema, apply }
