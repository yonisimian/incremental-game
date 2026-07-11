import { describe, expect, it } from 'vitest'

import type { ModeDefinition } from '../src/modes/types.js'
import { createInitialState } from '../src/modes/index.js'
import type { PlayerState, UpgradeDefinition } from '../src/types.js'
import {
  applySimAction,
  parseStrategy,
  serializeStrategy,
  simulate,
  validateStrategyForMode,
} from '../src/simulation/index.js'
import type { QueueStrategy } from '../src/simulation/index.js'

// ─── Synthetic mode ──────────────────────────────────────────────────
//
// 2 r0/sec passive + 1 r0/click. One generator (g0, cost 10 ×2), one repeatable
// upgrade (u_rep, cost 20 flat, limit 3), and a two-option choice group.

function makeMode(): ModeDefinition {
  const upgrades: UpgradeDefinition[] = [
    { id: 'u_rep', cost: { r0: { baseCost: 20 } }, purchaseLimit: 3 },
    { id: 'cA', cost: { r0: { baseCost: 5 } }, purchaseLimit: 1, choiceGroup: 'grp' },
    { id: 'cB', cost: { r0: { baseCost: 5 } }, purchaseLimit: 1, choiceGroup: 'grp' },
  ]
  return {
    resources: ['r0'],
    scoreResource: 'r0',
    upgrades,
    goals: [{ type: 'timed', label: '⏱ Timed', durationSec: 30 }],
    nativeModifiers: [
      { stage: 'additive', field: 'r0', value: 2 }, // 2 r0/sec passive
      { stage: 'additive', field: 'clickIncome', value: 1 }, // 1 r0/click
    ],
    clicksEnabled: true,
    highlightEnabled: true,
    initialResources: { r0: 0 },
    initialMeta: {},
    generators: [
      {
        id: 'g0',
        cost: { r0: { baseCost: 10, scaleType: 'exponential', scaleFactor: 2 } },
        production: { resource: 'r0', rate: 1 },
      },
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
        resources: [{ key: 'r0', displayName: 'Res', icon: '🔵' }],
        upgrades: [],
        generators: [{ id: 'g0', name: 'g0', icon: '⚙️' }],
        attacks: [],
        pacts: [],
      },
    ],
  }
}

const mode = makeMode()
const upgradeMap = new Map(mode.upgrades.map((u) => [u.id, u]))

function strat(actions: QueueStrategy['actions']): QueueStrategy {
  return { version: 1, name: 't', mode: 'idler', actions }
}

// ─── Engine: advance-until-then-apply ─────────────────────────────────

describe('simulate — blocking buy derives its fire-time', () => {
  it('buys a generator the tick it becomes affordable', () => {
    // 2 r0/sec → 10 r0 at t=5s → g0 (cost 10) fires at t=5.
    const result = simulate(strat([{ kind: 'buy_generator', generatorId: 'g0' }]), {
      modeDef: mode,
    })
    expect(result.events).toHaveLength(1)
    expect(result.events[0].label).toBe('gen:g0')
    expect(result.events[0].timeSec).toBe(5)
    expect(result.notReached).toHaveLength(0)
  })
})

describe('simulate — count buys, capped at purchaseLimit', () => {
  it('buys back-to-back and reports the capped remainder', () => {
    const result = simulate(strat([{ kind: 'buy', upgradeId: 'u_rep', count: 5 }]), {
      modeDef: mode,
      roundDurationSec: 60,
    })
    const buys = result.events.filter((e) => e.label === 'buy:u_rep')
    expect(buys.map((e) => e.timeSec)).toEqual([10, 20, 30]) // 20 r0 each at 2/sec
    expect(result.notReached).toHaveLength(1)
    expect(result.notReached[0].reason).toBe('maxed')
    expect(result.notReached[0].boughtSoFar).toBe(3)
  })
})

describe('simulate — background clicking', () => {
  it('set_click_rate adds click income for the whole run', () => {
    // passive 2/sec × 30 = 60; clicks: 1/click × 10 cps × 30s = 300 → 360.
    const result = simulate(strat([{ kind: 'set_click_rate', cps: 10 }]), { modeDef: mode })
    expect(result.finalScore).toBeCloseTo(360, 1)
  })

  it('stops clicking when the rate is set back to 0', () => {
    // click 4cps until a 5s wait elapses, then stop. clicks: 1×4×5 = 20; passive 60 → 80.
    const result = simulate(
      strat([
        { kind: 'set_click_rate', cps: 4 },
        { kind: 'wait', until: { kind: 'seconds', seconds: 5 } },
        { kind: 'set_click_rate', cps: 0 },
      ]),
      { modeDef: mode },
    )
    expect(result.finalScore).toBeCloseTo(80, 1)
    const stop = result.events.find((e) => e.label === 'click:0')
    expect(stop?.timeSec).toBe(5)
  })
})

