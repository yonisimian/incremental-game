/** Recursive prerequisite expression with AND / OR semantics. */
export type PrerequisiteExpression =
  | { readonly type: 'all'; readonly items: readonly PrerequisiteExpression[] }
  | { readonly type: 'any'; readonly items: readonly PrerequisiteExpression[] }
  | {
      readonly type: 'upgrade'
      readonly id: string
      readonly minLevel?: number
    }

export type UpgradePrerequisites = PrerequisiteExpression

/** Available game modes. Idler-only for now; the union is kept so re-adding modes stays cheap (D1). */
export type GameMode = 'idler'

/** A 2D position on the upgrade-tree canvas (logical units; render-time scale applies). */
export interface UpgradePosition {
  readonly x: number
  readonly y: number
}

/**
 * The cost of a single currency, with optional per-level scaling. `baseCost` is
 * the level-0 price. When `scaleType`/`scaleFactor` are absent the cost is flat;
 * `linear` grows additively (`baseCost + scaleFactor*level`) and `exponential`
 * compounds (`baseCost * scaleFactor**level`). Shared by upgrades and generators.
 */
export interface CostEntry {
  readonly baseCost: number
  readonly scaleType?: 'linear' | 'exponential'
  readonly scaleFactor?: number
}

/**
 * A declarative, serializable reference to a registered effect: a `type`
 * discriminant plus inline params (validated by the effect's `parse` when
 * applied). See `shared/src/effects` for the registry and implementations.
 */
export interface EffectRef {
  readonly type: string
  readonly [param: string]: unknown
}

/** Static definition of an upgrade (cost, modifiers, prerequisites). */
export interface UpgradeDefinition {
  readonly id: string
  /**
   * Cost as a currency→{@link CostEntry} map (e.g. `{ r0: { baseCost: 15 } }`).
   * Each currency carries its own optional per-level scaling.
   */
  readonly cost: Readonly<Record<string, CostEntry>>
  /**
   * Maximum number of times this upgrade can be purchased.
   * Use `1` for one-shot, `Infinity` for unlimited, or a finite number for a cap.
   */
  readonly purchaseLimit: number
  /**
   * Which upgrades belong to the same mutually exclusive choice group.
   * Purchasing one choice prevents buying any other upgrade in the same group.
   */
  readonly choiceGroup?: string
  /** Optional human-readable label for the choice group. */
  readonly choiceLabel?: string
  /**
   * Which upgrades must be owned before this one is buyable.
   * Supports legacy AND-only arrays and recursive `all` / `any` expressions.
   */
  readonly prerequisites?: UpgradePrerequisites
  /**
   * Hand-placed position on the tree canvas. All upgrades are tree upgrades,
   * so this is the node's canvas anchor.
   */
  readonly position?: UpgradePosition
  /**
   * If set, this upgrade only exists when the active goal's type matches.
   * Used for goal-specific "trophy" upgrades (e.g., buy-upgrade goal's win
   * condition). Untagged upgrades are always available.
   */
  readonly goalType?: Goal['type']
  /**
   * Declarative, state-derived effects emitted when this upgrade is owned.
   * Each ref names a registered effect plus its params (see `shared/src/effects`).
   * Replaces the old `dynamicModifier` closure with pure, serializable data.
   */
  readonly effects?: readonly EffectRef[]
}

/** Static definition of a generator building (repeatable, scaling cost). */
export interface GeneratorDefinition {
  readonly id: string
  /**
   * Cost as a currency→{@link CostEntry} map. Generators are single-currency
   * (enforced by `validateModeDefinition`), so this holds exactly one entry.
   */
  readonly cost: Readonly<Record<string, CostEntry>>
  /** What this generator produces. */
  readonly production: {
    readonly resource: string
    readonly rate: number
  }
}

/** Whether an attack is triggered (`active`) or always-on (`passive`). */
export type AttackKind = 'active' | 'passive'

/**
 * Static definition of an attack: a stable id, its kind, and the offensive
 * effects it carries. Attacks are unlocked via an `unlockAttack` effect and
 * shown in the attack panel. A `passive` attack's effects (e.g.
 * `enemyProductionModifier`) apply continuously to the *opponent's* production
 * while the attack is unlocked — gathered by `collectEnemyDebuffs`. An `active`
 * attack is *activated* by paying its `prepareCost`; after `prepareTimeSec` game
 * seconds it strikes, resolving its effects once against the opponent (e.g.
 * `stealResource`). An active attack may also carry the passive vocabulary
 * (`enemyProductionModifier` / `enemyCostModifier`): those open a *debuff
 * window* of `durationSec` game seconds when the strike lands, tracked on the
 * attacker as `PlayerState.activeDebuffs`. Display data lives in
 * `AttackFlavor`. `kind` groups attacks into separate blocks in the panel.
 */
