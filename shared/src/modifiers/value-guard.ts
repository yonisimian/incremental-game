import type { ModifierStage } from './types.js'

/**
 * Whether a modifier's `value` *helps* its target (`bonus`) or *hurts* it
 * (`debuff`). The two differ in which side of the stage-neutral point counts as
 * meaningful.
 */
export type ModifierIntent = 'bonus' | 'debuff'

/** The `stage` + `value` a guard reads — a structural subset of a full modifier. */
interface StageValue {
  readonly stage: ModifierStage
  readonly value: number
}

/**
 * Whether `value` is a meaningful modifier of the given `intent` at `stage`.
 *
 * The neutral point is stage-dependent: `additive` is neutral at `0` and
 * `multiplicative` at `1`. A `bonus` must sit above its neutral point; a `debuff`
 * below it (and, for multiplicative, above `0` — a factor of `0` zeros the target
 * rather than scaling it down).
 */
function isMeaningfulModifierValue(
  intent: ModifierIntent,
  stage: ModifierStage,
  value: number,
): boolean {
  if (intent === 'bonus') {
    return stage === 'additive' ? value > 0 : value > 1
  }
  return stage === 'additive' ? value < 0 : value > 0 && value < 1
}

/**
 * Floor a scaled multiplicative debuff saturates at.
 *
 * Not `0`: a factor of `0` *zeros* the victim's production rather than scaling it
 * down — the precise case {@link isMeaningfulModifierValue} refuses to let anyone
 * author — and a large enough `power` would otherwise reach it (an authored `0.9`
 * at `power 10` resolves to exactly `0`). With a floor the mechanic saturates
 * instead of deleting the opponent.
 */
export const MIN_DEBUFF_FACTOR = 0.05

/**
 * Scale an authored debuff `value` by an attack's `power`, stage-aware.
 *
 * "Twice as strong" scales the **distance from the stage's neutral point**, not
 * the raw value: a `multiplicative` debuff of `0.9` is a 10% penalty, so twice
 * that is `0.8`, not `1.8`. Scaling the value itself would invert the mechanic
 * the moment `power` exceeds `1` — and sail straight past
 * {@link guardModifierValue}, which only ever sees the *authored* value at load.
 * It is the same convention the cost curve already uses (a `scalingFactor`
 * multiplies the growth portion, `costScaling - 1`, not the whole scaling).
 *
 * `additive` is neutral at `0`, so its distance is the value itself;
 * `multiplicative` is neutral at `1` and clamps to
 * `[MIN_DEBUFF_FACTOR, 1]` — the upper bound keeps a `power` below `1` weakening
 * the debuff *toward* neutral without ever crossing it into a bonus.
 */
export function scaleDebuffValue(stage: ModifierStage, value: number, power: number): number {
  if (stage === 'additive') return value * power
  return Math.min(1, Math.max(MIN_DEBUFF_FACTOR, 1 - (1 - value) * power))
}

/**
 * The cost-path twin of {@link scaleDebuffValue}: scale an authored cost
 * inflation factor (`costFactor` / `scalingFactor`, both `>= 1`) by an attack's
 * `power`.
 *
 * Same neutral-point arithmetic, with `1` as the neutral point and no ceiling —
 * a price can inflate without bound, so only the floor matters: a `power` of `0`
 * (or below) resolves to `1`, i.e. no inflation, never a discount for the victim.
 */
export function scaleCostFactor(factor: number, power: number): number {
  return Math.max(1, 1 + (factor - 1) * power)
}

// ─── Scaled stats ────────────────────────────────────────────────────

/**
 * Which way a *scaled stat* — one whose ops shape a multiplier on a value some
 * other definition authored — has to move to help the player who bought it.
 *
 * The per-stat analogue of {@link ModifierIntent}, and deliberately not the same
 * shape: an `intent` is authored per modifier, because one effect can
 * legitimately grant a bonus (to you) or a debuff (to the enemy). A stat's
 * helpful direction is instead a property of the *stat* — `power` helps by
 * growing, `prepareCost` by shrinking — so it belongs in a table beside the
 * stat's enum, not in a param every ref must remember to set.
 */
export type StatDirection = 'increase' | 'decrease'

/**
 * How a scaled-stat adjustment combines with the authored value: `add` and
 * `mult` shape the multiplier (neutral at `0` and `1` respectively), `offset`
 * shifts the stat's own unit (neutral at `0`).
 *
 * Declared structurally rather than imported from the effect seeds, which sit
 * *above* this module and import it.
 */
export type ScaledStatOp = 'add' | 'mult' | 'offset'

/** The `stat` + `op` + `value` a scaled-stat guard reads. */
interface StatOpValue {
  readonly stat: string
  readonly op: ScaledStatOp
  readonly value: number
}

/**
 * The largest magnitude a scaled-stat value may carry.
 *
 * A typo catch, not a balance bound: `mult` compounds as `value ** owned`, so a
 * slipped exponent (`1e200` for `1e2`) resolves to `Infinity` and drags `NaN`
 * into anything that then multiplies it by zero. Nothing authorable comes near
 * `1e6`. The *guarantee* of a finite parameter belongs to each collector's
 * clamp, which sees the resolved product; this only refuses the obvious typo
 * while the author is still looking at it.
 */