describe('simulate — wait predicates', () => {
  it('resource_at_least gates the following action', () => {
    const result = simulate(
      strat([
        { kind: 'wait', until: { kind: 'resource_at_least', resource: 'r0', amount: 10 } },
        { kind: 'buy_generator', generatorId: 'g0' },
      ]),
      { modeDef: mode },
    )
    const gen = result.events.find((e) => e.label === 'gen:g0')
    expect(gen?.timeSec).toBe(5) // r0 hits 10 at t=5, then buy fires same tick
    expect(result.notReached).toHaveLength(0)
  })
})

describe('simulate — structural blocks are reported, not stalled', () => {
  it('skips a choice-group sibling once one option is taken', () => {
    const result = simulate(
      strat([
        { kind: 'buy', upgradeId: 'cA' },
        { kind: 'buy', upgradeId: 'cB' },
      ]),
      { modeDef: mode },
    )
    expect(result.events.map((e) => e.label)).toEqual(['buy:cA'])
    expect(result.notReached).toHaveLength(1)
    expect(result.notReached[0].reason).toBe('choice-group')
  })
})

describe('simulate — round-end reporting', () => {
  it('reports an unaffordable buy left in the queue when time runs out', () => {
    // g0 costs 10; at 2 r0/sec only 4 r0 accrue in a 2s round.
    const result = simulate(strat([{ kind: 'buy_generator', generatorId: 'g0' }]), {
      modeDef: mode,
      roundDurationSec: 2,
    })
    expect(result.events).toHaveLength(0)
    expect(result.notReached).toHaveLength(1)
    expect(result.notReached[0].reason).toBe('unaffordable')
    expect(result.notReached[0].boughtSoFar).toBe(0)
  })

  it('marks actions the cursor never reached as round-ended', () => {
    const result = simulate(
      strat([
        { kind: 'buy_generator', generatorId: 'g0' }, // blocks the whole 2s round
        { kind: 'set_highlight', highlight: 'r0' },
      ]),
      { modeDef: mode, roundDurationSec: 2 },
    )
    expect(result.notReached.map((n) => n.reason)).toEqual(['unaffordable', 'round-ended'])
  })
})

describe('simulate — goals', () => {
  it('score goal stops early once the target is reached', () => {
    // passive 2 r0/sec → score target 20 reached ~10s, well under the cap.
    const result = simulate(strat([]), {
      modeDef: mode,
      goal: { kind: 'score', target: 20, safetyCapSec: 120 },
    })
    expect(result.finalScore).toBeGreaterThanOrEqual(20)
    expect(result.snapshots.at(-1)!.timeSec).toBeLessThan(120)
  })

  it('score goal stops at the safety cap when unreachable', () => {
    const result = simulate(strat([]), {
      modeDef: mode,
      goal: { kind: 'score', target: 1e9, safetyCapSec: 3 },
    })
    expect(result.snapshots.at(-1)!.timeSec).toBeCloseTo(3, 1)
    expect(result.finalScore).toBeLessThan(1e9)
  })

  it('race_to_buy stops when the final purchase fires', () => {
    // u_rep costs 20; at 2 r0/sec it becomes affordable ~10s, completing the queue.
    const result = simulate(strat([{ kind: 'buy', upgradeId: 'u_rep', count: 1 }]), {
      modeDef: mode,
      goal: { kind: 'race_to_buy', safetyCapSec: 120 },
    })
    expect(result.notReached).toHaveLength(0)
    expect(result.events.some((e) => e.kind === 'buy')).toBe(true)
    expect(result.snapshots.at(-1)!.timeSec).toBeLessThan(120)
  })

  it('race_to_buy hits the cap when the final purchase never becomes affordable', () => {
    const result = simulate(strat([{ kind: 'buy', upgradeId: 'u_rep', count: 3 }]), {
      modeDef: mode,
      goal: { kind: 'race_to_buy', safetyCapSec: 2 },
    })
    expect(result.snapshots.at(-1)!.timeSec).toBeCloseTo(2, 1)
    expect(result.notReached.length).toBeGreaterThan(0)
  })
})

