/**
 * The pipeline stages a modifier can target, in application order. The single
 * source of truth for the stage set — the `Modifier.stage` type and every schema
 * enum derive from this, so adding a stage is a one-line change here.
 */
export const MODIFIER_STAGES = ['additive', 'multiplicative'] as const

/** A pipeline stage a modifier targets, derived from {@link MODIFIER_STAGES}. */
export type ModifierStage = (typeof MODIFIER_STAGES)[number]

/** A single declarative modifier — pure data, serializable. */
export interface Modifier {
  readonly stage: ModifierStage
  /**
   * The resource or special field to target.
   * Fields matching a ModifierContext property ('clickIncome', 'globalMultiplier')
   * target it directly; all other fields target rates[field].
   */
  readonly field: string
  /**
   * For additive: the flat value to add.
   * For multiplicative/global: the factor to multiply by.
   */
  readonly value: number
}

/** Result of running the modifier pipeline. */
export interface ModifierContext {
  /** Income per manual click (0 if clicks disabled). */
  clickIncome: number
  /** Passive rates per second, keyed by resource name. */
  rates: Record<string, number>
  /** Global multiplier (prestige, perks — 1.0 for now). */
  globalMultiplier: number
}