export interface AttackDefinition {
  readonly id: string
  readonly kind: AttackKind
  /**
   * What activating this attack costs, paid up front at activation. Same shape as
   * upgrade/generator costs, but evaluated at level 0 — attacks have no cost
   * curve, so each activation costs the same and `scaleType`/`scaleFactor` go
   * unused (`scaledCost(entry, 0)` is the evaluation point). Required for an
   * `active` attack that carries effects; forbidden on a `passive` one (which is
   * always-on and never activated).
   */
  readonly prepareCost?: Readonly<Record<string, CostEntry>>
  /**
   * Seconds between activation and the strike landing. Measured in *game* seconds
   * (`meta.gameSec`), so it freezes with the round rather than tracking wall
   * clock. `0` strikes on the next tick. Required alongside `prepareCost` on an
   * active attack with effects; forbidden on a passive one.
   */
  readonly prepareTimeSec?: number
  /**
   * Seconds the strike's debuff effects stay in force, in *game* seconds (so it
   * freezes with the round, like `prepareTimeSec`). Active attacks only, and
   * required when the attack carries a window-consuming effect
   * (`enemyProductionModifier` / `enemyCostModifier`); forbidden on a passive
   * attack, which is always-on by definition, and on an active attack whose
   * effects are all steals (a window with nothing in it). One window per
   * *attack*, not per effect — several debuff effects on one attack share it.
   */
  readonly durationSec?: number
  /**
   * Offensive effects this attack carries. Each ref names a registered effect
   * plus its params. On a *passive* attack an `enemyModifier`-emitting effect
   * applies continuously to the opponent; on an *active* attack a
   * `resourceSteal`-emitting effect resolves once, when the attack strikes, and
   * an `enemyModifier`/`enemyCost`-emitting one applies for `durationSec` from
   * the strike. Optional (an effect-less attack is a placeholder).
   */
  readonly effects?: readonly EffectRef[]
}

/** Whether a pact is actively maintained (`active`) or always-on (`passive`). */
export type PactKind = 'active' | 'passive'

/**
 * Static definition of a pact. Pacts have no behavior yet — they only exist to
 * be unlocked (via an `unlockPact` effect) and shown in the international
 * relationship panel — so a pact is a stable id plus its kind for now. Display
 * data lives in `PactFlavor`. `kind` groups pacts into separate blocks in the
 * panel.
 */
export interface PactDefinition {
  readonly id: string
  readonly kind: PactKind
}

/** Full state of a single player within a match. */
export interface PlayerState {
  /** Total score. */
  score: number
  /** Spendable resources, keyed by resource name. */
  resources: Record<string, number>
  /** Owned upgrades. 0 = not owned, 1 = one-shot owned, n = purchase count. */
  upgrades: Record<string, number>
  /** Owned generators, keyed by generator ID. */
  generators: Record<string, number>
  /** Active attacks that have been paid for and are waiting out their preparation. */
  pendingAttacks: PendingAttack[]
  /**
   * Cost inflation the opponent's unlocked passive attacks currently inflict on
   * this player, stamped by the server (see `collectEnemyCostFactors`). Absent
   * when none is active, which is the default.
   *
   * Every price the player is quoted or charged reads this — via
   * `incomingCostFactors` — so the client's optimistic purchase and the server's
   * validation are computed from the same numbers. Like `pendingAttacks` (and
   * unlike `meta`) it is an engine-level, wire-stable field reasoned about during
   * reconciliation, which is why it lives here rather than in mode metadata.
   *
   * Affects only *future* purchases: already-owned levels and copies are
   * untouched, and a refund is deliberately priced without it (see
   * `getGeneratorSellRefund`).
   */
  incomingCostFactors?: EnemyCostFactor[]
  /**
   * Purchase scopes the opponent's open attack windows currently bar this
   * player from buying (see `collectEnemyPurchaseLocks`), stamped by the server
   * beside `incomingCostFactors` and absent when none, which is the default.
   *
   * Read by every purchase path — server validation, the client's optimistic
   * buy and its reconcile replay, the card — so both sides refuse the same
   * buys (`purchaseBlockReason` / `generatorBlockReason` → `'locked-by-attack'`).
   * Presence is what blocks; `untilSec` is for the victim's countdown only, so
   * a client whose clock has drifted still agrees with the server on *whether*
   * a buy goes through. Selling and attack activation never consult it.
   */
  incomingPurchaseLocks?: PurchaseLock[]
  /**
   * Debuff windows this player's *landed* active attacks are currently
   * inflicting on the opponent (see `resolveAttackStrike`). Absent when none is
   * open, which is the default — the same convention as `incomingCostFactors`.
   *
   * Stored on the **attacker**, not the victim: `collectEnemyDebuffs` and
   * `collectEnemyCostFactors` are attacker-keyed and already gather from attack
   * definitions, so a window makes them one filter longer, and the attacker's
   * own client can show "active for N s". Correctness comes from the read-time
   * expiry filter in those collectors; the server's tick sweep only bounds the
   * array. Never predicted client-side — the strike lands server-side and the
   * field arrives like any other reconciled `PlayerState` field.
   */
  activeDebuffs?: ActiveDebuff[]
  /** Mode-specific metadata (e.g., idler highlight). */
  meta: Record<string, unknown>
}