// ─── applySimAction (pure single step) ────────────────────────────────

describe('applySimAction', () => {
  function state(overrides?: Partial<PlayerState>): PlayerState {
    return { ...createInitialState(mode), ...overrides }
  }

  it('applies an affordable generator purchase', () => {
    const s = state({ resources: { r0: 100 } })
    const r = applySimAction(s, { kind: 'buy_generator', generatorId: 'g0' }, mode, upgradeMap)
    expect(r.status).toBe('applied')
    expect(s.generators.g0).toBe(1)
    expect(s.resources.r0).toBe(90)
  })

  it('reports an unaffordable purchase as transient', () => {
    const r = applySimAction(
      state(),
      { kind: 'buy_generator', generatorId: 'g0' },
      mode,
      upgradeMap,
    )
    expect(r).toEqual({ status: 'transient', reason: 'unaffordable' })
  })

  it('reports a maxed upgrade as a permanent block', () => {
    const s = state({ resources: { r0: 100 }, upgrades: { u_rep: 3 } })
    const r = applySimAction(s, { kind: 'buy', upgradeId: 'u_rep' }, mode, upgradeMap)
    expect(r).toEqual({ status: 'permanent', reason: 'maxed' })
  })

  it('sets the highlight instantly', () => {
    const s = state()
    const r = applySimAction(s, { kind: 'set_highlight', highlight: 'r0' }, mode, upgradeMap)
    expect(r.status).toBe('applied')
    expect(s.meta.highlight).toBe('r0')
  })
})

// ─── Schema / validation ──────────────────────────────────────────────

describe('parseStrategy', () => {
  it('accepts a well-formed strategy', () => {
    const s = parseStrategy(strat([{ kind: 'buy', upgradeId: 'u_rep', count: 2 }]))
    expect(s.actions).toHaveLength(1)
  })

  it('rejects a cps above MAX_CPS', () => {
    expect(() => parseStrategy(strat([{ kind: 'set_click_rate', cps: 25 }]))).toThrow()
  })

  it('rejects a non-positive count', () => {
    expect(() => parseStrategy(strat([{ kind: 'buy', upgradeId: 'u_rep', count: 0 }]))).toThrow()
  })
})

describe('serializeStrategy — round-trip', () => {
  const full = strat([
    { kind: 'buy', upgradeId: 'u_rep', count: 2 },
    { kind: 'buy_generator', generatorId: 'g0' },
    { kind: 'set_highlight', highlight: 'r0' },
    { kind: 'set_click_rate', resource: 'r0', cps: 5 },
    { kind: 'set_click_rate', cps: 3 },
    { kind: 'wait', until: { kind: 'seconds', seconds: 5 } },
    { kind: 'wait', until: { kind: 'resource_at_least', resource: 'r0', amount: 100 } },
  ])

  it('parse(serialize(s)) preserves the strategy', () => {
    expect(parseStrategy(JSON.parse(serializeStrategy(full)))).toEqual(full)
  })

  it('is byte-stable across repeated round-trips', () => {
    const once = serializeStrategy(full)
    const twice = serializeStrategy(parseStrategy(JSON.parse(once)))
    expect(twice).toBe(once)
  })

  it('emits a fixed key order regardless of input key order', () => {
    // Same buy action, keys authored back-to-front — output must be identical.
    const scrambled = strat([{ count: 2, upgradeId: 'u_rep', kind: 'buy' } as never])
    const canonical = strat([{ kind: 'buy', upgradeId: 'u_rep', count: 2 }])
    expect(serializeStrategy(scrambled)).toBe(serializeStrategy(canonical))
    // `kind` is serialized before its payload.
    expect(serializeStrategy(canonical).indexOf('"kind"')).toBeLessThan(
      serializeStrategy(canonical).indexOf('"upgradeId"'),
    )
  })

  it('ends with a trailing newline', () => {
    expect(serializeStrategy(full).endsWith('}\n')).toBe(true)
  })
})

describe('validateStrategyForMode', () => {
  it('flags references to unknown IDs', () => {
    const problems = validateStrategyForMode(
      strat([
        { kind: 'buy', upgradeId: 'nope' },
        { kind: 'buy_generator', generatorId: 'g0' },
      ]),
      mode,
    )
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('nope')
  })

  it('returns no problems for a valid strategy', () => {
    expect(
      validateStrategyForMode(strat([{ kind: 'set_highlight', highlight: 'r0' }]), mode),
    ).toEqual([])
  })
})
