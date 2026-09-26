import { z } from 'zod'

import type { EffectDef, TimeFactorBoostOutput } from '../types.js'

/**
 * Schema for the `timeFactorBoost` effect's params.
 *
 * A raise to a time clock's accrual rate: while the owning upgrade is held, the
 * clock named by `clock` gains `perMinute` on top of its own rate, per owned
 * level. Pairs with the `timeScaledModifier` that pays the clock out — a boost
 * naming a clock nobody pays out is inert, which is why `validateModeDefinition`
 * checks the id.
 *
 * The raise applies to **time from each level's purchase onward**, not to time
 * already elapsed, so buying the fifth level late is worth less than buying it
 * early — the pressure that makes a repeatable boost interesting rather than
 * something to stockpile currency for. `timeRetroactive` is the upgrade that buys
 * its way out of that rule.
 *
 * Because the levels are dated individually, the owned-count folding every other
 * collector does up front cannot happen here: `collectTimeFactorBoosts` keeps the
 * levels apart and `timeBonusFraction` prices each one against its own purchase
 * time.
 */
const schema = z.strictObject({
  clock: z.string(),
  perMinute: z.number().gt(0),
})

/** Params for the `timeFactorBoost` effect (inferred from its schema). */
export type TimeFactorBoostParams = z.infer<typeof schema>

/**
 * State-independent: echoes the authored raise as a {@link TimeFactorBoostOutput}.
 * The level dating, the retroactive rule, and the accrual itself all happen in
 * `timeBonusFraction`, which owns this output.
 */
function apply(p: TimeFactorBoostParams): TimeFactorBoostOutput {
  return { kind: 'timeFactorBoost', clock: p.clock, perMinute: p.perMinute }
}

export const timeFactorBoost: EffectDef<TimeFactorBoostParams> = { schema, apply }
