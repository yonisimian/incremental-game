import { describe, expect, it } from 'vitest'
import { validatePacing } from '../src/balance/pacing.js'
import type { PacingEnvelope } from '../src/balance/types.js'
import type { SimResult, TickSnapshot } from '../src/simulation/simulate.js'

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

function scoreResult(name: string, samples: readonly [number, number][]): SimResult {
  const snapshots = samples.map(([t, s]) => snap(t, s))
  return {
    name,
    mode: 'idler',
    snapshots,
    finalScore: snapshots.at(-1)?.score ?? 0,
    events: [],
    notReached: [],
    goalReached: true,
  }
}

function raceResult(name: string, finishSec: number | null): SimResult {
  const snapshots =
    finishSec === null ? [snap(0, 0), snap(50, 10)] : [snap(0, 0), snap(finishSec, 1)]
  return {
    name,
    mode: 'idler',
    snapshots,
    finalScore: 0,
    events: [],
    notReached: [],
    goalReached: finishSec !== null,
  }
}

// Milestones: 100@[4,60], 200@[6,75], 364@[10,110].
const SCORE_ENV: PacingEnvelope = {
  mode: 'idler',
  goalType: 'target-score',
  checkpoints: [
    { atScore: 100, minTimeSec: 4, maxTimeSec: 60, phase: 'Opening' },
    { atScore: 200, minTimeSec: 6, maxTimeSec: 75, phase: 'Midgame' },
    { atScore: 364, minTimeSec: 10, maxTimeSec: 110, phase: 'Target' },
  ],
  minViableStrategies: 2,
  maxTimeSpread: 10,
}

const RACE_ENV: PacingEnvelope = {
  mode: 'idler',
  goalType: 'buy-upgrade',
  checkpoints: [{ minTimeSec: 20, maxTimeSec: 130, phase: 'Buy the Throne' }],
  minViableStrategies: 1,
  maxTimeSpread: 5,
}

describe('validatePacing — score milestones', () => {
  it('marks a well-paced strategy viable and within all milestones', () => {
    const r = scoreResult('Steady', [
      [5, 50],
      [20, 120],
      [40, 250],
      [60, 400],
    ])
    const report = validatePacing(SCORE_ENV, [r])
    const s = report.strategies[0]
    expect(s.viable).toBe(true)
    expect(s.milestoneStatuses).toEqual(['within', 'within', 'within'])
    expect(s.timeSec).toBe(60)
  })

  it('flags a suspiciously-fast strategy as an exploit and non-viable', () => {
    const r = scoreResult('Rusher', [
      [1, 400],
      [2, 500],
    ])
    const report = validatePacing(SCORE_ENV, [r])
    expect(report.strategies[0].viable).toBe(false)
    expect(report.strategies[0].milestoneStatuses).toEqual(['below', 'below', 'below'])
    expect(report.exploitWarnings).toEqual(['Rusher'])
  })

  it('marks a strategy that never reaches the final milestone non-viable (too slow)', () => {
    const r = scoreResult('Grinder', [
      [5, 50],
      [35, 150],
    ])
    const report = validatePacing(SCORE_ENV, [r])
    const s = report.strategies[0]
    expect(s.viable).toBe(false)
    expect(s.timeSec).toBeNull()
    expect(s.milestoneStatuses.at(-1)).toBe('above')
    expect(report.exploitWarnings).toEqual([])
  })

  it('computes the slowest/fastest time spread across viable strategies', () => {
    const fast = scoreResult('Fast', [
      [5, 120],
      [8, 220],
      [12, 400],
    ])
    const slow = scoreResult('Slow', [
      [30, 120],
      [45, 220],
      [60, 400],
    ])
    const report = validatePacing(SCORE_ENV, [fast, slow])
    expect(report.viableCount).toBe(2)
    // 60 / 12 = 5.
    expect(report.spreadRatio).toBeCloseTo(5)
    expect(report.pass).toBe(true)
  })

  it('fails when too few strategies are viable', () => {
    const only = scoreResult('Only', [
      [5, 120],
      [8, 220],
      [12, 400],
    ])
    const report = validatePacing(SCORE_ENV, [only])
    expect(report.viableCount).toBe(1)
    expect(report.pass).toBe(false) // needs 2
  })
})

describe('validatePacing — race milestone', () => {
  it('uses the final buy time and marks an in-band finish viable', () => {
    const report = validatePacing(RACE_ENV, [raceResult('Buyer', 65)])
    expect(report.strategies[0].viable).toBe(true)
    expect(report.strategies[0].timeSec).toBe(65)
    expect(report.pass).toBe(true)
  })

  it('treats a never-finished race as too slow and non-viable', () => {
    const report = validatePacing(RACE_ENV, [raceResult('Never', null)])
    expect(report.strategies[0].viable).toBe(false)
    expect(report.strategies[0].timeSec).toBeNull()
    expect(report.pass).toBe(false)
  })

  it('flags a sub-minimum race finish as an exploit candidate', () => {
    const report = validatePacing(RACE_ENV, [raceResult('Cheater', 5)])
    expect(report.exploitWarnings).toEqual(['Cheater'])
    expect(report.strategies[0].viable).toBe(false)
  })
})

describe('validatePacing — edge cases', () => {
  it('returns a non-passing empty report when the envelope has no checkpoints', () => {
    const empty: PacingEnvelope = { ...SCORE_ENV, checkpoints: [] }
    const report = validatePacing(empty, [scoreResult('X', [[5, 400]])])
    expect(report).toEqual({
      pass: false,
      viableCount: 0,
      spreadRatio: null,
      strategies: [],
      exploitWarnings: [],
    })
  })

  it('leaves spreadRatio null with fewer than two viable strategies', () => {
    const r = scoreResult('One', [
      [5, 120],
      [8, 220],
      [12, 400],
    ])
    const report = validatePacing(SCORE_ENV, [r])
    expect(report.spreadRatio).toBeNull()
  })
})
