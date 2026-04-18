/** Identifiers for all upgrades in the game. */
export type UpgradeId = 'auto-clicker' | 'double-click' | 'multiplier';

/** Static definition of an upgrade (cost, effect description). */
export interface UpgradeDefinition {
  readonly id: UpgradeId;
  readonly name: string;
  readonly cost: number;
  readonly description: string;
}

/** Set of upgrades a player currently owns. */
export type OwnedUpgrades = Record<UpgradeId, boolean>;

/** Full state of a single player within a match. */
export interface PlayerState {
  /** Total currency ever earned (lifetime production). Never decreases. */
  score: number;
  /** Spendable resource. Goes down on purchase. */
  currency: number;
  /** Which upgrades the player owns. */
  upgrades: OwnedUpgrades;
}

/** Possible action types a client can send. */
export type ActionType = 'click' | 'buy';

/** A single player action with a timestamp. */
export interface PlayerAction {
  type: ActionType;
  /** Unix timestamp (ms) when the action occurred on the client. */
  timestamp: number;
  /** For 'buy' actions: the upgrade to purchase. Undefined for 'click'. */
  upgradeId?: UpgradeId;
}

/** Match outcome. */
export type MatchWinner = 'player' | 'opponent' | 'draw';
