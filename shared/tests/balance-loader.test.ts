import { describe, expect, it } from 'vitest'

import {
  allEnvelopes,
  envelopeFor,
  loadBalance,
  parseBalanceFile,
  validateEnvelopes,
} from '../src/index.js'
import type { BalanceEnvelope, GameMode, Goal } from '../src/index.js'
import idlerBalanceFile from '../balance/idler.json' with { type: 'json' }

// The shared test setup (`setup.ts`) already loads the idler tree + balance
// sidecar before any test runs, so the registry is populated here.

// ─── parseBalanceFile ────────────────────────────────────────────────

describe('parseBalanceFile', () => {
  it('parses the canonical idler sidecar', () => {
    const file = parseBalanceFile(idlerBalanceFile)
    expect(file.mode).toBe('idler')
    expect(file.envelopes.map((e) => e.goalType).sort()).toEqual([
      'buy-upgrade',
      'target-score',
      'timed',
    ])
  })

  it('rejects a file with the wrong version', () => {
    expect(() => parseBalanceFile({ ...idlerBalanceFile, version: 2 })).toThrow()
  })

  it('rejects an unknown top-level key', () => {
    expect(() => parseBalanceFile({ ...idlerBalanceFile, extra: true })).toThrow()
  })

  it('defaults to an empty envelope list when the field is omitted', () => {
    const file = parseBalanceFile({ version: 1, mode: 'idler' })
    expect(file.envelopes).toEqual([])
  })
})

// ─── loadBalance / registry ──────────────────────────────────────────

describe('loadBalance', () => {
  it('registers the idler sidecar with the mode injected onto each envelope', () => {
    loadBalance(idlerBalanceFile)
    const idlerEnvelopes = allEnvelopes()
    expect(idlerEnvelopes).toHaveLength(3)
    expect(idlerEnvelopes.map((e) => e.mode)).toEqual(['idler', 'idler', 'idler'])
  })

  it('resolves each goal type via envelopeFor', () => {
    expect(envelopeFor('idler', 'timed')?.goalType).toBe('timed')
    expect(envelopeFor('idler', 'target-score')?.goalType).toBe('target-score')
    expect(envelopeFor('idler', 'buy-upgrade')?.goalType).toBe('buy-upgrade')
  })

  it('fails soft: an unregistered mode yields no envelope', () => {
    expect(envelopeFor('nope' as GameMode, 'timed')).toBeUndefined()
  })

  it('throws when the sidecar targets a mode that is not loaded', () => {
    expect(() => loadBalance({ ...idlerBalanceFile, mode: 'nope' })).toThrow()
  })
})

// ─── validateEnvelopes — negative tests ──────────────────────────────

const TIMED_GOAL: Goal = { type: 'timed', label: '⏱ Timed', durationSec: 30 }
const SCORE_GOAL: Goal = {
  type: 'target-score',
  label: '🎯 Reach',
  target: 1000,
  safetyCapSec: 300,
}

