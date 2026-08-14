import { describe, expect, it } from 'vitest'

import {
  CURRENT_TREE_VERSION,
  collectModifiers,
  computePassiveRates,
  getModeDefinition,
  parseTree,
  parseTreeFile,
  serializeTree,
  toModeDefinition,
} from '../src/index.js'
import type { PlayerState, TreeFile } from '../src/index.js'
import idlerTreeFile from '../trees/idler.json' with { type: 'json' }

// ─── Fixtures ────────────────────────────────────────────────────────

/**
 * The canonical idler tree file (single source of truth, shared with the
 * server). Returned as `unknown` so the codec validates it like real input.
 */
function idlerTreeFileInput(): unknown {
  return idlerTreeFile
}

/** A minimal, valid single-resource tree file used as a base for failure cases. */
function minimalTree(): TreeFile {
  return {
    version: CURRENT_TREE_VERSION,
    id: 'test',
    resources: ['r0'],
    scoreResource: 'r0',
    clicksEnabled: false,
    highlightEnabled: false,
    initialResources: { r0: 0 },
    initialMeta: {},
    startingEffects: [],
    generators: [],
    attacks: [],
    pacts: [],
    goals: [{ type: 'timed', label: 'Timed', durationSec: 60 }],
    flavors: [
      {
        id: 'test',
        displayName: 'Test',
        themeClass: 'theme-test',
        scoreLabel: 'Score',
        resources: [{ key: 'r0', displayName: 'R0', icon: 'x' }],
        showClickStats: false,
        upgrades: [],
        generators: [],
        attacks: [],
        pacts: [],
      },
    ],
    upgrades: [],
  }
}

const flavorFor = (id: string) => ({ id, name: id, icon: 'x', description: 'd' })

// ─── Idler parity + round-trip ───────────────────────────────────────

describe('tree codec — idler parity', () => {
  it('parses the canonical idler tree into a definition matching the registered mode', () => {
    expect(parseTree(idlerTreeFileInput())).toEqual(getModeDefinition('idler'))
  })

  it('round-trips the idler tree through serialize → parse without loss', () => {
    const tree = parseTreeFile(idlerTreeFileInput())
    const json = serializeTree(tree)
    expect(parseTreeFile(JSON.parse(json) as unknown)).toEqual(tree)
  })

  it('serializes deterministically (re-serializing a parsed file is byte-identical)', () => {
    const json = serializeTree(parseTreeFile(idlerTreeFileInput()))
    expect(serializeTree(parseTreeFile(JSON.parse(json) as unknown))).toBe(json)
  })
})

// ─── Unlimited sentinel (null ↔ Infinity) ────────────────────────────

describe('tree codec — purchaseLimit sentinel', () => {
  it('maps null to Infinity when assembling the runtime definition', () => {
    const tree = minimalTree()
    tree.upgrades = [
      { id: 'a', cost: { r0: { baseCost: 5 } }, purchaseLimit: null, offset: { x: 0, y: 0 } },
    ]
    tree.flavors[0].upgrades = [flavorFor('a')]
    expect(toModeDefinition(tree).upgrades[0].purchaseLimit).toBe(Infinity)
  })

  it('preserves the null sentinel across a round-trip (Infinity is not JSON-encodable)', () => {
    const tree = minimalTree()
    tree.upgrades = [
      { id: 'a', cost: { r0: { baseCost: 5 } }, purchaseLimit: null, offset: { x: 0, y: 0 } },
    ]
    tree.flavors[0].upgrades = [flavorFor('a')]
    const back = parseTreeFile(JSON.parse(serializeTree(tree)) as unknown)
    expect(back.upgrades[0].purchaseLimit).toBeNull()
  })
})

// ─── Versioning ──────────────────────────────────────────────────────

