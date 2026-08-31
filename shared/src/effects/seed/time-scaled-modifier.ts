import { z } from 'zod'

import { MODIFIER_STAGES, type Modifier } from '../../modifiers/types.js'
import { timeBonusFraction } from '../../time-bonus.js'
import type { PlayerState } from '../../types.js'
import type { ModeDefinition } from '../../modes/types.js'
import type { EffectDef } from '../types.js'

/**
 * Schema for the `timeScaledModifier` effect's params.
 *
 * The payout of a time clock: a bonus to `field` that grows by `perMinute` for
 * every minute since the `clock` upgrade was first bought, optionally capped at
 * `maxFactor`. `clock` names an upgrade id — normally the one carrying this very
 * effect, though pointing several payouts at one clock is how "all resources
 * gain" is authored (one ref per resource, same clock, one shared timer).
 *
 * `perMinute` is authored per *minute* rather than per second because that is the
 * unit the upgrade text is written in ("+10% per minute"); the accrual itself is
 * continuous.
 *
 * `maxFactor` caps the resulting multiplier (`3` = at most ×3), and the same
 * ceiling applies to the bonus of an `additive` target (at most `maxFactor − 1`).
 * Omit it for an uncapped clock — fine in a timed round, and deliberately a
 * choice rather than a default, since a `buy-upgrade` goal can run for ten
 * minutes.
 *
 * Because it returns a raw {@link Modifier} (not a `baseModifier` output) the
 * value is applied verbatim: the owning upgrade's owned count does *not* compound
 * it. Repeat purchases of a clock would be meaningless anyway — it has one start
 * time; a repeatable *raise* to it is what `timeFactorBoost` is for.
 */
const schema = z.strictObject({
  clock: z.string(),
  field: z.string(),
  stage: z.enum(MODIFIER_STAGES),
  perMinute: z.number().gt(0),
  maxFactor: z.number().gt(1).optional(),
})

/** Params for the `timeScaledModifier` effect (inferred from its schema). */
export type TimeScaledModifierParams = z.infer<typeof schema>

/**
 * Reads the clock's accrued bonus and emits a modifier on `field`. For `additive`
 * the value is the bonus itself; for `multiplicative` it's `1 + bonus` (so a
 * clock that has just started is a no-op rather than zeroing income). Inactive
 * (returns `null`) until the clock upgrade is bought — mirroring
 * `relativeModifier`, whose zero source is likewise inactive rather than neutral.
 */
function apply(
  p: TimeScaledModifierParams,
  state: Readonly<PlayerState>,
  mode: ModeDefinition,
): Modifier | null {
  const fraction = timeBonusFraction(state, mode, p.clock, p.perMinute)
  if (fraction === null || fraction <= 0) return null
  const bonus = p.maxFactor === undefined ? fraction : Math.min(fraction, p.maxFactor - 1)
  return { stage: p.stage, field: p.field, value: p.stage === 'additive' ? bonus : 1 + bonus }
}

export const timeScaledModifier: EffectDef<TimeScaledModifierParams> = {
  schema,
  apply,
  dynamic: true,
}
