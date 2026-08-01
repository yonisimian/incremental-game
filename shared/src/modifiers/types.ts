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
   * The production field to target, interpreted by the pipeline:
   *  - `clickIncome` — the standalone click income track.
   *  - `bK` (e.g. `b0`) — the **base producer** of the K-th declared resource
   *    (native floor + `b`-targeted upgrades); isolated so a base boost never
   *    leaks into generator output.
   *  - a resource id (e.g. `r0`) — the resource's **global** layer: all of its
   *    production (base + every generator), what a "boost everything" effect and
   *    folded generator output both feed.
   *  - a generator id (e.g. `g0`) — a single generator, folded into its per-unit
   *    total by `collectModifiers` before it ever reaches the pipeline.
   */
  readonly field: string
  /**
   * For additive: the flat value to add.
   * For multiplicative/global: the factor to multiply by.
   */
  readonly value: number
}

/**
 * The additive + multiplicative accumulators for one production layer of a
 * resource. Neutral element is `{ add: 0, mult: 1 }`; a layer contributes
 * `add · mult`.
 */
export interface LayerAccumulator {
  add: number
  mult: number
}

/**
 * The two production layers of a single resource. The final rate combines them:
 * `(base.add·base.mult + global.add) · global.mult`.
 *
 * - `base`: the isolated **base producer** — native floor plus `bK`-targeted
 *   modifiers. `base.mult` scales *only* this layer, so a base boost cannot
 *   reach generator output.
 * - `global`: everything else that is production of this resource — folded
 *   generator output and `rK`-targeted ("affect everything") modifiers.
 *   `global.mult` wraps the base subtotal too, so a global boost scales base
 *   *and* generators.
 *
 * There is deliberately no separate "generator" layer: no effect targets the
 * generator *aggregate* (per-generator bonuses are folded in `collectModifiers`),
 * so an aggregate multiplier would have no emitter — generator output is simply
 * additive into `global`.
 */
export interface ResourceLayers {
  base: LayerAccumulator
  global: LayerAccumulator
}

/** Result of running the modifier pipeline. */
export interface ModifierContext {
  /** Income per manual click (0 if clicks disabled). */
  clickIncome: number
  /** Per-resource production layers, keyed by resource id. */
  resources: Record<string, ResourceLayers>
}
