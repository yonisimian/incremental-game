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
 * `stealResource`). Display data lives in `AttackFlavor`. `kind` groups attacks
 * into separate blocks in the panel.
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
   * Offensive effects this attack carries. Each ref names a registered effect
   * plus its params. On a *passive* attack an `enemyModifier`-emitting effect
   * applies continuously to the opponent; on an *active* attack a
   * `resourceSteal`-emitting effect resolves once, when the attack strikes.
   * Optional (an effect-less attack is a placeholder). Optional.
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
  /** Mode-specific metadata (e.g., idler highlight). */
  meta: Record<string, unknown>
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
  /** For 'set_highlight' actions: which resource to highlight. */
  highlight?: string
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