describe('validateEnvelopes — negative tests', () => {
  it('accepts a valid score-paced (timed) envelope', () => {
    const envelopes: BalanceEnvelope[] = [
      {
        mode: 'idler',
        goalType: 'timed',
        checkpoints: [
          { timeSec: 5, minScore: 8, maxScore: 150, phase: 'A' },
          { timeSec: 10, minScore: 15, maxScore: 400, phase: 'B' },
        ],
        minViableStrategies: 1,
        maxStrategySpread: 10,
      },
    ]
    expect(() => {
      validateEnvelopes('test', [TIMED_GOAL], envelopes)
    }).not.toThrow()
  })

  it('accepts a valid time-paced target-score envelope', () => {
    const envelopes: BalanceEnvelope[] = [
      {
        mode: 'idler',
        goalType: 'target-score',
        checkpoints: [
          { atScore: 100, minTimeSec: 4, maxTimeSec: 60, phase: 'A' },
          { atScore: 500, minTimeSec: 8, maxTimeSec: 90, phase: 'B' },
        ],
        minViableStrategies: 1,
        maxTimeSpread: 10,
      },
    ]
    expect(() => {
      validateEnvelopes('test', [SCORE_GOAL], envelopes)
    }).not.toThrow()
  })

  it('throws on a duplicate envelope for a goalType', () => {
    const one = (): BalanceEnvelope => ({
      mode: 'idler',
      goalType: 'timed',
      checkpoints: [{ timeSec: 5, minScore: 0, maxScore: 100, phase: 'A' }],
      minViableStrategies: 1,
      maxStrategySpread: 10,
    })
    expect(() => {
      validateEnvelopes('test', [TIMED_GOAL], [one(), one()])
    }).toThrow(/duplicate envelope for goalType 'timed'/)
  })

  it('throws when an envelope constrains a goal the mode does not offer', () => {
    const envelopes: BalanceEnvelope[] = [
      {
        mode: 'idler',
        goalType: 'target-score',
        checkpoints: [{ atScore: 100, minTimeSec: 4, maxTimeSec: 60, phase: 'A' }],
        minViableStrategies: 1,
        maxTimeSpread: 10,
      },
    ]
    expect(() => {
      validateEnvelopes('test', [TIMED_GOAL], envelopes)
    }).toThrow(/no 'target-score' goal in this mode/)
  })

  it('throws on an envelope with no checkpoints', () => {
    const envelopes: BalanceEnvelope[] = [
      {
        mode: 'idler',
        goalType: 'timed',
        checkpoints: [],
        minViableStrategies: 1,
        maxStrategySpread: 10,
      },
    ]
    expect(() => {
      validateEnvelopes('test', [TIMED_GOAL], envelopes)
    }).toThrow(/has no checkpoints/)
  })

  it('throws when maxStrategySpread < 1', () => {
    const envelopes: BalanceEnvelope[] = [
      {
        mode: 'idler',
        goalType: 'timed',
        checkpoints: [{ timeSec: 5, minScore: 0, maxScore: 100, phase: 'A' }],
        minViableStrategies: 1,
        maxStrategySpread: 0.5,
      },
    ]
    expect(() => {
      validateEnvelopes('test', [TIMED_GOAL], envelopes)
    }).toThrow(/maxStrategySpread must be >= 1/)
  })

  it('throws when timed checkpoints are not ordered by ascending timeSec', () => {
    const envelopes: BalanceEnvelope[] = [
      {
        mode: 'idler',
        goalType: 'timed',
        checkpoints: [
          { timeSec: 10, minScore: 0, maxScore: 100, phase: 'A' },
          { timeSec: 5, minScore: 0, maxScore: 100, phase: 'B' },
        ],
        minViableStrategies: 1,
        maxStrategySpread: 10,
      },
    ]
    expect(() => {
      validateEnvelopes('test', [TIMED_GOAL], envelopes)
    }).toThrow(/ordered by ascending timeSec/)
  })

  it('throws when a timed checkpoint has minScore > maxScore', () => {
    const envelopes: BalanceEnvelope[] = [
      {
        mode: 'idler',
        goalType: 'timed',
        checkpoints: [{ timeSec: 5, minScore: 200, maxScore: 100, phase: 'A' }],
        minViableStrategies: 1,
        maxStrategySpread: 10,
      },
    ]
    expect(() => {
      validateEnvelopes('test', [TIMED_GOAL], envelopes)
    }).toThrow(/minScore 200 > maxScore 100/)
  })

  it('throws when maxTimeSpread < 1', () => {
    const envelopes: BalanceEnvelope[] = [
      {
        mode: 'idler',
        goalType: 'target-score',
        checkpoints: [{ atScore: 100, minTimeSec: 4, maxTimeSec: 60, phase: 'A' }],
        minViableStrategies: 1,
        maxTimeSpread: 0.5,
      },
    ]
    expect(() => {
      validateEnvelopes('test', [SCORE_GOAL], envelopes)
    }).toThrow(/maxTimeSpread must be >= 1/)
  })

  it('throws when a milestone has minTimeSec > maxTimeSec', () => {
    const envelopes: BalanceEnvelope[] = [
      {
        mode: 'idler',
        goalType: 'target-score',
        checkpoints: [{ atScore: 100, minTimeSec: 90, maxTimeSec: 60, phase: 'A' }],
        minViableStrategies: 1,
        maxTimeSpread: 10,
      },
    ]
    expect(() => {
      validateEnvelopes('test', [SCORE_GOAL], envelopes)
    }).toThrow(/minTimeSec 90 > maxTimeSec 60/)
  })

  it('throws when milestones are not ordered by ascending atScore', () => {
    const envelopes: BalanceEnvelope[] = [
      {
        mode: 'idler',
        goalType: 'target-score',
        checkpoints: [
          { atScore: 500, minTimeSec: 4, maxTimeSec: 60, phase: 'A' },
          { atScore: 100, minTimeSec: 8, maxTimeSec: 90, phase: 'B' },
        ],
        minViableStrategies: 1,
        maxTimeSpread: 10,
      },
    ]
    expect(() => {
      validateEnvelopes('test', [SCORE_GOAL], envelopes)
    }).toThrow(/ordered by ascending atScore/)
  })

  it('throws when a milestone atScore exceeds the target-score goal target', () => {
    const goal: Goal = { type: 'target-score', label: '🎯 Reach', target: 300, safetyCapSec: 300 }
    const envelopes: BalanceEnvelope[] = [
      {
        mode: 'idler',
        goalType: 'target-score',
        checkpoints: [{ atScore: 500, minTimeSec: 4, maxTimeSec: 60, phase: 'A' }],
        minViableStrategies: 1,
        maxTimeSpread: 10,
      },
    ]
    expect(() => {
      validateEnvelopes('test', [goal], envelopes)
    }).toThrow(/exceeds the target-score goal target 300/)
  })
})