/**
 * An offensive debuff window opened by a landed active attack — the timed twin
 * of {@link PendingAttack}, one step later in the attack's life. Created by
 * `resolveAttackStrike`, read by the enemy-debuff collectors while
 * `meta.gameSec < expiresAtSec`, and swept by the server once expired.
 */
export interface ActiveDebuff {
  /** Attack id (matches {@link AttackDefinition.id}). */
  readonly attack: string
  /** `meta.gameSec` value at which the window closes. */
  readonly expiresAtSec: number
}

/** Which kind of priced entity a cost factor applies to. */
export type CostScope = 'upgrade' | 'generator'

/**
 * One purchase embargo an opponent's open attack window inflicts, as stamped on
 * the victim (see {@link PlayerState.incomingPurchaseLocks}). One entry per
 * scope — two windows locking the same scope collapse into the one that
 * closes last.
 */
export interface PurchaseLock {
  readonly scope: CostScope
  /**
   * The victim's `meta.gameSec` at which the lock lifts — the latest
   * `expiresAtSec` among the windows locking this scope. Both players' game
   * clocks advance together, so the attacker's window expiry reads directly as
   * the victim's countdown. Display only; presence is what blocks.
   */
  readonly untilSec: number
}

/**
 * One cost inflation inflicted by an opponent's passive attack, resolved from an
 * `enemyCostModifier` effect's authored target into the structural form the
 * price paths consume.
 *
 * `id` absent means every entity of that `scope` — "all upgrades cost 25% more";
 * present names a single upgrade or generator. At least one of the two factors
 * is set (the effect schema enforces it); an omitted one is neutral.
 */
export interface EnemyCostFactor {
  readonly scope: CostScope
  /** A specific upgrade/generator id, or absent for every entity of the scope. */
  readonly id?: string
  /** Multiplies the base cost (e.g. `1.25` = 25% dearer). */
  readonly costFactor?: number
  /** Multiplies the growth portion of the cost curve. */
  readonly scalingFactor?: number
}

/**
 * An activated attack waiting out its preparation time before it strikes.
 * Created by `applyAttackActivation` and drained by the server's strike
 * resolution once `meta.gameSec` reaches `readyAtSec`. Unlike `meta`, this is an
 * engine-level, wire-stable field reasoned about during reconciliation.
 */
export interface PendingAttack {
  /** Attack id (matches {@link AttackDefinition.id}). */
  readonly attack: string
  /** `meta.gameSec` value at which it strikes. */
  readonly readyAtSec: number
}

/** Possible action types a client can send. */
export type ActionType =
  'click' | 'buy' | 'buy_generator' | 'sell_generator' | 'set_highlight' | 'activate_attack'

/** A single player action with a timestamp. */
export interface PlayerAction {
  type: ActionType
  /** Unix timestamp (ms) when the action occurred on the client. */
  timestamp: number
  /** For 'buy' actions: the upgrade to purchase. */
  upgradeId?: string
  /** For 'buy_generator' / 'sell_generator' actions: the generator to buy or sell. */
  generatorId?: string
  /**
   * For 'set_highlight' actions: which resource to highlight, or `null` to
   * release the highlight (see `readHighlight`). `undefined` means the action
   * carries no selection at all and is dropped.
   */
  highlight?: string | null
  /** For 'click' actions: which resource the click credits (defaults to the score resource). */
  resource?: string
  /** For 'activate_attack' actions: which attack to activate. */
  attackId?: string
}

// ─── Goal / Win Condition ────────────────────────────────────────────

/** Timed goal — highest score when the clock runs out wins. */
export interface TimedGoal {
  readonly type: 'timed'
  readonly label: string
  readonly durationSec: number
}

/** Target-score goal — first player to reach the target wins. */
export interface TargetScoreGoal {
  readonly type: 'target-score'
  readonly label: string
  readonly target: number
  /** Maximum match length to prevent infinite games (seconds). */
  readonly safetyCapSec: number
}

/** Buy-upgrade goal — first player to buy a goal-tagged "trophy" upgrade wins. */
export interface BuyUpgradeGoal {
  readonly type: 'buy-upgrade'
  readonly label: string
  /** Maximum match length; on expiry, winner is derived from score. */
  readonly safetyCapSec: number
}

/** A win condition for a round. */
export type Goal = TimedGoal | TargetScoreGoal | BuyUpgradeGoal

/** Match outcome. */
export type MatchWinner = 'player' | 'opponent' | 'draw'
