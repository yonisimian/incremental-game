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
 * A flat production bonus authored on an upgrade, emitted by the `baseModifier`
 * effect. Unlike a raw {@link Modifier} (emitted by state-derived effects and
 * applied verbatim), this output is **compounded with the owning upgrade's owned
 * count** by `collectModifiers` — additive scales `× owned`, multiplicative and
 * global scale `^ owned` — reproducing the legacy per-upgrade `modifiers` array.
 * Its `stage`/`field`/`value` mirror a `Modifier`; the distinct `kind` is what
 * tells the consumer to apply owned-count scaling.
 */
export interface BaseModifierOutput {
  readonly kind: 'baseModifier'
  readonly stage: Modifier['stage']
  readonly field: string
  readonly value: number
}

/**
 * Marks an attack as unlocked while the owning upgrade is held. Consumed by
 * `isAttackUnlocked` (an attack that no owned upgrade names is locked — unlike
 * panels, attacks are hidden by default); carries no production weight, so the
 * modifier pipeline ignores it. The attack itself has no behavior yet — this
 * only gates its appearance in the attack panel.
 */
export interface AttackUnlockOutput {
  readonly kind: 'attackUnlock'
  /** Stable attack id this upgrade reveals. */
  readonly attack: string
}

/**
 * Marks a pact as unlocked while the owning upgrade is held. Consumed by
 * `isPactUnlocked` (a pact that no owned upgrade names is locked — unlike
 * panels, pacts are hidden by default); carries no production weight, so the
 * modifier pipeline ignores it. The pact itself has no behavior yet — this
 * only gates its appearance in the international relationship panel.
 */
export interface PactUnlockOutput {
  readonly kind: 'pactUnlock'
  /** Stable pact id this upgrade reveals. */
  readonly pact: string
}

/**
 * An *offensive* production modifier: a {@link Modifier} that applies to the
 * **opponent's** pipeline rather than the owner's. Emitted by attack effects
 * (e.g. `enemyProductionModifier`) and consumed by `collectEnemyDebuffs`, which
 * gathers it from a player's *unlocked passive attacks* and feeds it into the
 * other player's production. The owner's own `collectModifiers` ignores it (it
 * would otherwise debuff the attacker), so the `enemyModifier` kind is the
 * routing tag that keeps it off the wrong pipeline.
 */
export interface EnemyModifierOutput {
  readonly kind: 'enemyModifier'
  /** The modifier to apply to the opponent's production pipeline. */
  readonly modifier: Modifier
}

/**
 * An instantaneous transfer from the *victim's* stockpile to the attacker,
 * emitted by the `stealResource` effect on an active attack. Unlike
 * {@link EnemyModifierOutput} (continuous, merged into the opponent's pipeline),
 * this is resolved once, at the moment the attack strikes, by
 * `resolveAttackStrike`; every other output consumer ignores it.
 *
 * The take is either a share of what the victim holds or a flat quantity — a
 * union rather than one optional-of-each field, so a consumer must branch on
 * which was authored instead of silently reading an absent one as `undefined`.
 * Either way `resolveAttackStrike` caps the transfer at the victim's balance.
 */
export type ResourceStealOutput = ResourceStealShare | ResourceStealFlat

/** Common shape of a steal, whatever the take is expressed as. */
interface ResourceStealBase {
  readonly kind: 'resourceSteal'
  /** Which resource is taken from the victim (a key in `mode.resources`). */
  readonly resource: string
}

/** Take a share of the victim's stockpile, e.g. `0.1` = 10%. */
interface ResourceStealShare extends ResourceStealBase {
  readonly fraction: number
}

/** Take a flat quantity, capped at what the victim holds. */
interface ResourceStealFlat extends ResourceStealBase {
  readonly amount: number
}

/**
 * What an effect's `apply` can emit: a production {@link Modifier}, a
 * {@link BaseModifierOutput}, a {@link GeneratorCostOutput}, one of the unlock
 * outputs ({@link PanelUnlockOutput}, {@link GeneratorUnlockOutput}, {@link
 * SystemUnlockOutput}, {@link AttackUnlockOutput}, {@link PactUnlockOutput}), an
 * {@link EnemyDataAccessOutput}, an {@link EnemyModifierOutput}, or a
 * {@link ResourceStealOutput}. Each is routed to a different subsystem
 * (`collectModifiers` / `collectGeneratorCostFactors` / the unlock gates /
 * `hasEnemyDataAccess` / `collectEnemyDebuffs` / `resolveAttackStrike`); every
 * consumer ignores the outputs it doesn't own.
 */
export type EffectOutput =
  | Modifier
  | BaseModifierOutput
  | GeneratorCostOutput
  | PanelUnlockOutput
  | GeneratorUnlockOutput
  | SystemUnlockOutput
  | AttackUnlockOutput
  | PactUnlockOutput
  | EnemyDataAccessOutput
  | EnemyModifierOutput
  | ResourceStealOutput

/**
 * Where an effect ref may be authored. Each host is read by different code and
 * keeps different output kinds, so an effect placed on the wrong one doesn't
 * misbehave — it silently does nothing, which is why placement is declared
 * (see {@link EffectDef.hosts}) and enforced at load.
 *
 * - `mode` — the mode's own `effects`: always-on, ungated (`collectModifiers`).
 * - `upgrade` — an upgrade's `effects`: while owned, scaled by owned count
 *   (`collectModifiers`).
 * - `passiveAttack` — a passive attack's `effects`: continuous, against the
 *   opponent, and only `enemyModifier` outputs survive (`collectEnemyDebuffs`).
 * - `activeAttack` — an active attack's `effects`: resolved once when the strike
 *   lands, and only `resourceSteal` outputs survive (`resolveAttackStrike`).
 */
export type EffectHost = 'mode' | 'upgrade' | 'passiveAttack' | 'activeAttack'

/**
 * A registered effect: a zod schema describing its params, plus how to turn
 * parsed params into a modifier at runtime.
 *
 * The schema is the single source of truth for an effect's param shape: the
 * registry validates raw refs against it (so malformed data is rejected at the
 * trust boundary), and the dev editor can introspect it to generate a form.
 */
export interface EffectDef<P> {
  /**
   * The hosts this effect may be authored on. Defaults to
   * {@link DEFAULT_EFFECT_HOSTS} — the production-pipeline hosts — since that
   * fits every effect whose output `collectModifiers` (or a gate it feeds)
   * consumes. Offensive effects declare the attack kind they resolve on
   * instead. `validateModeDefinition` rejects a ref authored elsewhere, and the
   * editor's picker only offers effects legal for the section being edited.
   */
  readonly hosts?: readonly EffectHost[]
  /**
   * Whether `apply`'s output depends on *live player state* rather than params
   * alone — a bank that scales with the stockpile held, a synergy that tracks
   * generator ownership. Purely declarative: nothing in the pipeline branches on
   * it. It marks the effects whose current worth can't be read off the upgrade
   * card, so the UI can surface what they're contributing right now
   * (`collectDynamicBonuses`). Defaults to `false`.
   */
  readonly dynamic?: boolean
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
