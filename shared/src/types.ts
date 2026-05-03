import type { Modifier } from './modifiers/types.js'

/** Available game modes. */
export type GameMode = 'clicker' | 'idler'

/** Which panel hosts an upgrade. */
export type UpgradeCategory = 'play' | 'tree'

/** A 2D position on the upgrade-tree canvas (logical units; render-time scale applies). */
export interface UpgradePosition {
  readonly x: number
  readonly y: number
}

/** Static definition of an upgrade (cost, modifiers, prerequisites). */
export interface UpgradeDefinition {
  readonly id: string
  readonly cost: number
  /** Which resource pays for this upgrade. Falls back to mode's scoreResource if absent. */
  readonly costCurrency?: string
  /** If true, the upgrade can be purchased multiple times. */
  readonly repeatable?: boolean
  /** Declarative modifiers this upgrade applies when owned. */
  readonly modifiers: readonly Modifier[]
  /** Which panel hosts this upgrade. Defaults to 'play' when absent. */
  readonly category?: UpgradeCategory
  /**
   * IDs of upgrades that must be owned (count > 0) before this one is buyable.
   * AND-semantics: every listed upgrade must be owned. Empty/missing = always unlocked.
   */
  readonly prerequisites?: readonly string[]
  /**
   * Hand-placed position on the tree canvas. Required for `category: 'tree'`
   * upgrades; ignored for play-panel upgrades.
   */
  readonly position?: UpgradePosition
  /**
   * If set, this upgrade only exists when the active goal's type matches.
   * Used for goal-specific "trophy" upgrades (e.g., buy-upgrade goal's win
   * condition). Untagged upgrades are always available.
   */
  readonly goalType?: Goal['type']
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

/** Full state of a single player within a match. */
export interface PlayerState {
  /** Total score. */
  score: number
  /** Spendable resources, keyed by resource name. */
  resources: Record<string, number>
  /** Owned upgrades. 0 = not owned, 1 = one-shot owned, n = repeatable buy count. */
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
}

// ─── Goal / Win Condition ────────────────────────────────────────────

/** Timed goal — highest score when the clock runs out wins. */
export interface TimedGoal {
  readonly type: 'timed'
  readonly durationSec: number
}

/** Target-score goal — first player to reach the target wins. */
export interface TargetScoreGoal {
  readonly type: 'target-score'
  readonly target: number
  /** Maximum match length to prevent infinite games (seconds). */
  readonly safetyCapSec: number
}

/** Buy-upgrade goal — first player to buy a goal-tagged "trophy" upgrade wins. */
export interface BuyUpgradeGoal {
  readonly type: 'buy-upgrade'
  /** Maximum match length; on expiry, winner is derived from score. */
  readonly safetyCapSec: number
}

/** A win condition for a round. */
export type Goal = TimedGoal | TargetScoreGoal | BuyUpgradeGoal

/** Match outcome. */
export type MatchWinner = 'player' | 'opponent' | 'draw'
