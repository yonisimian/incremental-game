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
  /** Cost as a currency→amount map (e.g. `{ r0: 15 }` or `{ r0: 15, r1: 5 }`). */
  readonly cost: Readonly<Record<string, number>>
  /** Optional dynamic cost scaling for repeatable upgrades. */
  readonly costScaling?:
    | { readonly type: 'linear'; readonly baseCost: number; readonly factor: number }
    | { readonly type: 'exponential'; readonly baseCost: number; readonly factor: number }
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
  readonly baseCost: number
  /** Cost multiplier per owned copy (e.g., 1.15). */
  readonly costScaling: number
  /** Which resource pays for this generator. */
  readonly costCurrency: string
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
 * while the attack is unlocked — gathered by `collectEnemyDebuffs`; active
 * attacks have no continuous behavior yet (they await a trigger mechanism).
 * Display data lives in `AttackFlavor`. `kind` groups attacks into separate
 * blocks in the panel.
 */
export interface AttackDefinition {
  readonly id: string
  readonly kind: AttackKind
  /**
   * Offensive effects this attack carries. Each ref names a registered effect
   * plus its params; only `enemyModifier`-emitting effects on *passive* attacks
   * currently have a runtime effect (applied to the opponent). Optional.
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
  /** Mode-specific metadata (e.g., idler highlight). */
  meta: Record<string, unknown>
}

/** Possible action types a client can send. */
export type ActionType = 'click' | 'buy' | 'buy_generator' | 'set_highlight'

/** A single player action with a timestamp. */
export interface PlayerAction {
  type: ActionType
  /** Unix timestamp (ms) when the action occurred on the client. */
  timestamp: number
  /** For 'buy' actions: the upgrade to purchase. */
  upgradeId?: string
  /** For 'buy_generator' actions: the generator to purchase. */
  generatorId?: string
  /** For 'set_highlight' actions: which resource to highlight. */
  highlight?: string
  /** For 'click' actions: which resource the click credits (defaults to the score resource). */
  resource?: string
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
