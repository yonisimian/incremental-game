import { z } from 'zod'

import type { BatteryBandOutput, EffectDef } from '../types.js'

/** Which end of the tank a `batteryBand` bonus pays out in. */
export const BATTERY_BANDS = ['high', 'low'] as const
export type BatteryBandSide = (typeof BATTERY_BANDS)[number]

/**
 * Schema for the `batteryBand` effect's params.
 *
 * A conditional bonus to the highlight battery's factor, paid only while the
 * charge sits inside one end of the tank: `high` while at or above `threshold`
 * of capacity, `low` while at or below it. `threshold` is a fraction of capacity,
 * strictly inside `(0, 1)` — at `0` or `1` one side would cover the whole tank
 * and the band would be an unconditional factor bump, which is what `batteryStat`
 * is for.
 *
 * This is how the two mutually-exclusive "more power at high/low charge" picks
 * are expressed, and the pair is deliberately *rewarding opposite play patterns*
 * rather than trading one off against the other:
 *
 *  - `high` pays while the tank is nearly full — short bursts of highlighting,
 *    released early to top back up.
 *  - `low` pays while the tank is nearly empty — long holds, run down to the wire.
 *
 * Both are strict gains on top of the base factor, so neither pick is a
 * downgrade; which one is better depends on how the player likes to play.
 */
const schema = z.strictObject({
  band: z.enum(BATTERY_BANDS),
  threshold: z.number().gt(0).lt(1),
  bonus: z.number().gt(0),
})

/** Params for the `batteryBand` effect (inferred from its schema). */
export type BatteryBandParams = z.infer<typeof schema>

/**
 * State-independent: echoes the authored band as a {@link BatteryBandOutput}.
 * Whether the charge is currently inside it — and the owned-count scaling — is
 * decided by `collectBatteryBands` / `batteryFactor`, which own this output.
 */
function apply(p: BatteryBandParams): BatteryBandOutput {
  return { kind: 'batteryBand', band: p.band, threshold: p.threshold, bonus: p.bonus }
}

export const batteryBand: EffectDef<BatteryBandParams> = { schema, apply }
