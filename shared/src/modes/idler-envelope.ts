import type { TargetEnvelope } from '../balance/types.js'

/**
 * Target envelope for Idler timed mode (35s).
 *
 * **These values are placeholders (TBD).** The correct workflow is:
 * 1. Run all strategies through the simulator (both timing variants).
 * 2. Use P10/P90 of cumulative scores at each timestamp as initial bounds.
 * 3. Tighten or shift the bounds to match the desired pacing feel.
 * 4. Re-validate — at least minViableStrategies must still land within bounds.
 */
export const IDLER_TIMED_ENVELOPE: TargetEnvelope = {
  mode: 'idler',
  goalType: 'timed',
  checkpoints: [
    // TBD — derive from sim P10/P90 once calibrated
    { timeSec: 5, minScore: 3, maxScore: 8, phase: 'Discovery' },
    { timeSec: 10, minScore: 15, maxScore: 40, phase: 'First Choice' },
    { timeSec: 15, minScore: 40, maxScore: 100, phase: 'Acceleration' },
    { timeSec: 25, minScore: 120, maxScore: 350, phase: 'Optimization' },
    { timeSec: 35, minScore: 250, maxScore: 600, phase: 'Sprint (final)' },
  ],
  minViableStrategies: 3,
  maxStrategySpread: 1.15,
}
