import { describe, expect, it } from 'vitest'
import { computeRateBreakdown, collectModifiers } from '../src/modes/index.js'
import { computePassiveRates } from '../src/modifiers/pipeline.js'
import type { ModeDefinition } from '../src/modes/types.js'
import type { Modifier } from '../src/modifiers/types.js'
import type { GeneratorDefinition, PlayerState, UpgradeDefinition } from '../src/types.js'

// ─── Helpers ─────────────────────────────────────────────────────────

function makeGen(
  id: string,
  resource: string,
  rate: number,
  costCurrency = 'r0',
): GeneratorDefinition {
  return {
    id,
    cost: { [costCurrency]: { baseCost: 10, scaleType: 'exponential', scaleFactor: 1.5 } },
    production: { resource, rate },
  }
}

function makeMode(overrides?: Partial<ModeDefinition>): ModeDefinition {
  const resources = overrides?.resources ?? ['r0']
  const generators = overrides?.generators ?? []
  const upgrades = overrides?.upgrades ?? []
  return {
    resources,
    scoreResource: resources[0],
    upgrades,
    goals: [{ type: 'timed', label: '⏱ Timed', durationSec: 30 }],
    nativeModifiers: [],
    clicksEnabled: false,
    highlightEnabled: false,
    initialResources: {},
    initialMeta: {},
    generators,
    attacks: [],
    pacts: [],
    flavors: [
      {
        id: 'test',
        displayName: 'Test',
        themeClass: 'test',
        scoreLabel: 'Score',
        showClickStats: false,
        resources: resources.map((key) => ({ key, displayName: key, icon: '🔵' })),
        upgrades: upgrades.map((u) => ({ id: u.id, name: u.id, icon: '⬆️', description: '' })),
        generators: generators.map((g) => ({ id: g.id, name: g.id, icon: '⚙️' })),
        attacks: [],
        pacts: [],
      },
    ],
    ...overrides,
  }
}

function makeState(overrides?: Partial<PlayerState>): PlayerState {
  return { score: 0, resources: {}, upgrades: {}, generators: {}, meta: {}, ...overrides }
}

/** The rate the game actually applies — the number `computeRateBreakdown.total` must match. */
function truthRate(state: PlayerState, mode: ModeDefinition, resource: string): number {
  return computePassiveRates(collectModifiers(state, mode), mode.resources)[resource] ?? 0
}

// ─── Tests ───────────────────────────────────────────────────────────

describe('computeRateBreakdown', () => {
  it('attributes native modifiers to base', () => {
    const mode = makeMode({
      nativeModifiers: [{ stage: 'additive', field: 'r0', value: 2 }],
    })
    const bd = computeRateBreakdown(makeState(), mode).r0
    expect(bd.total).toBe(2)
    expect(bd.base).toBe(2)
    expect(bd.generators).toBe(0)
    expect(bd.upgrades).toBe(0)
  })

  it('attributes generator output to the generators bucket', () => {
    const gen = makeGen('g0', 'r0', 3)
    const mode = makeMode({ generators: [gen] })
    const bd = computeRateBreakdown(makeState({ generators: { g0: 4 } }), mode).r0
    expect(bd.total).toBe(12) // 3 * 4
    expect(bd.generators).toBe(12)
    expect(bd.base).toBe(0)
    expect(bd.byGenerator.g0).toBe(12)
  })

  it('splits the generator bucket across generators by raw output', () => {
    const mode = makeMode({ generators: [makeGen('g0', 'r0', 1), makeGen('g1', 'r0', 5)] })
    const bd = computeRateBreakdown(makeState({ generators: { g0: 2, g1: 2 } }), mode).r0
    // raw: g0 = 2, g1 = 10 → total 12
    expect(bd.generators).toBeCloseTo(12)
    expect(bd.byGenerator.g0).toBeCloseTo(2)
    expect(bd.byGenerator.g1).toBeCloseTo(10)
    const sum = Object.values(bd.byGenerator).reduce((a, b) => a + b, 0)
    expect(sum).toBeCloseTo(bd.generators)
  })

  it('buckets always sum to the authoritative total', () => {
    const upgrade: UpgradeDefinition = {
      id: 'u0',
      cost: { r0: { baseCost: 10, scaleType: 'exponential', scaleFactor: 1 } },
      purchaseLimit: 5,
      effects: [{ type: 'baseModifier', stage: 'additive', field: 'r0', value: 1.5 }],
    }
    const mode = makeMode({
      nativeModifiers: [{ stage: 'additive', field: 'r0', value: 1 }],
      generators: [makeGen('g0', 'r0', 2)],
      upgrades: [upgrade],
    })
    const state = makeState({ generators: { g0: 3 }, upgrades: { u0: 2 } })
    const bd = computeRateBreakdown(state, mode).r0
    expect(bd.base + bd.generators + bd.upgrades).toBeCloseTo(bd.total)
    expect(bd.total).toBeCloseTo(truthRate(state, mode, 'r0'))
  })

  it('telescopes correctly when a shared multiplicative modifier is present', () => {
    // A ×2 multiplicative on the resource scales every additive source; each
    // bucket must reflect its share of the multiplied total.
    const mode = makeMode({
      nativeModifiers: [
        { stage: 'additive', field: 'r0', value: 1 },
        { stage: 'multiplicative', field: 'r0', value: 2 },
      ],
      generators: [makeGen('g0', 'r0', 3)],
    })
    const state = makeState({ generators: { g0: 2 } })
    const bd = computeRateBreakdown(state, mode).r0
    // total = (native 1 + gen 6) * 2 = 14
    expect(bd.total).toBeCloseTo(14)
    expect(bd.base).toBeCloseTo(2) // native 1 * 2
    expect(bd.generators).toBeCloseTo(12) // gen 6 * 2
    expect(bd.base + bd.generators + bd.upgrades).toBeCloseTo(bd.total)
  })

  it('folds debuffs into the total', () => {
    const mode = makeMode({
      nativeModifiers: [{ stage: 'additive', field: 'r0', value: 10 }],
    })
    const debuffs: Modifier[] = [{ stage: 'multiplicative', field: 'r0', value: 0.5 }]
    const bd = computeRateBreakdown(makeState(), mode, debuffs).r0
    expect(bd.total).toBeCloseTo(5) // 10 * 0.5
  })

  it('handles multiple resources independently', () => {
    const mode = makeMode({
      resources: ['r0', 'r1'],
      generators: [makeGen('g0', 'r0', 2), makeGen('g1', 'r1', 5)],
    })
    const state = makeState({ generators: { g0: 3, g1: 1 } })
    const bd = computeRateBreakdown(state, mode)
    expect(bd.r0.generators).toBe(6)
    expect(bd.r1.generators).toBe(5)
    expect(bd.r0.byGenerator.g1).toBeUndefined()
  })
})
