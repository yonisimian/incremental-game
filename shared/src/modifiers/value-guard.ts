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
