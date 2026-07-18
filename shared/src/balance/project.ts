/**
 * Projections from raw simulation output to the minimal shapes the envelope
 * validators consume. Pure and DOM-free so both the dev panel (browser) and the
 * CI balance script (Node) share one implementation — see
 * docs/plans/24-envelope-integration.md (phase 1).
 */

import type { SimGoal, SimResult } from '../simulation/simulate.js'
import type { SimScore, TargetEnvelope } from './types.js'

/**
 * Project sim results to per-checkpoint scores for `validateEnvelope`.
 *
 * For each checkpoint, take the score from the last snapshot at or before the
 * checkpoint's `timeSec` (defaulting to 0 when the run has no such snapshot).
 * Snapshots are ordered by time, so a reverse scan finds it.
 */
export function simResultsToScores(
  results: readonly SimResult[],
  envelope: TargetEnvelope,
): SimScore[] {
  return results.map((r) => ({
    name: r.name,
    scoresAtCheckpoints: envelope.checkpoints.map((cp) => {
      for (let i = r.snapshots.length - 1; i >= 0; i--) {
        if (r.snapshots[i].timeSec <= cp.timeSec + 0.001) return r.snapshots[i].score
      }
      return 0
    }),
  }))
}

/**
 * Map a `SimGoal.kind` to its `TargetEnvelope['goalType']` name. The two vocabularies
 * differ (`score` ↔ `target-score`, `race_to_buy` ↔ `buy-upgrade`); this is the one
 * place that bridge lives so the mismatch can't leak into call sites.
 */
export function goalTypeOf(goal: SimGoal): TargetEnvelope['goalType'] {
  switch (goal.kind) {
    case 'timed':
      return 'timed'
    case 'score':
      return 'target-score'
    case 'race_to_buy':
      return 'buy-upgrade'
  }
}

/**
 * Elapsed time (seconds) at which a run first reached `atScore`, or `null` if it
 * never did. The time-axis analog of `simResultsToScores` for pacing envelopes;
 * snapshots are time-ordered, so the first crossing is a forward scan.
 */
export function firstTimeAtScore(result: SimResult, atScore: number): number | null {
  for (const snapshot of result.snapshots) {
    if (snapshot.score >= atScore) return snapshot.timeSec
  }
  return null
}
