import { describe, expect, it } from 'vitest'

import type { PlayerAction } from '../src/types.js'
import { liveActionsToStrategy } from '../src/simulation/live-export.js'

// Helpers to build recorded actions with explicit timestamps (ms).
const buy = (upgradeId: string, ms: number): PlayerAction => ({
  type: 'buy',
  upgradeId,
  timestamp: ms,
})
const gen = (generatorId: string, ms: number): PlayerAction => ({
  type: 'buy_generator',
  generatorId,
  timestamp: ms,
})
const sell = (generatorId: string, ms: number): PlayerAction => ({
  type: 'sell_generator',
  generatorId,
  timestamp: ms,
})
const hl = (highlight: string | null, ms: number): PlayerAction => ({
  type: 'set_highlight',
  highlight,
  timestamp: ms,
})
const click = (resource: string, ms: number): PlayerAction => ({
  type: 'click',
  resource,
  timestamp: ms,
})

describe('liveActionsToStrategy', () => {
  it('produces a versioned strategy carrying mode + name', () => {
    const s = liveActionsToStrategy([], 'idler', 'My Run')
    expect(s).toEqual({ version: 1, name: 'My Run', mode: 'idler', actions: [] })
  })

  it('maps buys / generators / highlights 1:1 in order', () => {
    const s = liveActionsToStrategy([hl('r0', 0), buy('u1', 10), gen('g0', 20)], 'idler', 'x')
    expect(s.actions).toEqual([
      { kind: 'set_highlight', highlight: 'r0' },
      { kind: 'buy', upgradeId: 'u1' },
      { kind: 'buy_generator', generatorId: 'g0' },
    ])
  })

  it('exports a released highlight rather than dropping it as falsy', () => {
    const s = liveActionsToStrategy([hl('r0', 0), hl(null, 10)], 'idler', 'x')
    expect(s.actions).toEqual([
      { kind: 'set_highlight', highlight: 'r0' },
      { kind: 'set_highlight', highlight: null },
    ])
  })

  it('maps sell_generator 1:1 without a count and without collapsing', () => {
    const s = liveActionsToStrategy([gen('g0', 0), sell('g0', 5), sell('g0', 9)], 'idler', 'x')
    expect(s.actions).toEqual([
      { kind: 'buy_generator', generatorId: 'g0' },
      { kind: 'sell_generator', generatorId: 'g0' },
      { kind: 'sell_generator', generatorId: 'g0' },
    ])
  })

  it('collapses consecutive identical buys into a count', () => {
    const s = liveActionsToStrategy(
      [gen('g0', 0), gen('g0', 5), gen('g0', 9), buy('u1', 20)],
      'idler',
      'x',
    )
    expect(s.actions).toEqual([
      { kind: 'buy_generator', generatorId: 'g0', count: 3 },
      { kind: 'buy', upgradeId: 'u1' },
    ])
  })

  it('does not collapse identical buys separated by another action', () => {
    const s = liveActionsToStrategy([buy('u1', 0), hl('r1', 5), buy('u1', 10)], 'idler', 'x')
    expect(s.actions).toEqual([
      { kind: 'buy', upgradeId: 'u1' },
      { kind: 'set_highlight', highlight: 'r1' },
      { kind: 'buy', upgradeId: 'u1' },
    ])
  })

  it('converts a click run into a measured-CPS set_click_rate at its start', () => {
    // 11 clicks over 1000ms (100ms apart) → 10 intervals / 1s = 10 cps.
    const clicks = Array.from({ length: 11 }, (_, i) => click('r0', i * 100))
    const s = liveActionsToStrategy(clicks, 'idler', 'x')
    expect(s.actions).toEqual([{ kind: 'set_click_rate', resource: 'r0', cps: 10 }])
  })

  it('orders the click rate relative to buys by timestamp', () => {
    // Clicking starts at t=0, a buy lands mid-run at t=250.
    const clicks = [click('r0', 0), click('r0', 100), click('r0', 200), click('r0', 300)]
    const s = liveActionsToStrategy([...clicks, buy('u1', 250)], 'idler', 'x')
    expect(s.actions).toEqual([
      { kind: 'set_click_rate', resource: 'r0', cps: 10 },
      { kind: 'buy', upgradeId: 'u1' },
    ])
  })

  it('splits phases on a long pause and on a resource change', () => {
    const s = liveActionsToStrategy(
      [
        click('r0', 0),
        click('r0', 100),
        click('r0', 200), // r0 phase: 2 intervals / 0.2s = 10 cps
        click('r1', 2000),
        click('r1', 2100),
        click('r1', 2200), // r1 phase after a >1s gap: 10 cps
      ],
      'idler',
      'x',
    )
    expect(s.actions).toEqual([
      { kind: 'set_click_rate', resource: 'r0', cps: 10 },
      { kind: 'set_click_rate', resource: 'r1', cps: 10 },
    ])
  })

  it('drops lone clicks (a rate needs at least two)', () => {
    const s = liveActionsToStrategy([click('r0', 0), buy('u1', 5000)], 'idler', 'x')
    expect(s.actions).toEqual([{ kind: 'buy', upgradeId: 'u1' }])
  })

  it('clamps a rapid click burst to MAX_CPS', () => {
    // 5 clicks within 10ms → very high measured rate, clamped to 20.
    const s = liveActionsToStrategy(
      [click('r0', 0), click('r0', 2), click('r0', 4), click('r0', 6), click('r0', 8)],
      'idler',
      'x',
    )
    expect(s.actions).toEqual([{ kind: 'set_click_rate', resource: 'r0', cps: 20 }])
  })
})
