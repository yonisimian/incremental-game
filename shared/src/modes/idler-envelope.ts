import type { PacingEnvelope, TargetEnvelope } from '../balance/types.js'

/**
 * Target envelope for Idler timed mode (35s).
 *
 * **Loose guardrail bands** — calibrated over the strategy corpus in
 * `shared/strategies/idler/` (run `pnpm check:balance` to re-validate). The
 * intent is to catch *gross* regressions and exploits, not to enforce a tight
 * pacing corridor:
 * - `minScore` sits just below the weakest legit archetype (Generator Turtle),
 *   so the floor only trips if income broadly collapses toward the do-nothing
 *   baseline (~1 pt/s native).
 * - `maxScore` sits ~2.5–3× above the strongest legit archetype but well under
 *   the click-rush outlier, so only a genuine exploit exceeds it (surfaced as an
 *   exploit warning).
 *
 * Known balance debt (see docs/plans): idler is click-dominated — the "Click
 * Rush" strategy scores ~6–12× the normal cluster at every checkpoint and is
 * intentionally retained as an exploit-warning demonstrator. Pure economy /
 * generator openings can't ramp within 35s. Both are tracked as mode-tuning
 * follow-ups, not envelope-system bugs.
 */
export const IDLER_TIMED_ENVELOPE: TargetEnvelope = {
  mode: 'idler',
  goalType: 'timed',
  checkpoints: [
    { timeSec: 5, minScore: 8, maxScore: 150, phase: 'Discovery' },
    { timeSec: 10, minScore: 15, maxScore: 400, phase: 'First Choice' },
    { timeSec: 15, minScore: 25, maxScore: 800, phase: 'Acceleration' },
    { timeSec: 25, minScore: 45, maxScore: 2500, phase: 'Optimization' },
    { timeSec: 35, minScore: 75, maxScore: 5000, phase: 'Sprint (final)' },
  ],
  minViableStrategies: 6,
  maxStrategySpread: 30,
}

/**
 * Pacing envelope for Idler **target-score** mode (reach 364, the mode's
 * authored target). The time-axis analog of the timed envelope: instead of
 * "score at time T", it bands "seconds to reach milestone M". Same loose
 * guardrail intent — `minTimeSec` sits just above the click-rush outlier (so
 * finishing suspiciously fast trips an exploit warning) and `maxTimeSec` sits
 * above the slowest legit archetype (Generator Turtle ≈ 80s) with margin.
 */
export const IDLER_SCORE_ENVELOPE: PacingEnvelope = {
  mode: 'idler',
  goalType: 'target-score',
  checkpoints: [
    { atScore: 100, minTimeSec: 4, maxTimeSec: 60, phase: 'Opening' },
    { atScore: 200, minTimeSec: 6, maxTimeSec: 75, phase: 'Midgame' },
    { atScore: 364, minTimeSec: 10, maxTimeSec: 110, phase: 'Target' },
  ],
  minViableStrategies: 6,
  maxTimeSpread: 10,
}

/**
 * Pacing envelope for Idler **race-to-buy** mode (buy the goal upgrade, 30000
 * r0). A single time-to-buy band around the real racer cluster (≈ 40–105s). The
 * sprint-oriented economy/generator archetypes take 600s+ to grind the target
 * and are (correctly) non-viable here — being built for a 35s round, they are
 * simply not race strategies, which is an honest finding rather than a band to
 * widen. `minTimeSec` is a future-proof exploit floor (nothing trips it today).
 */
export const IDLER_RACE_ENVELOPE: PacingEnvelope = {
  mode: 'idler',
  goalType: 'buy-upgrade',
  checkpoints: [{ minTimeSec: 20, maxTimeSec: 130, phase: 'Buy the Throne' }],
  minViableStrategies: 4,
  maxTimeSpread: 5,
}
