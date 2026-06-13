import { describe, expect, it } from 'vitest'

import {
  CURRENT_TREE_VERSION,
  getModeDefinition,
  parseTree,
  parseTreeFile,
  serializeTree,
  toModeDefinition,
} from '../src/index.js'
import type { TreeFile } from '../src/index.js'
import { idlerTree } from '../src/modes/idler.js'
import type { UpgradeTreeNode } from '../src/modes/upgrade-tree.js'

// ─── Fixtures ────────────────────────────────────────────────────────

/**
 * Convert a runtime authoring node to its serializable file form: map the
 * `Infinity` unlimited sentinel back to `null` (JSON cannot encode `Infinity`,
 * and the schema rejects it), recursing into layout children.
 */
function toFileNode(node: UpgradeTreeNode): unknown {
  const { purchaseLimit, children, ...rest } = node
  const fileNode: Record<string, unknown> = {
    ...rest,
    purchaseLimit: Number.isFinite(purchaseLimit) ? purchaseLimit : null,
  }
  if (children) fileNode.children = children.map(toFileNode)
  return fileNode
}

/** Build a tree file from the real, hand-authored idler mode + its nested tree. */
function idlerTreeFileInput(): unknown {
  const m = getModeDefinition('idler')
  return {
    version: CURRENT_TREE_VERSION,
    id: 'idler',
    resources: m.resources,
    scoreResource: m.scoreResource,
    clicksEnabled: m.clicksEnabled,
    highlightEnabled: m.highlightEnabled,
    highlightUnlockUpgrade: m.highlightUnlockUpgrade,
    initialResources: m.initialResources,
    initialMeta: m.initialMeta,
    nativeModifiers: m.nativeModifiers,
    effects: m.effects,
    generators: m.generators,
    goals: m.goals,
    flavors: m.flavors,
    upgrades: idlerTree.map(toFileNode),
  }
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
    nativeModifiers: [],
    effects: [],
    generators: [],
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
      },
    ],
    upgrades: [],
  }
}

const flavorFor = (id: string) => ({ id, name: id, icon: 'x', description: 'd' })

// ─── Idler parity + round-trip ───────────────────────────────────────

describe('tree codec — idler parity', () => {
  it('parses the idler tree into a definition identical to the hand-authored mode', () => {
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
      { id: 'a', cost: { r0: 5 }, purchaseLimit: null, modifiers: [], offset: { x: 0, y: 0 } },
    ]
    tree.flavors[0].upgrades = [flavorFor('a')]
    expect(toModeDefinition(tree).upgrades[0].purchaseLimit).toBe(Infinity)
  })

  it('preserves the null sentinel across a round-trip (Infinity is not JSON-encodable)', () => {
    const tree = minimalTree()
    tree.upgrades = [
      { id: 'a', cost: { r0: 5 }, purchaseLimit: null, modifiers: [], offset: { x: 0, y: 0 } },
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
      { id: 'a', cost: { r0: 5 }, purchaseLimit: 1, modifiers: [], offset: { x: 0, y: 0 } },
    ]
    tree.flavors[0].upgrades = [flavorFor('a')]
    expect(() =>
      parseTreeFile({ ...tree, upgrades: [{ ...tree.upgrades[0], modifers: [] }] }),
    ).toThrow()
  })

  it('rejects a duplicate upgrade id (via the flattener)', () => {
    const tree = minimalTree()
    tree.upgrades = [
      {
        id: 'a',
        cost: { r0: 5 },
        purchaseLimit: 1,
        modifiers: [],
        offset: { x: 0, y: 0 },
        children: [
          { id: 'a', cost: { r0: 5 }, purchaseLimit: 1, modifiers: [], offset: { x: 0, y: 150 } },
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
        cost: { r0: 5 },
        purchaseLimit: 1,
        modifiers: [],
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
        cost: { r0: 5 },
        purchaseLimit: 1,
        modifiers: [],
        offset: { x: 0, y: 0 },
        effects: [{ type: 'highlightMultiplier', multiplier: 2, boostUpgradeId: 'b' }],
      },
    ]
    tree.flavors[0].upgrades = [flavorFor('a')]
    expect(() => toModeDefinition(tree)).toThrow()
  })
})
