/**
 * Pacing-envelope validation — the time-axis mirror of `validateEnvelope`. For
 * goal-terminated goals (target-score / buy-upgrade) a run stops at a variable
 * time, so the meaningful question is "how long did reaching the milestone
 * take?" rather than "what score at time T?".
 */

import { firstTimeAtScore } from './project.js'
import type {
  CheckpointStatus,
  PacingCheckpoint,
  PacingEnvelope,
  PacingReport,
  PacingStrategyReport,
} from './types.js'
import type { SimResult } from '../simulation/simulate.js'

/**
 * Elapsed seconds for one run to reach a milestone, or `null` if unreached.
 * A score milestone (`atScore`) uses the first snapshot crossing it; a race
 * milestone (no `atScore`) uses the run's final time iff the goal was reached
 * (the buy tick).
 */
function timeToMilestone(result: SimResult, cp: PacingCheckpoint): number | null {
  if (cp.atScore !== undefined) return firstTimeAtScore(result, cp.atScore)
  if (!result.goalReached) return null
  const last = result.snapshots.at(-1)
  return last ? last.timeSec : null
}

/**
 * Validate simulation results against a pacing envelope.
 *
 * A strategy is **viable** when it reaches the final milestone within
 * `[minTimeSec, maxTimeSec]`. Below `minTimeSec` at any milestone is
 * suspiciously fast (an exploit candidate, the time-axis analog of exceeding
 * `maxScore`); above `maxTimeSec` (or never reaching it) is too slow. Spread is
 * the slowest/fastest *time* ratio among viable strategies (faster = better).
 */
export function validatePacing(
  envelope: PacingEnvelope,
  results: readonly SimResult[],
): PacingReport {
  if (envelope.checkpoints.length === 0) {
    return { pass: false, viableCount: 0, spreadRatio: null, strategies: [], exploitWarnings: [] }
  }

  const lastIdx = envelope.checkpoints.length - 1
  const lastMilestone = envelope.checkpoints[lastIdx]

  const exploitWarnings: string[] = []
  const strategies: PacingStrategyReport[] = []

  for (const result of results) {
    const milestoneStatuses: CheckpointStatus[] = envelope.checkpoints.map((cp) => {
      const t = timeToMilestone(result, cp)
      if (t === null) return 'above' // never reached ⇒ too slow
      if (t < cp.minTimeSec) return 'below' // suspiciously fast
      if (t > cp.maxTimeSec) return 'above' // too slow
      return 'within'
    })

    if (milestoneStatuses.some((s) => s === 'below')) exploitWarnings.push(result.name)

    const finalTime = timeToMilestone(result, lastMilestone)
    const viable =
      finalTime !== null &&
      finalTime >= lastMilestone.minTimeSec &&
      finalTime <= lastMilestone.maxTimeSec

    strategies.push({ name: result.name, timeSec: finalTime, viable, milestoneStatuses })
  }

  const viableStrategies = strategies.filter((s) => s.viable)
  const viableCount = viableStrategies.length

  let spreadRatio: number | null = null
  if (viableCount >= 2) {
    const times = viableStrategies.map((s) => s.timeSec).filter((t): t is number => t !== null)
    const slowest = Math.max(...times)
    const fastest = Math.min(...times)
    spreadRatio = fastest > 0 ? slowest / fastest : Infinity
  }

  const pass =
    viableCount >= envelope.minViableStrategies &&
    (spreadRatio === null || spreadRatio <= envelope.maxTimeSpread)

  return { pass, viableCount, spreadRatio, strategies, exploitWarnings }
}
