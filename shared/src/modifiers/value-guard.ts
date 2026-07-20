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
