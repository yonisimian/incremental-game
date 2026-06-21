import { describe, expect, it } from 'vitest'
import type { ModeDefinition } from '../src/modes/types.js'
import {
  getGeneratorCost,
  getGeneratorBulkCost,
  getMaxAffordableGeneratorCount,
  canAffordGenerator,
  applyGeneratorPurchase,
  isGeneratorUnlocked,
  collectGeneratorCostFactors,
  applyGeneratorCostFactors,
  resolveGeneratorDef,
} from '../src/generators.js'
import type { GeneratorDefinition, PlayerState, UpgradeDefinition } from '../src/types.js'

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
    score: 0,
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
    goals: [{ type: 'timed', label: '⏱ Timed', durationSec: 30 }],
    nativeModifiers: [],
    clicksEnabled: false,
    highlightEnabled: false,
    initialResources: { r0: 0 },
    initialMeta: {},
    generators,
    flavors: [
      {
        id: 'test',
        displayName: 'Test',
        themeClass: 'test',
        scoreLabel: 'Score',
        showClickStats: false,
        resources: [{ key: 'r0', displayName: 'Res', icon: '🔵' }],
        upgrades: [],
        generators: generators.map((g) => ({ id: g.id, name: g.id, icon: '⚙️' })),
      },
    ],
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

describe('getGeneratorBulkCost', () => {
  it('sums the cost of the next N purchases', () => {
    const def = makeDef({ baseCost: 10, costScaling: 2 })
    expect(getGeneratorBulkCost(def, 0, 3)).toBe(10 + 20 + 40)
    expect(getGeneratorBulkCost(def, 2, 2)).toBe(40 + 80)
  })

  it('returns 0 for zero quantity', () => {
    const def = makeDef({ baseCost: 10, costScaling: 1.5 })
    expect(getGeneratorBulkCost(def, 0, 0)).toBe(0)
  })
})

