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

/** Minimal simulation result needed for envelope validation. */
export interface SimScore {
  /** Strategy name. */
  readonly name: string
  /** Score at each checkpoint timeSec (same order as envelope.checkpoints). */
  readonly scoresAtCheckpoints: readonly number[]
}

// ─── Pacing envelopes (goal-terminated goals: target-score / buy-upgrade) ───
//
// The time-axis mirror of `TargetEnvelope`. Where a `TargetEnvelope` asks "at
// time T, is score within [minScore, maxScore]?", a `PacingEnvelope` asks "to
// reach milestone M, is the elapsed time within [minTimeSec, maxTimeSec]?".
// Used for goals that stop at a variable time (score target hit / goal upgrade
// bought), where a score-at-time band is meaningless at the end. The validator
// (`validatePacing`) and authored data land in phase 6; these declarations exist
// now so the registry can be union-typed from the start.

/** A single time milestone within a pacing envelope. */
export interface PacingCheckpoint {
  /**
   * Score milestone this band applies to (target-score goals). Omitted for a
   * race (`buy-upgrade`) goal, which has a single time-to-buy band.
   */
  readonly atScore?: number
  /** Minimum acceptable elapsed time to reach the milestone (faster = suspicious). */
  readonly minTimeSec: number
  /** Maximum acceptable elapsed time (slower = too grindy). */
  readonly maxTimeSec: number
  /** Human-readable label for the milestone. */
  readonly phase: string
}

/** Target pacing envelope: acceptable *time-to-milestone* bands for a goal-terminated goal. */
export interface PacingEnvelope {
  /** Game mode this envelope applies to. */
  readonly mode: GameMode
  /** Goal type — always one of the goal-terminated kinds. */
  readonly goalType: 'target-score' | 'buy-upgrade'
  /** Ordered milestones (by atScore ascending; a single entry for race). */
  readonly checkpoints: readonly PacingCheckpoint[]
  /** Minimum number of strategies that must be viable at the final milestone. */
  readonly minViableStrategies: number
  /** Maximum allowed ratio between fastest and slowest *viable* strategy times. */
  readonly maxTimeSpread: number
}

/** Per-strategy result within a pacing report (time-axis mirror of `StrategyReport`). */
export interface PacingStrategyReport {
  /** Strategy name. */
  readonly name: string
  /** Elapsed seconds to reach the final milestone, or `null` if it was never reached. */
  readonly timeSec: number | null
  /** Whether the strategy is viable (goal reached AND final time within band). */
  readonly viable: boolean
  /**
   * Per-milestone status: `below` = suspiciously fast (exploit), `above` = too
   * slow or never reached, `within` = on pace.
   */
  readonly milestoneStatuses: readonly CheckpointStatus[]
}

/** Full pacing validation report (time-axis mirror of `EnvelopeReport`). */
export interface PacingReport {
  /** Whether the pacing constraints are satisfied. */
  readonly pass: boolean
  /** Number of viable strategies at the final milestone. */
  readonly viableCount: number
  /** Ratio between slowest and fastest viable *times* (or null if < 2 viable). */
  readonly spreadRatio: number | null
  /** Per-strategy breakdown. */
  readonly strategies: readonly PacingStrategyReport[]
  /** Strategies suspiciously fast (below minTimeSec at any milestone) — exploit warnings. */
  readonly exploitWarnings: readonly string[]
}
