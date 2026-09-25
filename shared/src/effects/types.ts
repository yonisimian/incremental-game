import type { ZodType } from 'zod'

import type { Modifier } from '../modifiers/types.js'
import type { ModeDefinition } from '../modes/types.js'
import type { AttackKind, CostScope, PlayerState } from '../types.js'
// Type-only (erased at runtime), so naming the seed here can't create an import
// cycle — and the schema's enum stays the single source of truth for both.
import type { BatteryStat, BatteryStatOp } from './seed/battery-stat.js'
import type { BatteryBandSide } from './seed/battery-band.js'
import type { AttackStat, AttackStatOp } from './seed/attack-stat.js'

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
 * Grants attack slots — room to hold attacks of one kind — while the owning
 * upgrade is held, or for the whole round when authored on the mode. Emitted by
 * the `attackSlots` effect (plan 38).
 *
 * Consumed by `attackLimit`, which sums `value × owned` across every grant for
 * the kind; `hasAttackSlotsFor` then refuses a purchase that would unlock more
 * attacks of that kind than the budget allows (`purchaseBlockReason` →
 * `'attack-slots'`). A kind no `attackSlots` output in the mode names is
 * *uncapped* — the mechanic is opt-in per mode. Carries no production weight, so
 * the modifier pipeline ignores it.
 */
