import { z } from 'zod'

import { MODIFIER_STAGES } from '../../modifiers/types.js'
import { guardModifierValue } from '../../modifiers/value-guard.js'
import type { PlayerState } from '../../types.js'
import type { ClickIncomeOutput, EffectDef } from '../types.js'
import { readSourceValue } from '../addressable.js'

const guardValue = guardModifierValue('bonus', 'clickPower')

/**
 * Schema for the `clickPower` effect's params — the sole way to boost manual
 * click income (click income is its own axis, not a resource rate, so
 * `baseModifier` / `relativeModifier` can no longer target it).
 *
 * Two mutually-exclusive shapes, discriminated by whether `source` is present:
 *
 * - **flat** — `{ stage, value }`: a fixed additive (`+value` per click) or
 *   multiplicative (`×value`) bonus. Compounds with the owning upgrade's owned
 *   count in `collectClickIncome` (× owned / ^ owned), like `baseModifier`.
 * - **state-relative** — `{ stage, source, factor? }`: read a scalar from
 *   `source` (a state field — see the addressable-source catalog), scale it by
 *   `factor` (default 1), and contribute it (additive: `v·factor`;
 *   multiplicative: `1 + v·factor`). Inactive when the source is non-positive.
 *
 * `globalMultiplier` from the modifier pipeline is applied on top by
 * `computeClickIncome`.
 */
const schema = z
  .strictObject({
    stage: z.enum(MODIFIER_STAGES),
    value: z.number().optional(),
    source: z.string().optional(),
    factor: z.number().gt(0).optional(),
  })
  .superRefine((p, ctx) => {
    const hasValue = p.value !== undefined
    const hasSource = p.source !== undefined
    if (hasValue === hasSource) {
      ctx.addIssue({
        code: 'custom',
        message: 'clickPower requires exactly one of `value` (flat) or `source` (state-relative)',
        path: [hasValue ? 'source' : 'value'],
      })
      return
    }
    if (p.factor !== undefined && !hasSource)
      ctx.addIssue({
        code: 'custom',
        message: '`factor` is only valid with `source`',
        path: ['factor'],
      })
    // A flat bonus must be a meaningful bonus for its stage (additive > 0,
    // multiplicative > 1); the state-relative form guards `factor` via `.gt(0)`.
    if (hasValue) guardValue({ stage: p.stage, value: p.value! }, ctx)
  })

/** Params for the `clickPower` effect (inferred from its schema). */
export type ClickPowerParams = z.infer<typeof schema>

/**
 * Emits a {@link ClickIncomeOutput}. The flat form echoes `value`; the
 * state-relative form reads `source` and normalizes per stage (`additive →
 * v·factor`, `multiplicative → 1 + v·factor`), returning `null` when the source
 * is non-positive or unrecognized (so a 0 source is inert, not a wipe). Owned-
 * count compounding happens in `collectClickIncome`.
 */
function apply(p: ClickPowerParams, state: Readonly<PlayerState>): ClickIncomeOutput | null {
  if (p.source !== undefined) {
    const v = readSourceValue(p.source, state)
    if (v === null || v <= 0) return null
    const factor = p.factor ?? 1
    const value = p.stage === 'additive' ? v * factor : 1 + v * factor
    return { kind: 'clickIncome', stage: p.stage, value }
  }
  return { kind: 'clickIncome', stage: p.stage, value: p.value! }
}

export const clickPower: EffectDef<ClickPowerParams> = { schema, apply }
