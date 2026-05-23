import { describe, expect, it } from 'vitest'
import type { TargetEnvelope } from '../src/balance/types.js'
import type { SimScore } from '../src/balance/validate.js'
import { validateEnvelope } from '../src/balance/validate.js'

const envelope: TargetEnvelope = {
  mode: 'idler',
  goalType: 'timed',
  checkpoints: [
    { timeSec: 10, minScore: 10, maxScore: 50, phase: 'Early' },
    { timeSec: 20, minScore: 50, maxScore: 200, phase: 'Mid' },
    { timeSec: 35, minScore: 100, maxScore: 500, phase: 'Final' },
  ],
  minViableStrategies: 3,
  maxStrategySpread: 1.15,
}

function makeScore(name: string, scores: number[]): SimScore {
  return { name, scoresAtCheckpoints: scores }
}

describe('validateEnvelope', () => {
  it('passes when enough strategies are viable and spread is within limit', () => {
    const perfect = [
      makeScore('A', [30, 100, 200]),
      makeScore('B', [20, 80, 190]),
      makeScore('C', [25, 90, 180]),
      makeScore('D', [5, 30, 60]), // below minScore at final
    ]
    const delayed = [
      makeScore('A', [25, 85, 175]),
      makeScore('B', [18, 70, 165]),
      makeScore('C', [22, 78, 155]),
      makeScore('D', [4, 25, 50]),
    ]

    const report = validateEnvelope(envelope, perfect, delayed)

    expect(report.pass).toBe(true)
    expect(report.viableCount).toBe(3)
    expect(report.spreadRatio).toBeCloseTo(200 / 180, 5) // ~1.11
    expect(report.strategies[0].viable).toBe(true)
    expect(report.strategies[3].viable).toBe(false)
  })

  it('fails when fewer than minViableStrategies are viable', () => {
    const perfect = [
      makeScore('A', [30, 100, 200]),
      makeScore('B', [20, 80, 190]),
      makeScore('C', [5, 30, 60]),
    ]
    const delayed = [
      makeScore('A', [25, 85, 175]),
      makeScore('B', [18, 70, 165]),
      makeScore('C', [4, 25, 50]),
    ]

    const report = validateEnvelope(envelope, perfect, delayed)

    expect(report.pass).toBe(false)
    expect(report.viableCount).toBe(2)
  })

  it('fails when spread ratio exceeds maxStrategySpread', () => {
    const perfect = [
      makeScore('A', [30, 100, 490]), // near maxScore
      makeScore('B', [20, 80, 110]), // near minScore
      makeScore('C', [25, 90, 300]),
    ]
    const delayed = [
      makeScore('A', [25, 85, 450]),
      makeScore('B', [18, 70, 105]),
      makeScore('C', [22, 78, 280]),
    ]

    const report = validateEnvelope(envelope, perfect, delayed)

    expect(report.pass).toBe(false)
    expect(report.viableCount).toBe(3)
    expect(report.spreadRatio).toBeCloseTo(490 / 110, 5) // ~4.45
  })

  it('marks strategy as non-viable when delayed variant falls below minScore', () => {
    const perfect = [
      makeScore('A', [30, 100, 200]),
      makeScore('B', [20, 80, 190]),
      makeScore('C', [25, 90, 195]),
      makeScore('D', [15, 60, 120]), // perfect is within band...
    ]
    const delayed = [
      makeScore('A', [25, 85, 175]),
      makeScore('B', [18, 70, 170]),
      makeScore('C', [22, 78, 175]),
      makeScore('D', [12, 45, 90]), // ...but delayed falls below minScore (100)
    ]

    const report = validateEnvelope(envelope, perfect, delayed)

    expect(report.strategies[3].viable).toBe(false)
    expect(report.viableCount).toBe(3)
    expect(report.pass).toBe(true) // spread: 200/190 ≈ 1.05, within 1.15
  })

  it('reports exploit warnings for strategies above maxScore at any checkpoint', () => {
    const perfect = [
      makeScore('A', [30, 100, 200]),
      makeScore('B', [20, 80, 190]),
      makeScore('C', [25, 90, 180]),
      makeScore('Exploit', [60, 250, 300]), // above maxScore at checkpoints 0 and 1
    ]
    const delayed = [
      makeScore('A', [25, 85, 175]),
      makeScore('B', [18, 70, 165]),
      makeScore('C', [22, 78, 155]),
      makeScore('Exploit', [55, 220, 280]),
    ]

    const report = validateEnvelope(envelope, perfect, delayed)

    expect(report.exploitWarnings).toContain('Exploit')
    expect(report.exploitWarnings).toHaveLength(1)
  })

  it('returns null spreadRatio when fewer than 2 strategies are viable', () => {
    const perfect = [makeScore('A', [30, 100, 200])]
    const delayed = [makeScore('A', [25, 85, 175])]

    const report = validateEnvelope(envelope, perfect, delayed)

    expect(report.spreadRatio).toBeNull()
  })

  it('classifies checkpoint statuses correctly', () => {
    const perfect = [
      makeScore('Below', [5, 30, 60]), // below at all
      makeScore('Within', [25, 90, 200]), // within at all
      makeScore('Above', [60, 250, 550]), // above at all
    ]
    const delayed = [
      makeScore('Below', [4, 25, 50]),
      makeScore('Within', [22, 78, 170]),
      makeScore('Above', [55, 220, 510]),
    ]

    const report = validateEnvelope(envelope, perfect, delayed)

    expect(report.strategies[0].checkpointStatuses).toEqual(['below', 'below', 'below'])
    expect(report.strategies[1].checkpointStatuses).toEqual(['within', 'within', 'within'])
    expect(report.strategies[2].checkpointStatuses).toEqual(['above', 'above', 'above'])
  })
})