describe('getMaxAffordableGeneratorCount', () => {
  it('returns 0 when the player cannot afford the next copy', () => {
    const def = makeDef({ baseCost: 50 })
    const state = makeState({ resources: { r0: 25 }, generators: {} })
    expect(getMaxAffordableGeneratorCount(state, def)).toBe(0)
  })

  it('computes maximum count for constant-cost generators', () => {
    const def = makeDef({ baseCost: 10, costScaling: 1 })
    const state = makeState({ resources: { r0: 45 }, generators: {} })
    expect(getMaxAffordableGeneratorCount(state, def)).toBe(4)
  })

  it('computes maximum count for scaling generators', () => {
    const def = makeDef({ baseCost: 10, costScaling: 2 })
    const state = makeState({ resources: { r0: 100 }, generators: {} })
    // costs: 10, 20, 40, 80 → can buy 3 copies for 70
    expect(getMaxAffordableGeneratorCount(state, def)).toBe(3)
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

// ─── isGeneratorUnlocked ─────────────────────────────────────────────

describe('isGeneratorUnlocked', () => {
  it('is always unlocked when no unlockUpgrade gate is set', () => {
    const def = makeDef()
    expect(isGeneratorUnlocked(makeState({ upgrades: {} }), def)).toBe(true)
  })

  it('is locked until the gating upgrade is owned', () => {
    const def = makeDef({ unlockUpgrade: 'u-unlock' })
    expect(isGeneratorUnlocked(makeState({ upgrades: {} }), def)).toBe(false)
    expect(isGeneratorUnlocked(makeState({ upgrades: { 'u-unlock': 1 } }), def)).toBe(true)
  })
})

// ─── Generator cost factors (dp / dpf) ───────────────────────────────

function makeUpgrade(overrides: Partial<UpgradeDefinition>): UpgradeDefinition {
  return {
    id: 'u0',
    cost: { r0: 10 },
    purchaseLimit: 1,
    modifiers: [],
    ...overrides,
  }
}

function makeModeWithUpgrades(
  generators: GeneratorDefinition[],
  upgrades: UpgradeDefinition[],
): ModeDefinition {
  return { ...makeMode(generators), upgrades }
}

describe('applyGeneratorCostFactors', () => {
  it('returns the same definition for neutral factors', () => {
    const def = makeDef()
    expect(applyGeneratorCostFactors(def)).toBe(def)
    expect(applyGeneratorCostFactors(def, { costFactor: 1, scalingFactor: 1 })).toBe(def)
  })

  it('scales base cost by costFactor', () => {
    const def = makeDef({ baseCost: 100, costScaling: 1.5 })
    const adjusted = applyGeneratorCostFactors(def, { costFactor: 0.95, scalingFactor: 1 })
    expect(adjusted.baseCost).toBeCloseTo(95)
    expect(adjusted.costScaling).toBe(1.5)
  })

  it('scales the growth portion of costScaling by scalingFactor', () => {
    const def = makeDef({ baseCost: 100, costScaling: 1.5 })
    // growth 0.5 * 0.98 = 0.49 → scaling 1.49
    const adjusted = applyGeneratorCostFactors(def, { costFactor: 1, scalingFactor: 0.98 })
    expect(adjusted.costScaling).toBeCloseTo(1.49)
    expect(adjusted.baseCost).toBe(100)
  })
})

describe('collectGeneratorCostFactors', () => {
  it('returns an empty map when no owned upgrade reduces cost', () => {
    const mode = makeModeWithUpgrades(
      [makeDef()],
      [
        makeUpgrade({
          id: 'u0',
          effects: [{ type: 'generatorCost', generator: 'g0', costFactor: 0.9 }],
        }),
      ],
    )
    const state = makeState({ upgrades: {} }) // u0 not owned
    expect(collectGeneratorCostFactors(state, mode).size).toBe(0)
  })

  it('aggregates factors from an owned upgrade', () => {
    const mode = makeModeWithUpgrades(
      [makeDef()],
      [
        makeUpgrade({
          id: 'u0',
          effects: [
            { type: 'generatorCost', generator: 'g0', costFactor: 0.9, scalingFactor: 0.98 },
          ],
        }),
      ],
    )
    const state = makeState({ upgrades: { u0: 1 } })
    const factors = collectGeneratorCostFactors(state, mode).get('g0')!
    expect(factors.costFactor).toBeCloseTo(0.9)
    expect(factors.scalingFactor).toBeCloseTo(0.98)
  })

  it('compounds a repeatable upgrade by owned count (factor ** owned)', () => {
    const mode = makeModeWithUpgrades(
      [makeDef()],
      [
        makeUpgrade({
          id: 'u0',
          purchaseLimit: Infinity,
          effects: [{ type: 'generatorCost', generator: 'g0', costFactor: 0.9 }],
        }),
      ],
    )
    const state = makeState({ upgrades: { u0: 3 } })
    const factors = collectGeneratorCostFactors(state, mode).get('g0')!
    expect(factors.costFactor).toBeCloseTo(0.9 ** 3)
  })

  it('stacks factors across multiple owned upgrades', () => {
    const mode = makeModeWithUpgrades(
      [makeDef()],
      [
        makeUpgrade({
          id: 'u0',
          effects: [{ type: 'generatorCost', generator: 'g0', costFactor: 0.9 }],
        }),
        makeUpgrade({
          id: 'u1',
          effects: [{ type: 'generatorCost', generator: 'g0', costFactor: 0.5 }],
        }),
      ],
    )
    const state = makeState({ upgrades: { u0: 1, u1: 1 } })
    const factors = collectGeneratorCostFactors(state, mode).get('g0')!
    expect(factors.costFactor).toBeCloseTo(0.45)
  })
})

describe('resolveGeneratorDef', () => {
  it('applies the cost reduction granted by an owned upgrade', () => {
    const def = makeDef({ baseCost: 100, costScaling: 1.5 })
    const mode = makeModeWithUpgrades(
      [def],
      [
        makeUpgrade({
          id: 'u0',
          effects: [
            { type: 'generatorCost', generator: 'g0', costFactor: 0.95, scalingFactor: 0.98 },
          ],
        }),
      ],
    )
    const resolved = resolveGeneratorDef(def, makeState({ upgrades: { u0: 1 } }), mode)
    expect(resolved.baseCost).toBeCloseTo(95)
    expect(resolved.costScaling).toBeCloseTo(1.49)
  })

  it('returns the original definition when no reduction applies', () => {
    const def = makeDef()
    const mode = makeModeWithUpgrades([def], [])
    expect(resolveGeneratorDef(def, makeState(), mode)).toBe(def)
  })
})

describe('applyGeneratorPurchase with cost reductions', () => {
  it('charges the reduced base cost when a discount upgrade is owned', () => {
    const def = makeDef({ baseCost: 100, costScaling: 1 })
    const mode = makeModeWithUpgrades(
      [def],
      [
        makeUpgrade({
          id: 'u0',
          effects: [{ type: 'generatorCost', generator: 'g0', costFactor: 0.5 }],
        }),
      ],
    )
    const state = makeState({ resources: { r0: 100 }, upgrades: { u0: 1 }, generators: {} })

    applyGeneratorPurchase(state, 'g0', mode)

    expect(state.resources.r0).toBe(50) // 100 - (100 * 0.5)
    expect(state.generators.g0).toBe(1)
  })
})
