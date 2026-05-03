import { describe, expect, it } from 'vitest'
import type { ModeDefinition } from '../src/modes/types.js'
import { getGeneratorCost, canAffordGenerator, applyGeneratorPurchase } from '../src/generators.js'
import type { GeneratorDefinition, PlayerState } from '../src/types.js'

// ─── Helpers ─────────────────────────────────────────────────────────

function makeDef(overrides?: Partial<GeneratorDefinition>): GeneratorDefinition {
  return {
    id: 'g0',
    baseCost: 10,
    costScaling: 1.5,
    costCurrency: 'r0',
    production: { resource: 'r0', rate: 1 },
    ...overrides,
  }
}

function makeState(overrides?: Partial<PlayerState>): PlayerState {
  return {
    resources: { r0: 100 },
    upgrades: {},
    generators: {},
    meta: {},
    ...overrides,
  }
}

function makeMode(generators: GeneratorDefinition[]): ModeDefinition {
  return {
    resources: ['r0'],
    scoreResource: 'r0',
    upgrades: [],
    goals: [{ type: 'timed', durationSec: 30 }],
    nativeModifiers: [],
    clicksEnabled: false,
    highlightEnabled: false,
    initialResources: { r0: 0 },
    initialMeta: {},
    generators,
    flavor: {
      themeClass: 'test',
      scoreLabel: 'Score',
      showClickStats: false,
      resources: [{ key: 'r0', displayName: 'Res', icon: '🔵' }],
      upgrades: [],
      generators: generators.map((g) => ({ id: g.id, name: g.id, icon: '⚙️' })),
    },
  }
}

// ─── getGeneratorCost ────────────────────────────────────────────────

describe('getGeneratorCost', () => {
  it('returns baseCost when 0 owned', () => {
    expect(getGeneratorCost(makeDef({ baseCost: 10, costScaling: 1.5 }), 0)).toBe(10)
  })

  it('scales exponentially with owned count', () => {
    const def = makeDef({ baseCost: 10, costScaling: 2 })
    expect(getGeneratorCost(def, 1)).toBe(20) // 10 * 2^1
    expect(getGeneratorCost(def, 2)).toBe(40) // 10 * 2^2
    expect(getGeneratorCost(def, 3)).toBe(80) // 10 * 2^3
  })

  it('floors fractional costs', () => {
    const def = makeDef({ baseCost: 10, costScaling: 1.5 })
    // 10 * 1.5^1 = 15
    expect(getGeneratorCost(def, 1)).toBe(15)
    // 10 * 1.5^2 = 22.5 → 22
    expect(getGeneratorCost(def, 2)).toBe(22)
    // 10 * 1.5^3 = 33.75 → 33
    expect(getGeneratorCost(def, 3)).toBe(33)
  })

  it('handles costScaling of 1 (constant cost)', () => {
    const def = makeDef({ baseCost: 25, costScaling: 1 })
    expect(getGeneratorCost(def, 0)).toBe(25)
    expect(getGeneratorCost(def, 5)).toBe(25)
    expect(getGeneratorCost(def, 100)).toBe(25)
  })
})

// ─── canAffordGenerator ──────────────────────────────────────────────

describe('canAffordGenerator', () => {
  it('returns true when player has exactly enough', () => {
    const def = makeDef({ baseCost: 100 })
    const state = makeState({ resources: { r0: 100 } })
    expect(canAffordGenerator(state, def)).toBe(true)
  })

  it('returns true when player has more than enough', () => {
    const def = makeDef({ baseCost: 10 })
    const state = makeState({ resources: { r0: 999 } })
    expect(canAffordGenerator(state, def)).toBe(true)
  })

  it('returns false when player cannot afford', () => {
    const def = makeDef({ baseCost: 100 })
    const state = makeState({ resources: { r0: 99 } })
    expect(canAffordGenerator(state, def)).toBe(false)
  })

  it('accounts for owned count when checking affordability', () => {
    const def = makeDef({ baseCost: 10, costScaling: 2 })
    // Owns 2 → cost = 10 * 2^2 = 40
    const state = makeState({ resources: { r0: 39 }, generators: { g0: 2 } })
    expect(canAffordGenerator(state, def)).toBe(false)

    state.resources.r0 = 40
    expect(canAffordGenerator(state, def)).toBe(true)
  })

  it('treats missing resource as 0', () => {
    const def = makeDef({ baseCost: 1, costCurrency: 'r1' })
    const state = makeState({ resources: { r0: 100 } }) // no r1
    expect(canAffordGenerator(state, def)).toBe(false)
  })

  it('treats missing generator count as 0', () => {
    const def = makeDef({ baseCost: 10 })
    const state = makeState({ resources: { r0: 10 }, generators: {} })
    expect(canAffordGenerator(state, def)).toBe(true) // cost = baseCost when 0 owned
  })
})

// ─── applyGeneratorPurchase ──────────────────────────────────────────

describe('applyGeneratorPurchase', () => {
  it('deducts cost and increments owned count', () => {
    const def = makeDef({ baseCost: 10, costScaling: 1 })
    const mode = makeMode([def])
    const state = makeState({ resources: { r0: 50 }, generators: {} })

    applyGeneratorPurchase(state, 'g0', mode)

    expect(state.resources.r0).toBe(40) // 50 - 10
    expect(state.generators.g0).toBe(1)
  })

  it('scales cost for subsequent purchases', () => {
    const def = makeDef({ baseCost: 10, costScaling: 2 })
    const mode = makeMode([def])
    const state = makeState({ resources: { r0: 100 }, generators: { g0: 1 } })

    // Owned 1 → cost = 10 * 2^1 = 20
    applyGeneratorPurchase(state, 'g0', mode)

    expect(state.resources.r0).toBe(80) // 100 - 20
    expect(state.generators.g0).toBe(2)
  })

  it('does nothing when generator id is not found in mode', () => {
    const def = makeDef({ id: 'g0' })
    const mode = makeMode([def])
    const state = makeState({ resources: { r0: 100 } })

    applyGeneratorPurchase(state, 'g_nonexistent', mode)

    expect(state.resources.r0).toBe(100) // unchanged
    expect(state.generators).toEqual({}) // unchanged
  })

  it('handles first purchase when generators record is empty', () => {
    const def = makeDef({ baseCost: 5, costScaling: 1.5 })
    const mode = makeMode([def])
    const state = makeState({ resources: { r0: 20 }, generators: {} })

    applyGeneratorPurchase(state, 'g0', mode)

    expect(state.resources.r0).toBe(15) // 20 - 5
    expect(state.generators.g0).toBe(1)
  })
})
