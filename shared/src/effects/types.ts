import type { ZodType } from 'zod'

import type { Modifier } from '../modifiers/types.js'
import type { ModeDefinition } from '../modes/types.js'
import type { PlayerState } from '../types.js'

/**
 * A reduction to a generator's cost curve, emitted by a cost-track effect.
 *
 * Unlike a {@link Modifier} (which feeds the production pipeline), this output
 * is consumed by `collectGeneratorCostFactors` to reshape a generator's
 * `baseCost` / `costScaling`. Both factors default to `1` (no change) when
 * omitted and compound with the owning upgrade's owned count.
 */
export interface GeneratorCostOutput {
  readonly kind: 'generatorCost'
  /** Which generator this reduction applies to (matches `GeneratorDefinition.id`). */
  readonly generator: string
  /** Multiplies the generator's base cost (e.g. `0.95` = 5% cheaper). */
  readonly costFactor?: number
  /** Multiplies the growth portion (`costScaling - 1`) of the cost curve. */
  readonly scalingFactor?: number
}

/**
 * Marks a UI panel as unlocked while the owning upgrade is held. Consumed by
 * `isPanelUnlocked` (a panel with no such output for it is always available);
 * carries no production weight, so the modifier pipeline ignores it.
 */
export interface PanelUnlockOutput {
  readonly kind: 'panelUnlock'
  /** Stable panel id this upgrade reveals (matches the client `Panel.id`). */
  readonly panel: string
}

/**
 * Marks a generator as unlocked while the owning upgrade is held. Consumed by
 * `isGeneratorUnlocked` (a generator that no such output names is always
 * available); carries no production weight, so the modifier pipeline ignores it.
 */
export interface GeneratorUnlockOutput {
  readonly kind: 'generatorUnlock'
  /** Stable generator id this upgrade reveals (matches `GeneratorDefinition.id`). */
  readonly generator: string
}

/**
 * Marks an input system (clicking / highlighting) as unlocked while the owning
 * upgrade is held. Consumed by `isClickUnlocked` / `isHighlightActive` (a system
 * that no such output names is always available); carries no production weight,
 * so the modifier pipeline ignores it.
 */
export interface SystemUnlockOutput {
  readonly kind: 'systemUnlock'
  /** Which input system this upgrade reveals (`'click'` or `'highlight'`). */
  readonly system: string
}

/**
 * Grants the viewer visibility into one slice of the opponent's state while the
 * owning upgrade is held. Consumed by `hasEnemyDataAccess` (which checks the
 * *viewer's* owned upgrades, mirroring `isPanelUnlocked`); carries no production
 * weight, so the modifier pipeline ignores it.
 *
 * Opponent state is already broadcast in full each tick, so this gates
 * *visibility* (UI), not delivery. `data` keys a slice of opponent intel: a
 * resource key (e.g. `'r0'`) reveals that resource's stockpile, and the
 * `':rate'`-suffixed form (e.g. `'r0:rate'`) reveals its per-second production
 * (derived client-side from the opponent's broadcast state).
 */
export interface EnemyDataAccessOutput {
  readonly kind: 'enemyDataAccess'
  /** Which slice of opponent intel this upgrade reveals (e.g. `'r0'` or `'r0:rate'`). */
  readonly data: string
}

/**
 * What an effect's `apply` can emit: a production {@link Modifier}, a
 * {@link GeneratorCostOutput}, one of the unlock outputs ({@link
 * PanelUnlockOutput}, {@link GeneratorUnlockOutput}, {@link SystemUnlockOutput}),
 * or an {@link EnemyDataAccessOutput}. Each is routed to a different subsystem
 * (`collectModifiers` / `collectGeneratorCostFactors` / the unlock gates /
 * `hasEnemyDataAccess`); every consumer ignores the outputs it doesn't own.
 */
export type EffectOutput =
  | Modifier
  | GeneratorCostOutput
  | PanelUnlockOutput
  | GeneratorUnlockOutput
  | SystemUnlockOutput
  | EnemyDataAccessOutput

/**
 * A registered effect: a zod schema describing its params, plus how to turn
 * parsed params into a modifier at runtime.
 *
 * The schema is the single source of truth for an effect's param shape: the
 * registry validates raw refs against it (so malformed data is rejected at the
 * trust boundary), and the Phase 6 editor can introspect it to generate a form.
 */
export interface EffectDef<P> {
  /**
   * Validates a ref's params (the ref minus its `type` discriminant) and narrows
   * them to `P`. Throws (`ZodError`) on malformed input.
   */
  readonly schema: ZodType<P>
  /**
   * Pure: produce output(s) from params + state + mode, or `null` when inactive.
   *
   * Returns a single {@link EffectOutput}, an array (for effects that touch
   * several fields at once, e.g. generator-synergy effects), or `null`. The
   * `mode` argument gives topology-aware effects access to the generator list
   * and resource keys.
   */
  readonly apply: (
    params: P,
    state: Readonly<PlayerState>,
    mode: ModeDefinition,
  ) => EffectOutput | readonly EffectOutput[] | null
}