describe('tree codec — versioning', () => {
  it('rejects a missing version', () => {
    const { version: _version, ...noVersion } = minimalTree()
    expect(() => parseTreeFile(noVersion)).toThrow(/version/iu)
  })

  it('rejects an unsupported version', () => {
    expect(() => parseTreeFile({ ...minimalTree(), version: 999 })).toThrow(/version/iu)
  })

  it('migrates v1 per-upgrade modifiers into baseModifier effects', () => {
    const v1: unknown = {
      ...minimalTree(),
      version: 1,
      upgrades: [
        {
          id: 'a',
          cost: { r0: 5 },
          purchaseLimit: null,
          modifiers: [{ stage: 'additive', field: 'r0', value: 3 }],
          effects: [{ type: 'highlightMultiplier', multiplier: 2 }],
          offset: { x: 0, y: 0 },
        },
      ],
    }
    const parsed = parseTreeFile(v1)
    expect(parsed.version).toBe(CURRENT_TREE_VERSION)
    // Existing effects are kept ahead of the migrated baseModifier.
    expect(parsed.upgrades[0].effects).toEqual([
      { type: 'highlightMultiplier', multiplier: 2 },
      { type: 'baseModifier', stage: 'additive', field: 'r0', value: 3 },
    ])
    expect('modifiers' in parsed.upgrades[0]).toBe(false)
  })

  it('migrates v2 costs into per-currency CostEntry maps', () => {
    const v2: unknown = {
      ...minimalTree(),
      version: 2,
      upgrades: [
        {
          id: 'a',
          cost: { r0: 10, r1: 5 },
          costScaling: { type: 'exponential', baseCost: 10, factor: 1.15 },
          purchaseLimit: null,
          offset: { x: 0, y: 0 },
        },
      ],
      generators: [
        {
          id: 'g0',
          baseCost: 20,
          costScaling: 1.2,
          costCurrency: 'r1',
          production: { resource: 'r0', rate: 1 },
        },
      ],
    }
    const parsed = parseTreeFile(v2)
    expect(parsed.version).toBe(CURRENT_TREE_VERSION)
    // The single old costScaling applies to every cost currency.
    expect(parsed.upgrades[0].cost).toEqual({
      r0: { baseCost: 10, scaleType: 'exponential', scaleFactor: 1.15 },
      r1: { baseCost: 5, scaleType: 'exponential', scaleFactor: 1.15 },
    })
    // Generator fields collapse into a single-currency exponential entry.
    expect(parsed.generators[0].cost).toEqual({
      r1: { baseCost: 20, scaleType: 'exponential', scaleFactor: 1.2 },
    })
    expect('baseCost' in parsed.generators[0]).toBe(false)
    expect('costScaling' in parsed.upgrades[0]).toBe(false)
  })

  it('drops inert cost scaling from a one-shot upgrade when migrating v2→v3', () => {
    const v2: unknown = {
      ...minimalTree(),
      version: 2,
      upgrades: [
        {
          id: 'a',
          cost: { r0: 10 },
          costScaling: { type: 'exponential', baseCost: 10, factor: 1.15 },
          purchaseLimit: 1,
          offset: { x: 0, y: 0 },
        },
      ],
    }
    // Without normalization the migration would emit a scaled one-shot entry,
    // which the schema's one-shot invariant rejects — so parsing must succeed
    // and yield a flat cost instead of throwing.
    const parsed = parseTreeFile(v2)
    expect(parsed.upgrades[0].cost).toEqual({ r0: { baseCost: 10 } })
  })

  it('migrates v3 nativeModifiers into startingEffects, after existing effects', () => {
    const { startingEffects: _dropped, ...base } = minimalTree()
    const v3: unknown = {
      ...base,
      version: 3,
      effects: [{ type: 'highlightMultiplier', multiplier: 2 }],
      nativeModifiers: [
        { stage: 'additive', field: 'r0', value: 1 },
        { stage: 'multiplicative', field: 'r0', value: 2 },
      ],
    }
    const parsed = parseTreeFile(v3)
    expect(parsed.version).toBe(CURRENT_TREE_VERSION)
    expect(parsed.startingEffects).toEqual([
      { type: 'highlightMultiplier', multiplier: 2 },
      { type: 'baseModifier', stage: 'additive', field: 'r0', value: 1 },
      { type: 'baseModifier', stage: 'multiplicative', field: 'r0', value: 2 },
    ])
    expect('nativeModifiers' in parsed).toBe(false)
    expect('effects' in parsed).toBe(false)
  })

  it('migrates a v3 tree with neither nativeModifiers nor effects to empty startingEffects', () => {
    const { startingEffects: _dropped, ...base } = minimalTree()
    const parsed = parseTreeFile({ ...base, version: 3 })
    expect(parsed.startingEffects).toEqual([])
  })

  it('preserves the rate a v3 nativeModifier produced after migrating it', () => {
    const { startingEffects: _dropped, ...base } = minimalTree()
    const v3: unknown = {
      ...base,
      id: 'v3-parity',
      version: 3,
      nativeModifiers: [{ stage: 'additive', field: 'r0', value: 3 }],
    }
    const def = toModeDefinition(parseTreeFile(v3))
    const state: PlayerState = {
      score: 0,
      resources: { r0: 0 },
      upgrades: {},
      generators: {},
      pendingAttacks: [],
      meta: {},
    }
    expect(computePassiveRates(collectModifiers(state, def), def.resources).r0).toBe(3)
  })
})

