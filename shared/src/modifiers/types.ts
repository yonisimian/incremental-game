/**
 * The pipeline stages a modifier can target, in application order. The single
 * source of truth for the stage set — the `Modifier.stage` type and every schema
 * enum derive from this, so adding a stage is a one-line change here.
 */
export const MODIFIER_STAGES = ['additive', 'multiplicative'] as const

/** A pipeline stage a modifier targets, derived from {@link MODIFIER_STAGES}. */
export type ModifierStage = (typeof MODIFIER_STAGES)[number]

/**
 * The production *layer* a modifier targets — decoupled from {@link
 * MODIFIER_STAGES} (which is *when* it applies: additive vs multiplicative).
 * The single source of truth for the scope set — the `Modifier.scope` type and
 * every schema enum derive from this, so adding a scope is a one-line change.
 *
 * - `base`: a resource's native/floor production only (not generators), or the
 *   click-income floor. `field` = a resource id or `clickIncome`.
 * - `generator`: generator production. `field` = a specific generator id (that
 *   generator only) or a resource id (the aggregate of all generators producing
 *   it, gated on ≥1 owned generator).
 * - `global`: combined production. `field` = a resource id (all production of
 *   it, base + generators) or `globalMultiplier` (everything).
 *
 * `base` is first so tooling that defaults to the first member picks the safe,
 * non-leaking scope.
 */
export const MODIFIER_SCOPES = ['base', 'generator', 'global'] as const

/** A production layer a modifier targets, derived from {@link MODIFIER_SCOPES}. */
export type ModifierScope = (typeof MODIFIER_SCOPES)[number]

/** A single declarative modifier — pure data, serializable. */
export interface Modifier {
  readonly stage: ModifierStage
  /**
   * The production layer this modifier targets. Together with {@link field} it
   * decides where the value lands — see {@link MODIFIER_SCOPES}.
   */
  readonly scope: ModifierScope
  /**
   * The resource or special field to target, interpreted per {@link scope}.
   * `clickIncome`/`globalMultiplier` target those directly; a resource id
   * targets that resource's production layer; a generator id (only valid under
   * `generator` scope) targets that single generator.
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
 * resource. Neutral element is `{ add: 0, mult: 1 }`. A layer's contribution is
 * `add · mult`.
 */
export interface LayerAccumulator {
  add: number
  mult: number
}

/**
 * The three scoped layers for a single resource. The final rate combines them:
 * `((base.add·base.mult) + (generator.add·generator.mult) + global.add) ·
 * global.mult · globalMultiplier` — see {@link MODIFIER_SCOPES}.
 */
export interface ResourceLayers {
  /** Native/floor production of this resource (not generators). */
  base: LayerAccumulator
  /** Generator production of this resource (per-generator output is folded into `add`). */
  generator: LayerAccumulator
  /** `global`-scope modifiers targeting this resource (wrap base + generator). */
  global: LayerAccumulator
}

/** Result of running the modifier pipeline. */
export interface ModifierContext {
  /** Income per manual click (0 if clicks disabled), before `globalMultiplier`. */
  clickIncome: number
  /** Per-resource scoped layers, keyed by resource name. */
  resources: Record<string, ResourceLayers>
  /** Overall multiplier (the `globalMultiplier` field) — scales every rate and click income. */
  globalMultiplier: number
}
