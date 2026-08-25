import { describe, expect, it } from 'vitest'
import {
  collectGeneratorOutputs,
  collectModifiers,
  computeRateBreakdown,
} from '../src/modes/index.js'
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
  return {
    score: 0,
    resources: {},
    upgrades: {},
    generators: {},
    pendingAttacks: [],
    meta: {},
    ...overrides,
  }
}

/** The rate the game actually applies — the number `computeRateBreakdown.total` must match. */
function truthRate(state: PlayerState, mode: ModeDefinition, resource: string): number {
  return computePassiveRates(collectModifiers(state, mode), mode.resources)[resource] ?? 0
}

// ─── Tests ───────────────────────────────────────────────────────────

describe('computeRateBreakdown', () => {
  it('attributes the mode’s starting effects to base', () => {
    const mode = makeMode({
      effects: [{ type: 'baseModifier', stage: 'additive', field: 'r0', value: 2 }],
    })
    const bd = computeRateBreakdown(makeState(), mode).r0
    expect(bd.total).toBe(2)
    expect(bd.base).toBe(2)
    expect(bd.generators).toBe(0)
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

  it('splits the generator bucket across generators by output', () => {
    const mode = makeMode({ generators: [makeGen('g0', 'r0', 1), makeGen('g1', 'r0', 5)] })
    const bd = computeRateBreakdown(makeState({ generators: { g0: 2, g1: 2 } }), mode).r0
    // raw: g0 = 2, g1 = 10 → total 12
    expect(bd.generators).toBeCloseTo(12)
    expect(bd.byGenerator.g0).toBeCloseTo(2)
    expect(bd.byGenerator.g1).toBeCloseTo(10)
    const sum = Object.values(bd.byGenerator).reduce((a, b) => a + b, 0)
    expect(sum).toBeCloseTo(bd.generators)
  })

  it('weights the split by effective output, not the authored rate', () => {
    // g0 and g1 produce the same raw rate, but a ×3 lands on g1 alone — it must
    // report three times g0's share, not an equal one.
    const boost: UpgradeDefinition = {
      id: 'u0',
      cost: { r0: { baseCost: 10, scaleType: 'exponential', scaleFactor: 1 } },
      purchaseLimit: 1,
      effects: [{ type: 'baseModifier', stage: 'multiplicative', field: 'g1', value: 3 }],
    }
    const mode = makeMode({
      generators: [makeGen('g0', 'r0', 2), makeGen('g1', 'r0', 2)],
      upgrades: [boost],
    })
    const state = makeState({ generators: { g0: 1, g1: 1 }, upgrades: { u0: 1 } })
    const bd = computeRateBreakdown(state, mode).r0
    expect(bd.total).toBeCloseTo(8) // 2 + 2×3
    expect(bd.byGenerator.g0).toBeCloseTo(2)
    expect(bd.byGenerator.g1).toBeCloseTo(6)
  })

  it('buckets always sum to the authoritative total', () => {
    const upgrade: UpgradeDefinition = {
      id: 'u0',
      cost: { r0: { baseCost: 10, scaleType: 'exponential', scaleFactor: 1 } },
      purchaseLimit: 5,
      effects: [{ type: 'baseModifier', stage: 'additive', field: 'r0', value: 1.5 }],
    }
    const mode = makeMode({
      effects: [{ type: 'baseModifier', stage: 'additive', field: 'r0', value: 1 }],
      generators: [makeGen('g0', 'r0', 2)],
      upgrades: [upgrade],
    })
    const state = makeState({ generators: { g0: 3 }, upgrades: { u0: 2 } })
    const bd = computeRateBreakdown(state, mode).r0
    expect(bd.base + bd.generators).toBeCloseTo(bd.total)
    expect(bd.total).toBeCloseTo(truthRate(state, mode, 'r0'))
    // The upgrade boosts the base producer, so its contribution lands in `base`:
    // starting 1 + 2 × 1.5 = 4.
    expect(bd.base).toBeCloseTo(4)
  })

  it('telescopes correctly when a shared multiplicative modifier is present', () => {
    // A ×2 multiplicative on the resource scales every additive source; each
    // bucket must reflect its share of the multiplied total.
    const mode = makeMode({
      effects: [
        { type: 'baseModifier', stage: 'additive', field: 'r0', value: 1 },
        { type: 'baseModifier', stage: 'multiplicative', field: 'r0', value: 2 },
      ],
      generators: [makeGen('g0', 'r0', 3)],
    })
    const state = makeState({ generators: { g0: 2 } })
    const bd = computeRateBreakdown(state, mode).r0
    // total = (starting 1 + gen 6) * 2 = 14
    expect(bd.total).toBeCloseTo(14)
    expect(bd.base).toBeCloseTo(2) // starting 1 * 2
    expect(bd.generators).toBeCloseTo(12) // gen 6 * 2
    expect(bd.base + bd.generators).toBeCloseTo(bd.total)
  })

  it('folds debuffs into the total', () => {
    const mode = makeMode({
      effects: [{ type: 'baseModifier', stage: 'additive', field: 'r0', value: 10 }],
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

describe('collectGeneratorOutputs', () => {
  /** An upgrade granting `effects` to some generator. */
  function makeBoost(id: string, effects: UpgradeDefinition['effects']): UpgradeDefinition {
    return {
      id,
      cost: { r0: { baseCost: 10, scaleType: 'exponential', scaleFactor: 1 } },
      purchaseLimit: 5,
      effects,
    }
  }

  it('reports an unboosted generator as its authored rate', () => {
    const mode = makeMode({ generators: [makeGen('g0', 'r0', 2)] })
    expect(collectGeneratorOutputs(makeState({ generators: { g0: 3 } }), mode).g0).toEqual({
      owned: 3,
      ratePerUnit: 2,
      additivePerUnit: 0,
      multiplier: 1,
      effective: 6,
    })
  })

  it('keeps additive and multiplicative bonuses apart', () => {
    const mode = makeMode({
      generators: [makeGen('g0', 'r0', 2)],
      upgrades: [
        makeBoost('u0', [{ type: 'baseModifier', stage: 'additive', field: 'g0', value: 0.5 }]),
        makeBoost('u1', [
          { type: 'baseModifier', stage: 'multiplicative', field: 'g0', value: 1.5 },
        ]),
      ],
    })
    const state = makeState({ generators: { g0: 4 }, upgrades: { u0: 2, u1: 2 } })
    const out = collectGeneratorOutputs(state, mode).g0
    // Both compound with the owning upgrade's count: additive ×2, multiplicative ^2.
    expect(out.additivePerUnit).toBeCloseTo(1)
    expect(out.multiplier).toBeCloseTo(2.25)
    expect(out.effective).toBeCloseTo((2 + 1) * 4 * 2.25)
  })

  it('reports every generator, including unowned ones', () => {
    const mode = makeMode({ generators: [makeGen('g0', 'r0', 2), makeGen('g1', 'r1', 5)] })
    const outputs = collectGeneratorOutputs(makeState({ generators: { g0: 1 } }), mode)
    expect(Object.keys(outputs)).toEqual(['g0', 'g1'])
    expect(outputs.g1).toMatchObject({ owned: 0, effective: 0 })
  })

  it('sums to what the pipeline actually receives', () => {
    const mode = makeMode({
      generators: [makeGen('g0', 'r0', 2), makeGen('g1', 'r0', 5)],
      upgrades: [makeBoost('u0', [{ type: 'lowerTierBoost', perUnit: 0.1 }])],
    })
    const state = makeState({ generators: { g0: 3, g1: 2 }, upgrades: { u0: 1 } })
    const outputs = collectGeneratorOutputs(state, mode)
    const summed = outputs.g0.effective + outputs.g1.effective
    expect(summed).toBeCloseTo(truthRate(state, mode, 'r0'))
  })
})
