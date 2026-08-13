import { describe, expect, it } from 'vitest'
import { collectDynamicBonuses } from '../src/modes/index.js'
import type { ModeDefinition } from '../src/modes/types.js'
import type {
  EffectRef,
  GeneratorDefinition,
  PlayerState,
  UpgradeDefinition,
} from '../src/types.js'

// ─── Helpers ─────────────────────────────────────────────────────────

function makeUpgrade(id: string, effects: EffectRef[]): UpgradeDefinition {
  return { id, cost: { r0: { baseCost: 10 } }, purchaseLimit: 5, effects }
}

function makeGen(id: string, resource: string, rate: number): GeneratorDefinition {
  return { id, cost: { r0: { baseCost: 10 } }, production: { resource, rate } }
}

function makeMode(overrides?: Partial<ModeDefinition>): ModeDefinition {
  const upgrades = overrides?.upgrades ?? []
  const generators = overrides?.generators ?? []
  return {
    resources: ['r0', 'r1'],
    scoreResource: 'r0',
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
        resources: [
          { key: 'r0', displayName: 'r0', icon: '🪵' },
          { key: 'r1', displayName: 'r1', icon: '🍺' },
        ],
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

/** A bank: +1% base r0/s per 1000 r0 held (the `be-mr-bank` shape). */
const bank: EffectRef = {
  type: 'relativeModifier',
  source: 'resource:r0',
  field: 'b0',
  stage: 'multiplicative',
  factor: 0.00001,
}

// ─── Tests ───────────────────────────────────────────────────────────

describe('collectDynamicBonuses', () => {
  it('reports an owned dynamic upgrade with its value for the current state', () => {
    const mode = makeMode({ upgrades: [makeUpgrade('u0', [bank])] })
    const state = makeState({ upgrades: { u0: 1 }, resources: { r0: 25_000 } })
    expect(collectDynamicBonuses(state, mode)).toEqual([
      { upgradeId: 'u0', modifiers: [{ stage: 'multiplicative', field: 'b0', value: 1.25 }] },
    ])
  })

  it('tracks state — the same upgrade is worth more with a bigger stockpile', () => {
    const mode = makeMode({ upgrades: [makeUpgrade('u0', [bank])] })
    const value = (r0: number): number =>
      collectDynamicBonuses(makeState({ upgrades: { u0: 1 }, resources: { r0 } }), mode)[0]
        .modifiers[0].value
    expect(value(100_000)).toBeGreaterThan(value(25_000))
  })

  it('omits flat upgrades — their worth is already on the card', () => {
    const flat: EffectRef = { type: 'baseModifier', stage: 'additive', field: 'r0', value: 5 }
    const mode = makeMode({ upgrades: [makeUpgrade('u0', [flat])] })
    expect(collectDynamicBonuses(makeState({ upgrades: { u0: 3 } }), mode)).toEqual([])
  })

  it('omits unowned upgrades and dynamic effects that are currently inactive', () => {
    const mode = makeMode({
      upgrades: [makeUpgrade('u0', [bank]), makeUpgrade('u1', [bank])],
      generators: [makeGen('g0', 'r0', 1)],
    })
    // u1 unowned; u0 owned but holding nothing, so the bank pays nothing yet.
    expect(collectDynamicBonuses(makeState({ upgrades: { u0: 1 } }), mode)).toEqual([])
  })

  it('reports every modifier a multi-target dynamic effect emits', () => {
    const mode = makeMode({
      upgrades: [makeUpgrade('u0', [{ type: 'balancedGenerators', multiplier: 2 }])],
      generators: [makeGen('g0', 'r0', 1), makeGen('g1', 'r1', 1)],
    })
    const state = makeState({ upgrades: { u0: 1 }, generators: { g0: 4, g1: 4 } })
    const [bonus] = collectDynamicBonuses(state, mode)
    // Perfectly balanced: the full ×2, applied to each resource.
    expect(bonus.modifiers).toEqual([
      { stage: 'multiplicative', field: 'r0', value: 2 },
      { stage: 'multiplicative', field: 'r1', value: 2 },
    ])
  })
})
