/** A single declarative modifier — pure data, serializable. */
export interface Modifier {
  readonly stage: 'additive' | 'multiplicative' | 'global'
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
