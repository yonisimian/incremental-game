import type { GameMode } from '../types.js'

/** A single score checkpoint within the target envelope. */
export interface Checkpoint {
  /** Seconds into the round. */
  readonly timeSec: number
  /** Minimum acceptable score for a "viable" strategy. */
  readonly minScore: number
  /** Maximum expected score (strategies above this are outliers / exploits). */
  readonly maxScore: number
  /** Human-readable label for the phase. */
  readonly phase: string
}

/** Target envelope defining acceptable score trajectories for a mode + goal type. */
export interface TargetEnvelope {
  /** Game mode this envelope applies to. */
  readonly mode: GameMode
  /** Goal type (different goals ⇒ different pacing). */
  readonly goalType: 'timed' | 'target-score' | 'buy-upgrade'
  /** Ordered checkpoints (by timeSec ascending). */
  readonly checkpoints: readonly Checkpoint[]
  /**
   * Minimum number of strategies that must be viable at the **final** checkpoint.
   * A strategy is viable if both its perfect-timing and delayed-timing variants
   * land within [minScore, maxScore].
   */
  readonly minViableStrategies: number
  /** Maximum allowed ratio between best and worst *viable* strategy scores at the final checkpoint. */
  readonly maxStrategySpread: number
}

/** Per-checkpoint status for a single strategy. */
export type CheckpointStatus = 'within' | 'above' | 'below'

/** Per-strategy result within the envelope report. */
export interface StrategyReport {
  /** Strategy name. */
  readonly name: string
  /** Score at the final checkpoint (perfect timing). */
  readonly perfectScore: number
  /** Score at the final checkpoint (delayed timing). */
  readonly delayedScore: number
  /** Whether the strategy is viable (both variants within band at final checkpoint). */
  readonly viable: boolean
  /** Per-checkpoint status (perfect timing variant). */
  readonly checkpointStatuses: readonly CheckpointStatus[]
}

/** Full envelope validation report. */
export interface EnvelopeReport {
  /** Whether the envelope constraints are satisfied. */
  readonly pass: boolean
  /** Number of viable strategies at the final checkpoint. */
  readonly viableCount: number
  /** Spread ratio between best and worst viable scores (or null if < 2 viable). */
  readonly spreadRatio: number | null
  /** Per-strategy breakdown. */
  readonly strategies: readonly StrategyReport[]
  /** Strategies that exceed maxScore at any checkpoint (exploit warnings). */
  readonly exploitWarnings: readonly string[]
}
