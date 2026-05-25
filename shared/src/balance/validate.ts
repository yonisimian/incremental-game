import type {
  CheckpointStatus,
  EnvelopeReport,
  SimScore,
  StrategyReport,
  TargetEnvelope,
} from './types.js'

/**
 * Validate simulation results against a target envelope.
 *
 * @param envelope - The target envelope to validate against.
 * @param perfectResults - Sim results with perfect highlight timing.
 * @param delayedResults - Sim results with delayed highlight timing (2s delay per switch).
 *   Must be in the same order and have the same strategy names as perfectResults.
 * @returns An EnvelopeReport with pass/fail verdict and per-strategy breakdown.
 */
export function validateEnvelope(
  envelope: TargetEnvelope,
  perfectResults: readonly SimScore[],
  delayedResults: readonly SimScore[],
): EnvelopeReport {
  if (envelope.checkpoints.length === 0) {
    return { pass: false, viableCount: 0, spreadRatio: null, strategies: [], exploitWarnings: [] }
  }

  const lastIdx = envelope.checkpoints.length - 1
  const lastCheckpoint = envelope.checkpoints[lastIdx]

  const exploitWarnings: string[] = []
  const strategies: StrategyReport[] = []

  for (let i = 0; i < perfectResults.length; i++) {
    const perfect = perfectResults[i]
    const delayed = delayedResults[i]

    // Classify at each checkpoint (perfect timing variant)
    const checkpointStatuses: CheckpointStatus[] = envelope.checkpoints.map((cp, cpIdx) => {
      const score = perfect.scoresAtCheckpoints[cpIdx]
      if (score > cp.maxScore) return 'above'
      if (score < cp.minScore) return 'below'
      return 'within'
    })

    // Check for exploits at any checkpoint
    const hasExploit = checkpointStatuses.some((s) => s === 'above')
    if (hasExploit) exploitWarnings.push(perfect.name)

    // Viability: both variants must be within [minScore, maxScore] at final checkpoint
    const perfectFinalScore = perfect.scoresAtCheckpoints[lastIdx]
    const delayedFinalScore = delayed.scoresAtCheckpoints[lastIdx]

    const perfectWithin =
      perfectFinalScore >= lastCheckpoint.minScore && perfectFinalScore <= lastCheckpoint.maxScore
    const delayedWithin =
      delayedFinalScore >= lastCheckpoint.minScore && delayedFinalScore <= lastCheckpoint.maxScore

    const viable = perfectWithin && delayedWithin

    strategies.push({
      name: perfect.name,
      perfectScore: perfectFinalScore,
      delayedScore: delayedFinalScore,
      viable,
      checkpointStatuses,
    })
  }

  // Count viable strategies
  const viableStrategies = strategies.filter((s) => s.viable)
  const viableCount = viableStrategies.length

  // Compute spread ratio among viable strategies
  let spreadRatio: number | null = null
  if (viableCount >= 2) {
    const viableScores = viableStrategies.map((s) => s.perfectScore)
    const best = Math.max(...viableScores)
    const worst = Math.min(...viableScores)
    spreadRatio = worst > 0 ? best / worst : Infinity
  }

  // Pass if enough viable strategies and spread is within limit
  const pass =
    viableCount >= envelope.minViableStrategies &&
    (spreadRatio === null || spreadRatio <= envelope.maxStrategySpread)

  return { pass, viableCount, spreadRatio, strategies, exploitWarnings }
}
