/** Available game modes. */
export type GameMode = 'clicker' | 'idler'

/** Which currency is currently highlighted (idler mode). */
export type CurrencyHighlight = 'wood' | 'ale'

/** Identifiers for all upgrades in the game. */
export type UpgradeId =
  | 'auto-clicker'
  | 'double-click'
  | 'multiplier'
  | 'sharpened-axes'
  | 'lumber-mill'
  | 'tavern-recruits'

/** Static definition of an upgrade (cost, effect description). */
export interface UpgradeDefinition {
  readonly id: UpgradeId
  readonly name: string
  readonly cost: number
  /** Which currency pays for this upgrade. Absent for clicker upgrades. */
  readonly costCurrency?: CurrencyHighlight
  readonly description: string
  /** If true, the upgrade can be purchased multiple times. */
  readonly repeatable?: boolean
}

/**
 * Set of upgrades a player currently owns.
 * One-shot upgrades are `boolean` (true = owned).
 * Repeatable upgrades are `number` (buy count, 0 = not owned).
 */
export type OwnedUpgrades = Record<UpgradeId, boolean | number>

/** Full state of a single player within a match. */
export interface PlayerState {
  /** Total score. In clicker = total currency earned. In idler = total wood produced. */
  score: number
  /** Spendable resource (clicker mode only). Stays 0 in idler. */
  currency: number
  /** Which upgrades the player owns. */
  upgrades: OwnedUpgrades
  /** 🪵 Wood balance (idler mode). */
  wood?: number
  /** 🍺 Ale balance (idler mode). */
  ale?: number
  /** Currently highlighted currency (idler mode). */
  highlight?: CurrencyHighlight
}

/** Possible action types a client can send. */
export type ActionType = 'click' | 'buy' | 'set_highlight'

/** A single player action with a timestamp. */
export interface PlayerAction {
  type: ActionType
  /** Unix timestamp (ms) when the action occurred on the client. */
  timestamp: number
  /** For 'buy' actions: the upgrade to purchase. Undefined for 'click'. */
  upgradeId?: UpgradeId
  /** For 'set_highlight' actions: which currency to highlight. */
  highlight?: CurrencyHighlight
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

/** A win condition for a round. */
export type Goal = TimedGoal | TargetScoreGoal

/** Match outcome. */
export type MatchWinner = 'player' | 'opponent' | 'draw'