// ─── Structural + semantic validation failures ───────────────────────

describe('tree codec — validation failures', () => {
  it('rejects a structurally invalid file (wrong field type)', () => {
    expect(() => parseTreeFile({ ...minimalTree(), resources: 'r0' })).toThrow()
  })

  it('rejects an unknown top-level key (strict schema catches typos)', () => {
    expect(() => parseTreeFile({ ...minimalTree(), purchaseLimt: 1 })).toThrow()
  })

  it('rejects an unknown key on an upgrade node (strict schema catches typos)', () => {
    const tree = minimalTree()
    tree.upgrades = [
      { id: 'a', cost: { r0: { baseCost: 5 } }, purchaseLimit: 1, offset: { x: 0, y: 0 } },
    ]
    tree.flavors[0].upgrades = [flavorFor('a')]
    expect(() =>
      parseTreeFile({ ...tree, upgrades: [{ ...tree.upgrades[0], modifers: [] }] }),
    ).toThrow()
  })

  it('rejects a cost entry with scaleType but no scaleFactor (must co-occur)', () => {
    const tree = minimalTree()
    tree.upgrades = [
      {
        id: 'a',
        cost: { r0: { baseCost: 5, scaleType: 'exponential' } },
        purchaseLimit: null,
        offset: { x: 0, y: 0 },
      },
    ]
    tree.flavors[0].upgrades = [flavorFor('a')]
    expect(() => parseTreeFile(tree)).toThrow()
  })

  it('rejects a non-positive baseCost', () => {
    const tree = minimalTree()
    tree.upgrades = [
      {
        id: 'a',
        cost: { r0: { baseCost: 0 } },
        purchaseLimit: null,
        offset: { x: 0, y: 0 },
      },
    ]
    tree.flavors[0].upgrades = [flavorFor('a')]
    expect(() => parseTreeFile(tree)).toThrow(/baseCost/u)
  })

  it('rejects a non-positive scaleFactor', () => {
    const tree = minimalTree()
    tree.upgrades = [
      {
        id: 'a',
        cost: { r0: { baseCost: 5, scaleType: 'exponential', scaleFactor: 0 } },
        purchaseLimit: null,
        offset: { x: 0, y: 0 },
      },
    ]
    tree.flavors[0].upgrades = [flavorFor('a')]
    expect(() => parseTreeFile(tree)).toThrow(/scaleFactor/u)
  })

  // The file schema keeps effect params verbatim (see `EffectRefSchema`), so a
  // starting effect's value guard is enforced by the registry when the tree is
  // assembled — `toModeDefinition`, not `parseTreeFile`.
  it('rejects a multiplicative starting baseModifier that is a no-op or self-penalty', () => {
    for (const value of [1, 0.5]) {
      const tree = minimalTree()
      tree.startingEffects = [{ type: 'baseModifier', stage: 'multiplicative', field: 'r0', value }]
      expect(() => toModeDefinition(tree)).toThrow(/value/u)
    }
  })

  it('rejects a non-positive additive starting baseModifier but accepts a positive one', () => {
    const bad = minimalTree()
    bad.startingEffects = [{ type: 'baseModifier', stage: 'additive', field: 'r0', value: -1 }]
    expect(() => toModeDefinition(bad)).toThrow(/value/u)

    const good = minimalTree()
    good.startingEffects = [{ type: 'baseModifier', stage: 'additive', field: 'r0', value: 0.5 }]
    expect(() => toModeDefinition(good)).not.toThrow()
  })

  it('rejects a cost entry with scaleFactor but no scaleType (must co-occur)', () => {
    const tree = minimalTree()
    tree.upgrades = [
      {
        id: 'a',
        cost: { r0: { baseCost: 5, scaleFactor: 1.15 } },
        purchaseLimit: null,
        offset: { x: 0, y: 0 },
      },
    ]
    tree.flavors[0].upgrades = [flavorFor('a')]
    expect(() => parseTreeFile(tree)).toThrow()
  })

  it('rejects a one-shot upgrade (purchaseLimit 1) that scales its cost', () => {
    const tree = minimalTree()
    tree.upgrades = [
      {
        id: 'a',
        cost: { r0: { baseCost: 5, scaleType: 'exponential', scaleFactor: 1.15 } },
        purchaseLimit: 1,
        offset: { x: 0, y: 0 },
      },
    ]
    tree.flavors[0].upgrades = [flavorFor('a')]
    expect(() => parseTreeFile(tree)).toThrow(/one-shot/iu)
  })

  it('rejects a duplicate upgrade id (via the flattener)', () => {
    const tree = minimalTree()
    tree.upgrades = [
      {
        id: 'a',
        cost: { r0: { baseCost: 5 } },
        purchaseLimit: 1,
        offset: { x: 0, y: 0 },
        children: [
          { id: 'a', cost: { r0: { baseCost: 5 } }, purchaseLimit: 1, offset: { x: 0, y: 150 } },
        ],
      },
    ]
    tree.flavors[0].upgrades = [flavorFor('a')]
    expect(() => toModeDefinition(tree)).toThrow(/duplicate/iu)
  })

  it('rejects an unknown effect type', () => {
    const tree = minimalTree()
    tree.upgrades = [
      {
        id: 'a',
        cost: { r0: { baseCost: 5 } },
        purchaseLimit: 1,
        offset: { x: 0, y: 0 },
        effects: [{ type: 'doesNotExist' }],
      },
    ]
    tree.flavors[0].upgrades = [flavorFor('a')]
    expect(() => toModeDefinition(tree)).toThrow(/unknown effect type/iu)
  })

  it('rejects malformed effect params (unknown highlight key)', () => {
    const tree = minimalTree()
    tree.upgrades = [
      {
        id: 'a',
        cost: { r0: { baseCost: 5 } },
        purchaseLimit: 1,
        offset: { x: 0, y: 0 },
        effects: [{ type: 'highlightMultiplier', multiplier: 2, boostUpgradeId: 'b' }],
      },
    ]
    tree.flavors[0].upgrades = [flavorFor('a')]
    expect(() => toModeDefinition(tree)).toThrow()
  })
})

