import type { Modifier } from './modifiers/types.js'

/** Available game modes. */
export type GameMode = 'clicker' | 'idler'

/** Static definition of an upgrade (cost, effect description). */
export interface UpgradeDefinition {
  readonly id: string
  readonly name: string
  readonly cost: number
  /** Which resource pays for this upgrade. Falls back to mode's scoreResource if absent. */
  readonly costCurrency?: string
  readonly description: string
  /** If true, the upgrade can be purchased multiple times. */
  readonly repeatable?: boolean
  /** Declarative modifiers this upgrade applies when owned. */
  readonly modifiers: readonly Modifier[]
}

/** Static definition of a generator building (repeatable, scaling cost). */
export interface GeneratorDefinition {
  readonly id: string
  readonly name: string
  readonly icon: string
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

/** A win condition for a round. */
export type Goal = TimedGoal | TargetScoreGoal

/** Match outcome. */
export type MatchWinner = 'player' | 'opponent' | 'draw'
