import { z } from 'zod'

import type { EffectDef, TimeRetroactiveOutput } from '../types.js'

/**
 * Schema for the `timeRetroactive` effect's params.
 *
 * While the owning upgrade is held, every `timeFactorBoost` on the clock named by
 * `clock` counts from the clock's **start** instead of from its own level's
 * purchase — the time already elapsed is repriced at the current rate.
 *
 * One string param and no magnitude: the upgrade's whole payload is *which clock*
 * it repriced, and its worth is whatever the boosts bought so far were missing
 * out on. That makes it a natural cap-stone for a clock branch (buy the raises
 * first, then collect on all of them at once) and worthless bought alone, which
 * is why the idler gates it behind two levels of the boost.
 *
 * Owned count is irrelevant — retroactive is a state, not a quantity — so a
 * second level would add nothing, and the authored `purchaseLimit` should say so.
 */
const schema = z.strictObject({
  clock: z.string(),
})

/** Params for the `timeRetroactive` effect (inferred from its schema). */
export type TimeRetroactiveParams = z.infer<typeof schema>

/**
 * State-independent: echoes the authored clock as a {@link TimeRetroactiveOutput}.
 * Whether the flag is actually in force (the upgrade is owned) is decided by
 * `isTimeBonusRetroactive`, which owns this output.
 */
function apply(p: TimeRetroactiveParams): TimeRetroactiveOutput {
  return { kind: 'timeRetroactive', clock: p.clock }
}

export const timeRetroactive: EffectDef<TimeRetroactiveParams> = { schema, apply }