// ─── stealResource: share vs flat quantity ───────────────────────────

/** A tree whose lone active attack carries a `stealResource` with `params`. */
function treeWithSteal(params: Record<string, unknown>): TreeFile {
  const tree = minimalTree()
  tree.attacks = [
    {
      id: 'a0',
      kind: 'active',
      prepareCost: { r0: { baseCost: 10 } },
      prepareTimeSec: 1,
      effects: [{ type: 'stealResource', resource: 'r0', ...params }],
    },
  ]
  tree.flavors[0].attacks = [{ id: 'a0', name: 'Steal', icon: 'x', description: '' }]
  return tree
}

describe('tree codec — stealResource take', () => {
  it('accepts a share of the victim stockpile', () => {
    expect(() => toModeDefinition(treeWithSteal({ fraction: 0.1 }))).not.toThrow()
  })

  it('accepts a flat quantity', () => {
    const def = toModeDefinition(treeWithSteal({ amount: 500 }))
    expect(def.attacks[0].effects?.[0]).toMatchObject({ amount: 500 })
  })

  // Both keys parse as neither shape (each is strict), so the union reports only
  // "Invalid input" — the validator names the mistake first.
  it('rejects authoring both a fraction and an amount', () => {
    expect(() => toModeDefinition(treeWithSteal({ fraction: 0.1, amount: 500 }))).toThrow(
      /sets both 'fraction' and 'amount'/u,
    )
  })

  it('rejects authoring neither', () => {
    expect(() => toModeDefinition(treeWithSteal({}))).toThrow(
      /sets neither 'fraction' nor 'amount'/u,
    )
  })

  it('rejects a share outside (0, 1]', () => {
    expect(() => toModeDefinition(treeWithSteal({ fraction: 1.5 }))).toThrow()
    expect(() => toModeDefinition(treeWithSteal({ fraction: 0 }))).toThrow()
  })

  it('rejects a non-positive flat quantity', () => {
    expect(() => toModeDefinition(treeWithSteal({ amount: 0 }))).toThrow()
    expect(() => toModeDefinition(treeWithSteal({ amount: -5 }))).toThrow()
  })
})

