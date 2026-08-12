import { z } from 'zod'

import type { BatteryStatOutput, EffectDef } from '../types.js'

/** The highlight-battery parameters a `batteryStat` effect can move. */
export const BATTERY_STATS = ['factor', 'maxCharge', 'chargeRate', 'drainRate'] as const
export type BatteryStat = (typeof BATTERY_STATS)[number]

/** How a `batteryStat` adjustment combines with the current value. */
const BATTERY_STAT_OPS = ['add', 'mult'] as const
export type BatteryStatOp = (typeof BATTERY_STAT_OPS)[number]

/**
 * Schema for the `batteryStat` effect's params.
 *
 * Moves one of the highlight battery's parameters while the owning upgrade is
 * held: its peak `factor`, its `maxCharge` capacity, or its `chargeRate` /
 * `drainRate`. `op` picks how — `add` shifts the value, `mult` scales it — and
 * both compound with the owned count (`add × owned`, `mult ** owned`) in
 * `collectBatteryParams`.
 *
 * One effect with a `stat` enum rather than four near-identical effects: a closed
 * enum rejects an authored typo at boot, generates one editor form instead of
 * four, and keeps the owned-count folding in a single place.
 *
 * `value` is deliberately unconstrained beyond finiteness — the meaningful range
 * differs per `stat` and per `op` (`mult` of `0.9` is a *good* thing on
 * `drainRate` and a bad one on `factor`), so a single guard here would either be
 * wrong for half the combinations or reject legitimate authoring.
 * `collectBatteryParams` clamps the resolved parameters to their floors, so a
 * mis-authored value is inert rather than inverting the mechanic.
 */
const schema = z.strictObject({
  stat: z.enum(BATTERY_STATS),
  op: z.enum(BATTERY_STAT_OPS),
  value: z.number(),
})

/** Params for the `batteryStat` effect (inferred from its schema). */
export type BatteryStatParams = z.infer<typeof schema>

/**
 * State-independent: echoes the authored adjustment as a
 * {@link BatteryStatOutput}. The owned-count compounding, cross-upgrade stacking,
 * and clamping all happen in `collectBatteryParams`, which owns this output.
 */
function apply(p: BatteryStatParams): BatteryStatOutput {
  return { kind: 'batteryStat', stat: p.stat, op: p.op, value: p.value }
}

export const batteryStat: EffectDef<BatteryStatParams> = { schema, apply }