export const MAX_SCALED_STAT_VALUE = 1e6

/**
 * Whether `value` moves a stat of `direction` the helpful way, given its `op`.
 *
 * Each op's neutral point is excluded, so a no-op (`add: 0`, `mult: 1`,
 * `offset: 0`) fails as the "wrong direction" it is — an upgrade that buys
 * nothing. `mult` additionally excludes everything at or below `0`: a `0`
 * collapses the stat for every owned count and no later upgrade can lift it
 * back, and a negative base flips sign with the parity of the owned count
 * (`(-2) ** 1` is `-2`, `(-2) ** 2` is `4`).
 *
 * A `decrease` `add` is bounded below at `-1` as well as above at `0`: the
 * multiplier resolves as `1 + value × owned`, so `-1` already zeroes it at a
 * single copy and anything beyond that is an inversion the collector's floor
 * merely hides.
 */
function isHelpfulStatValue(direction: StatDirection, op: ScaledStatOp, value: number): boolean {
  if (op === 'mult') return direction === 'increase' ? value > 1 : value > 0 && value < 1
  if (op === 'add') return direction === 'increase' ? value > 0 : value > -1 && value < 0
  return direction === 'increase' ? value > 0 : value < 0
}

/** Human phrase describing the required range, for the validation message. */
function statConstraintPhrase(direction: StatDirection, op: ScaledStatOp): string {
  if (op === 'mult') return direction === 'increase' ? 'be greater than 1' : 'be between 0 and 1'
  if (op === 'add') return direction === 'increase' ? 'be greater than 0' : 'be between -1 and 0'
  return direction === 'increase' ? 'be greater than 0' : 'be negative'
}

/**
 * Build a zod `superRefine` callback that rejects a scaled-stat `value` pointing
 * the wrong way for its stat (see {@link isHelpfulStatValue}) or carrying an
 * implausible magnitude ({@link MAX_SCALED_STAT_VALUE}). `label` names the effect
 * in the message; `directions` is the effect's own stat → direction table.
 *
 * The counterpart of {@link guardModifierValue} for the "upgrades move a
 * subsystem's parameters" family, and it exists for the same reason: an
 * upgrade-hosted effect helps the player who bought it, and the schema is the
 * cheapest place to say so. Applied object-level, so the wrapped schema keeps
 * its `object` shape for the `/dev.html` form introspection.
 */
export function guardScaledStatValue(
  label: string,
  directions: Readonly<Record<string, StatDirection>>,
): (p: StatOpValue, ctx: RefinementIssueSink) => void {
  return (p, ctx) => {
    const direction = directions[p.stat] as StatDirection | undefined
    // An unrecognized stat is the enum's to reject; guarding it here would
    // report a direction problem for what is really a typo.
    if (direction === undefined) return
    const moving = direction === 'increase' ? 'increasing' : 'decreasing'
    if (!isHelpfulStatValue(direction, p.op, p.value)) {
      ctx.addIssue({
        code: 'custom',
        message: `${label} '${p.stat}' is improved by ${moving} it, so an '${p.op}' value must ${statConstraintPhrase(direction, p.op)}; got ${p.value}`,
        path: ['value'],
      })
      return
    }
    if (Math.abs(p.value) > MAX_SCALED_STAT_VALUE) {
      ctx.addIssue({
        code: 'custom',
        message: `${label} '${p.stat}' value is implausibly large — an '${p.op}' compounds with the owned count, so |value| must be at most ${MAX_SCALED_STAT_VALUE}; got ${p.value}`,
        path: ['value'],
      })
    }
  }
}

// ─── Modifier values ─────────────────────────────────────────────────

/** Human phrase describing the required range, for the validation message. */
function constraintPhrase(intent: ModifierIntent, stage: ModifierStage): string {
  if (intent === 'bonus') {
    return stage === 'additive' ? 'be greater than 0' : 'be greater than 1'
  }
  return stage === 'additive' ? 'be negative' : 'be between 0 and 1'
}

/** Minimal view of zod's refinement context — just the issue sink a guard needs. */
interface RefinementIssueSink {
  addIssue(issue: { code: 'custom'; message: string; path: (string | number)[] }): void
}

/**
 * Build a zod `superRefine` callback that rejects a modifier `value` that is a
 * no-op or the wrong sign for its `intent`, stage-aware (see
 * {@link isMeaningfulModifierValue}). `label` names the schema in the error
 * message (e.g. `'baseModifier'`); the issue is attached to the `value` path so
 * the schema-driven editor form surfaces it on the right field.
 *
 * Because it is applied via an object-level `superRefine`, the wrapped schema
 * keeps its `object` shape — the `/dev.html` effect-form introspection (which
 * reads `schema.def`) is unaffected.
 */
export function guardModifierValue(
  intent: ModifierIntent,
  label: string,
): (m: StageValue, ctx: RefinementIssueSink) => void {
  return (m, ctx) => {
    if (isMeaningfulModifierValue(intent, m.stage, m.value)) return
    ctx.addIssue({
      code: 'custom',
      message: `${m.stage} ${label} value must ${constraintPhrase(intent, m.stage)} (a ${intent}); got ${m.value}`,
      path: ['value'],
    })
  }
}