// ─── stealGenerator: share vs flat copy count ────────────────────────

/** A tree with one generator whose lone active attack steals it with `params`. */
function treeWithGenSteal(params: Record<string, unknown>, generator = 'g0'): TreeFile {
  const tree = minimalTree()
  tree.generators = [
    { id: 'g0', cost: { r0: { baseCost: 10 } }, production: { resource: 'r0', rate: 1 } },
  ]
  tree.flavors[0].generators = [{ id: 'g0', name: 'Gen', icon: 'x' }]
  tree.attacks = [
    {
      id: 'a0',
      kind: 'active',
      prepareCost: { r0: { baseCost: 10 } },
      prepareTimeSec: 1,
      effects: [{ type: 'stealGenerator', generator, ...params }],
    },
  ]
  tree.flavors[0].attacks = [{ id: 'a0', name: 'Raid', icon: 'x', description: '' }]
  return tree
}

describe('tree codec — stealGenerator take', () => {
  it('accepts a share of the victim copies', () => {
    expect(() => toModeDefinition(treeWithGenSteal({ fraction: 0.5 }))).not.toThrow()
  })

  it('accepts a flat copy count', () => {
    const def = toModeDefinition(treeWithGenSteal({ count: 2 }))
    expect(def.attacks[0].effects?.[0]).toMatchObject({ count: 2 })
  })

  it('rejects authoring both a fraction and a count', () => {
    expect(() => toModeDefinition(treeWithGenSteal({ fraction: 0.5, count: 2 }))).toThrow(
      /sets both 'fraction' and 'count'/u,
    )
  })

  it('rejects authoring neither', () => {
    expect(() => toModeDefinition(treeWithGenSteal({}))).toThrow(
      /sets neither 'fraction' nor 'count'/u,
    )
  })

  it('rejects an unknown generator id', () => {
    expect(() => toModeDefinition(treeWithGenSteal({ count: 1 }, 'nope'))).toThrow(
      /references unknown generator 'nope'/u,
    )
  })

  it('rejects a share outside (0, 1]', () => {
    expect(() => toModeDefinition(treeWithGenSteal({ fraction: 1.5 }))).toThrow()
    expect(() => toModeDefinition(treeWithGenSteal({ fraction: 0 }))).toThrow()
  })

  // Copies are whole things — a fractional or non-positive count is a mistake.
  it('rejects a fractional or non-positive copy count', () => {
    expect(() => toModeDefinition(treeWithGenSteal({ count: 1.5 }))).toThrow()
    expect(() => toModeDefinition(treeWithGenSteal({ count: 0 }))).toThrow()
    expect(() => toModeDefinition(treeWithGenSteal({ count: -2 }))).toThrow()
  })
})

// ─── Envelopes moved to the balance sidecar ──────────────────────────

describe('tree codec — envelopes are no longer tree data', () => {
  it('rejects a tree file carrying an envelopes key', () => {
    const withEnvelopes = {
      ...minimalTree(),
      envelopes: [
        {
          goalType: 'timed',
          checkpoints: [{ timeSec: 5, minScore: 8, maxScore: 150, phase: 'A' }],
          minViableStrategies: 1,
          maxStrategySpread: 10,
        },
      ],
    }
    expect(() => parseTreeFile(withEnvelopes)).toThrow()
  })

  it('parses the canonical idler tree (which carries no envelopes)', () => {
    const def = toModeDefinition(parseTreeFile(idlerTreeFileInput()))
    expect(def).toEqual(getModeDefinition('idler'))
  })
})