export interface AttackSlotsOutput {
  readonly kind: 'attackSlots'
  /** Which kind of attack this budget covers. */
  readonly attackKind: AttackKind
  /** Slots granted, per owned level. */
  readonly value: number
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
 * An *offensive* cost inflation: the opponent's upgrades or generators get more
 * expensive while the owning passive attack is unlocked. Emitted by the
 * `enemyCostModifier` effect and consumed by `collectEnemyCostFactors`, which —
 * like `collectEnemyDebuffs` — gathers it from a player's unlocked passive
 * attacks and hands it to the *other* player.
 *
 * Deliberately **not** an {@link EnemyModifierOutput}: a price is not a
 * production-pipeline field, so a `Modifier` carrying it would either be dropped
 * by `collectModifiers` or silently debuff production instead. The distinct
 * `kind` is the routing tag that keeps it on the cost paths.
 *
 * Attacks the *economy* rather than the income curve: it doesn't slow what the
 * victim earns, it raises what they must earn. Only future purchases are
 * affected — nothing already owned is repriced (see
 * {@link PlayerState.incomingCostFactors}).
 */
export interface EnemyCostOutput {
  readonly kind: 'enemyCost'
  /** Which kind of priced entity is inflated. */
  readonly scope: CostScope
  /** A specific upgrade/generator id, or absent for every entity of the scope. */
  readonly id?: string
  /** Multiplies the victim's base cost (e.g. `1.25` = 25% dearer). */
  readonly costFactor?: number
  /** Multiplies the growth portion of the victim's cost curve. */
  readonly scalingFactor?: number
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
 * An adjustment to one of the highlight battery's parameters, emitted by the
 * `batteryStat` effect while the owning upgrade is held.
 *
 * Consumed by `collectBatteryParams`, which owns the owned-count compounding,
 * the cross-upgrade stacking, and the clamping — this output is just the authored
 * adjustment echoed back. Carries no production weight, so the modifier pipeline
 * ignores it.
 */
export interface BatteryStatOutput {
  readonly kind: 'batteryStat'
  /** Which battery parameter to move (see `BATTERY_STATS`). */
  readonly stat: BatteryStat
  /** `add` shifts the value; `mult` scales it. */
  readonly op: BatteryStatOp
  readonly value: number
}

/**
 * A conditional bonus to the highlight battery's factor, paid only while the
 * charge sits in one end of the tank. Emitted by the `batteryBand` effect while
 * the owning upgrade is held.
 *
 * Consumed by `collectBatteryBands` / `batteryFactor`. Unlike {@link
 * BatteryStatOutput} this can't be folded into the charge-independent
 * {@link BatteryParams}, because whether it pays depends on the *current* charge.
 */
export interface BatteryBandOutput {
  readonly kind: 'batteryBand'
  /** `high` pays at or above `threshold` of capacity; `low` at or below it. */
  readonly band: BatteryBandSide
  /** Fraction of capacity delimiting the band, strictly inside `(0, 1)`. */
  readonly threshold: number
  /** Added to the battery's factor while the charge is inside the band. */
  readonly bonus: number
}

/**
 * An adjustment to one of an attack's numbers, emitted by the `attackStat`
 * effect while the owning upgrade is held.
 *
 * Consumed by `collectAttackParams`, which owns the owned-count compounding, the
 * cross-upgrade stacking, the per-attack filtering, and the clamping — this
 * output is just the authored adjustment echoed back. Carries no production
 * weight, so the modifier pipeline ignores it.
 */
export interface AttackStatOutput {
  readonly kind: 'attackStat'
  /** Which attack this moves. */
  readonly attack: string
  /** Which attack parameter to move (see `ATTACK_STATS`). */
  readonly stat: AttackStat
  /** `add` shifts the multiplier; `mult` scales it. */
  readonly op: AttackStatOp
  readonly value: number
}

/**
 * A raise to a time clock's accrual rate, emitted by the `timeFactorBoost`
 * effect while the owning upgrade is held.
 *
 * Consumed by `collectTimeFactorBoosts` / `timeBonusFraction`, which own both the
 * level-by-level dating (each level accrues only from *its own* purchase onward,
 * unless a {@link TimeRetroactiveOutput} is in play) and the pairing with the
 * clock's own start. Carries no production weight on its own — the clock's
 * `timeScaledModifier` is what reaches the pipeline — so every other consumer
 * ignores it.
 */
export interface TimeFactorBoostOutput {
  readonly kind: 'timeFactorBoost'
  /** Id of the upgrade whose purchase starts the clock this boost feeds. */
  readonly clock: string
  /** Added to the clock's accrual rate, per minute, per owned level. */
  readonly perMinute: number
}

/**
 * Makes a time clock's {@link TimeFactorBoostOutput}s retroactive while the
 * owning upgrade is held: every boost counts from the clock's *start* rather than
 * from the level's own purchase, so time already elapsed is repriced at the
 * current rate. Consumed by `isTimeBonusRetroactive`; carries no production
 * weight of its own.
 */
export interface TimeRetroactiveOutput {
  readonly kind: 'timeRetroactive'
  /** Id of the upgrade whose purchase starts the affected clock. */
  readonly clock: string
}

/**
 * An instantaneous transfer of *generator copies* from the victim to the
 * attacker, emitted by the `stealGenerator` effect on an active attack. The
 * generator-side twin of {@link ResourceStealOutput}, resolved at the same
 * moment by the same consumer (`resolveAttackStrike`) — a separate kind because
 * the two move different things and obey different rules: copies are whole
 * numbers (a share is floored), and moving one shifts *both* players' cost
 * curves, since a generator's next-copy price is a function of how many that
 * player owns. Stolen copies produce for their new owner even if the attacker
 * never unlocked that generator — `collectModifiers` reads owned counts, not
 * unlock gates — so a steal is also a shortcut past the tech tree.
 *
 * The take is either a share of the victim's copies or a flat count — a union
 * rather than one optional-of-each field, so a consumer must branch on which was
 * authored instead of silently reading an absent one as `undefined`. Either way
 * `resolveAttackStrike` caps the transfer at what the victim owns.
 */
export type GeneratorStealOutput = GeneratorStealShare | GeneratorStealFlat

/** Common shape of a generator steal, whatever the take is expressed as. */
interface GeneratorStealBase {
  readonly kind: 'generatorSteal'
  /** Which generator is taken from the victim (an id in `mode.generators`). */
  readonly generator: string
}

/** Take a share of the victim's copies, e.g. `0.5` = half (floored). */
interface GeneratorStealShare extends GeneratorStealBase {
  readonly fraction: number
}

/** Take a flat number of copies, capped at what the victim owns. */
interface GeneratorStealFlat extends GeneratorStealBase {
  readonly count: number
}

/**
 * What an effect's `apply` can emit: a production {@link Modifier}, a
 * {@link BaseModifierOutput}, a {@link GeneratorCostOutput}, one of the unlock
 * outputs ({@link PanelUnlockOutput}, {@link GeneratorUnlockOutput}, {@link
 * SystemUnlockOutput}, {@link AttackUnlockOutput}, {@link PactUnlockOutput}), an
 * {@link EnemyDataAccessOutput}, an {@link EnemyModifierOutput}, an
 * {@link EnemyCostOutput}, one of the
 * steal outputs ({@link ResourceStealOutput}, {@link GeneratorStealOutput}), an
 * {@link AttackStatOutput}, an {@link AttackSlotsOutput}, or
 * one of the time-clock outputs ({@link TimeFactorBoostOutput}, {@link
 * TimeRetroactiveOutput}).
 * Each is routed to a different subsystem
 * (`collectModifiers` / `collectGeneratorCostFactors` / the unlock gates /
 * `hasEnemyDataAccess` / `collectEnemyDebuffs` / `collectEnemyCostFactors` /
 * `resolveAttackStrike` / `collectAttackParams` / `attackLimit` /
 * `timeBonusFraction`); every consumer ignores the outputs it doesn't own.
 */
export type EffectOutput =
  | Modifier
  | BaseModifierOutput
  | GeneratorCostOutput
  | PanelUnlockOutput
  | GeneratorUnlockOutput
  | SystemUnlockOutput
  | AttackUnlockOutput
  | AttackSlotsOutput
  | PactUnlockOutput
  | EnemyDataAccessOutput
  | EnemyModifierOutput
  | EnemyCostOutput
  | ResourceStealOutput
  | AttackStatOutput
  | BatteryStatOutput
  | BatteryBandOutput
  | GeneratorStealOutput
  | TimeFactorBoostOutput
  | TimeRetroactiveOutput

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
 *   opponent, and only the debuff outputs (`enemyModifier`, `enemyCost`)
 *   survive (`collectEnemyDebuffs` / `collectEnemyCostFactors`).
 * - `activeAttack` — an active attack's `effects`: resolved when the strike
 *   lands. The steal outputs (`resourceSteal`, `generatorSteal`) move something
 *   once (`resolveAttackStrike`); the debuff outputs open a window of the
 *   attack's `durationSec`, during which the same collectors gather them.
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
   * Marks an effect whose *magnitude* can't be read off the upgrade card because
   * it's computed from live player state — a bank scaling with the stockpile
   * held, a synergy tracking generator ownership. The UI surfaces what these are
   * paying right now (`collectDynamicBonuses`); flat effects are left off since
   * their card already states their worth.
   *
   * The test is the *value*, not merely reading state: an effect that reads
   * state only to pick a `field` while its value stays the authored constant
   * (e.g. `highlightMultiplier`, whose ×N is fixed and printed on the card) is
   * **not** dynamic — listing it would repeat a number the player can already
   * see. Flag it only when the number itself moves.
   *
   * Purely declarative: nothing in the pipeline branches on it. Defaults to
   * `false`.
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
