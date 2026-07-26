import { describe, expect, it } from 'vitest'

import type { ModeDefinition } from '@game/shared'
import {
  actionSummary,
  cloneStrategy,
  enumerationToQueue,
  generatorOptions,
  makeEmptyStrategy,
  moveAction,
  resourceOptions,
  upgradeOptions,
} from '../src/dev/queue-model.js'
import type { Strategy } from '../src/dev/strategies.js'

function makeMode(): ModeDefinition {
  return {
    resources: ['r0', 'r1'],
    scoreResource: 'r0',
    upgrades: [
      { id: 'u0', cost: { r0: { baseCost: 10 } }, purchaseLimit: 3 },
      { id: 'u1', cost: { r0: { baseCost: 20 } }, purchaseLimit: 1 },
    ],
    goals: [{ type: 'timed', label: '⏱', durationSec: 30 }],
    nativeModifiers: [],
    clicksEnabled: true,
    highlightEnabled: true,
    initialResources: { r0: 0, r1: 0 },
    initialMeta: {},
    generators: [
      { id: 'g0', cost: { r0: { baseCost: 10 } }, production: { resource: 'r0', rate: 1 } },
    ],
    attacks: [],
    pacts: [],
    flavors: [
      {
        id: 'test',
        displayName: 'Test',
        themeClass: 'test',
        scoreLabel: 'Score',
        showClickStats: false,
        resources: [
          { key: 'r0', displayName: 'Wood', icon: '🪵' },
          { key: 'r1', displayName: 'Ale', icon: '🍺' },
        ],
        upgrades: [
          { id: 'u0', name: 'Axes', icon: '🪓', description: '' },
          { id: 'u1', name: 'Saw', icon: '🪚', description: '' },
        ],
        generators: [{ id: 'g0', name: 'Cutter', icon: '⚙️' }],
        attacks: [],
        pacts: [],
      },
    ],
  }
}

const mode = makeMode()

describe('option builders', () => {
  it('maps upgrade / generator / resource ids to flavored labels', () => {
    expect(upgradeOptions(mode)).toEqual([
      { value: 'u0', label: 'Axes' },
      { value: 'u1', label: 'Saw' },
    ])
    expect(generatorOptions(mode)).toEqual([{ value: 'g0', label: 'Cutter' }])
    expect(resourceOptions(mode)).toEqual([
      { value: 'r0', label: 'Wood' },
      { value: 'r1', label: 'Ale' },
    ])
  })
})

describe('actionSummary', () => {
  it('summarizes a buy with its count', () => {
    expect(actionSummary({ kind: 'buy', upgradeId: 'u0', count: 3 }, mode)).toEqual({
      kind: 'buy',
      target: 'Axes',
      params: '×3',
    })
  })

  it('defaults count to 1 when omitted', () => {
    expect(actionSummary({ kind: 'buy_generator', generatorId: 'g0' }, mode).params).toBe('×1')
  })

  it('labels a highlight by resource name', () => {
    expect(actionSummary({ kind: 'set_highlight', highlight: 'r1' }, mode).target).toBe('Ale')
  })

  it('shows the score default for a resourceless click rate', () => {
    expect(actionSummary({ kind: 'set_click_rate', cps: 5 }, mode)).toEqual({
      kind: 'click rate',
      target: 'score',
      params: '5 cps',
    })
  })

  it('summarizes both wait conditions', () => {
    expect(actionSummary({ kind: 'wait', until: { kind: 'seconds', seconds: 5 } }, mode)).toEqual({
      kind: 'wait',
      target: 'time',
      params: '5s',
    })
    expect(
      actionSummary(
        { kind: 'wait', until: { kind: 'resource_at_least', resource: 'r0', amount: 100 } },
        mode,
      ),
    ).toEqual({ kind: 'wait', target: 'Wood', params: '≥ 100' })
  })
})

describe('strategy helpers', () => {
  it('makeEmptyStrategy creates a versioned, empty strategy', () => {
    expect(makeEmptyStrategy('S', 'idler')).toEqual({
      version: 1,
      name: 'S',
      mode: 'idler',
      actions: [],
    })
  })

  it('cloneStrategy deep-copies and renames', () => {
    const src = makeEmptyStrategy('S', 'idler')
    src.actions.push({ kind: 'buy', upgradeId: 'u0', count: 1 })
    const copy = cloneStrategy(src, 'S (copy)')
    expect(copy.name).toBe('S (copy)')
    copy.actions.push({ kind: 'set_highlight', highlight: 'r0' })
    expect(src.actions).toHaveLength(1) // original untouched
  })

  it('moveAction swaps in place and no-ops out of range', () => {
    const s = makeEmptyStrategy('S', 'idler')
    s.actions.push({ kind: 'buy', upgradeId: 'u0' }, { kind: 'buy', upgradeId: 'u1' })
    moveAction(s, 0, 1)
    expect(s.actions.map((a) => (a.kind === 'buy' ? a.upgradeId : ''))).toEqual(['u1', 'u0'])
    moveAction(s, 0, 5) // out of range
    expect(s.actions.map((a) => (a.kind === 'buy' ? a.upgradeId : ''))).toEqual(['u1', 'u0'])
  })
})

describe('enumerationToQueue', () => {
  it('maps legacy buy / set_highlight actions 1:1 into a QueueStrategy', () => {
    const legacy: Strategy = {
      name: 'HL→u0',
      actions: [
        { type: 'set_highlight', highlight: 'r0' },
        { type: 'buy', upgradeId: 'u0' },
        { type: 'set_highlight', highlight: 'r1' },
        { type: 'buy', upgradeId: 'u1' },
      ],
    }
    expect(enumerationToQueue(legacy, 'idler')).toEqual({
      version: 1,
      name: 'HL→u0',
      mode: 'idler',
      actions: [
        { kind: 'set_highlight', highlight: 'r0' },
        { kind: 'buy', upgradeId: 'u0' },
        { kind: 'set_highlight', highlight: 'r1' },
        { kind: 'buy', upgradeId: 'u1' },
      ],
    })
  })

  it('skips malformed actions missing their required field', () => {
    const legacy: Strategy = {
      name: 'broken',
      actions: [
        { type: 'buy' }, // no upgradeId
        { type: 'set_highlight' }, // no highlight
        { type: 'buy', upgradeId: 'u0' },
      ],
    }
    expect(enumerationToQueue(legacy, 'idler').actions).toEqual([{ kind: 'buy', upgradeId: 'u0' }])
  })
})
