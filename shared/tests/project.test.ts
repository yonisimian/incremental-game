import { describe, expect, it } from 'vitest'
import { envelopeFor } from '../src/balance/registry.js'
import { firstTimeAtScore, goalTypeOf, simResultsToScores } from '../src/balance/project.js'
import type { TargetEnvelope } from '../src/balance/types.js'
import {
  IDLER_RACE_ENVELOPE,
  IDLER_SCORE_ENVELOPE,
  IDLER_TIMED_ENVELOPE,
} from '../src/modes/idler-envelope.js'
import type { SimGoal, SimResult, TickSnapshot } from '../src/simulation/simulate.js'

function snap(timeSec: number, score: number): TickSnapshot {
  return {
    tick: Math.round(timeSec * 4),
    timeSec,
    score,
    resources: {},
    incomePerSec: {},
    event: '',
  }
}

function result(name: string, snapshots: TickSnapshot[]): SimResult {
  return {
    name,
    mode: 'idler',
    snapshots,
    finalScore: snapshots.length > 0 ? snapshots[snapshots.length - 1].score : 0,
    events: [],
    notReached: [],
    goalReached: true,
  }
}

const envelope: TargetEnvelope = {
  mode: 'idler',
  goalType: 'timed',
  checkpoints: [
    { timeSec: 5, minScore: 0, maxScore: 100, phase: 'A' },
    { timeSec: 10, minScore: 0, maxScore: 100, phase: 'B' },
    { timeSec: 20, minScore: 0, maxScore: 100, phase: 'C' },
  ],
  minViableStrategies: 1,
  maxStrategySpread: 2,
}

describe('simResultsToScores', () => {
  it('reads the score at a snapshot landing exactly on a checkpoint time', () => {
    const [projected] = simResultsToScores(
      [result('exact', [snap(5, 10), snap(10, 20), snap(20, 40)])],
      envelope,
    )
    expect(projected.scoresAtCheckpoints).toEqual([10, 20, 40])
  })

  it('reads the last snapshot at or before a checkpoint when none lands exactly', () => {
    const [projected] = simResultsToScores(
      // snapshots straddle the checkpoints; 5→last≤5 is t=4, 10→t=9, 20→t=19
      [result('between', [snap(4, 8), snap(9, 18), snap(14, 30), snap(19, 55)])],
      envelope,
    )
    expect(projected.scoresAtCheckpoints).toEqual([8, 18, 55])
  })

  it('holds the final snapshot for checkpoints past the end of the run', () => {
    const [projected] = simResultsToScores([result('short', [snap(5, 10), snap(8, 16)])], envelope)
    // t=10 and t=20 have no snapshot at/after start; last ≤ them is t=8.
    expect(projected.scoresAtCheckpoints).toEqual([10, 16, 16])
  })

  it('defaults to 0 when a run has no snapshot at or before a checkpoint', () => {
    const [projected] = simResultsToScores(
      [result('late-start', [snap(8, 12), snap(12, 24), snap(20, 60)])],
      envelope,
    )
    // No snapshot ≤ t=5 ⇒ 0; t=10→t=8; t=20→t=20.
    expect(projected.scoresAtCheckpoints).toEqual([0, 12, 60])
  })

  it('preserves strategy names and order', () => {
    const projected = simResultsToScores(
      [result('one', [snap(5, 1)]), result('two', [snap(5, 2)])],
      envelope,
    )
    expect(projected.map((p) => p.name)).toEqual(['one', 'two'])
  })
})

describe('goalTypeOf', () => {
  it('maps every SimGoal kind to its envelope goalType', () => {
    const timed: SimGoal = { kind: 'timed', durationSec: 35 }
    const score: SimGoal = { kind: 'score', target: 500 }
    const race: SimGoal = { kind: 'race_to_buy' }
    expect(goalTypeOf(timed)).toBe('timed')
    expect(goalTypeOf(score)).toBe('target-score')
    expect(goalTypeOf(race)).toBe('buy-upgrade')
  })
})

describe('envelopeFor', () => {
  it('returns the seeded envelope for a registered mode + goal type', () => {
    expect(envelopeFor('idler', 'timed')).toBe(IDLER_TIMED_ENVELOPE)
  })

  it('resolves the pacing envelopes for score and race goal types', () => {
    expect(envelopeFor('idler', 'target-score')).toBe(IDLER_SCORE_ENVELOPE)
    expect(envelopeFor('idler', 'buy-upgrade')).toBe(IDLER_RACE_ENVELOPE)
  })
})

describe('firstTimeAtScore', () => {
  it('returns the time of the first snapshot at or above the target score', () => {
    const r = result('r', [snap(5, 40), snap(10, 90), snap(15, 130)])
    expect(firstTimeAtScore(r, 100)).toBe(15)
  })

  it('returns the first tick when the target is already met', () => {
    const r = result('r', [snap(2, 200), snap(4, 300)])
    expect(firstTimeAtScore(r, 100)).toBe(2)
  })

  it('matches a snapshot landing exactly on the target', () => {
    const r = result('r', [snap(5, 50), snap(10, 100)])
    expect(firstTimeAtScore(r, 100)).toBe(10)
  })

  it('returns null when the target is never reached', () => {
    const r = result('r', [snap(5, 10), snap(10, 20)])
    expect(firstTimeAtScore(r, 100)).toBeNull()
  })

  it('returns null for a run with no snapshots', () => {
    expect(firstTimeAtScore(result('empty', []), 1)).toBeNull()
  })
})
