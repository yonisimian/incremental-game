import { describe, expect, it } from 'vitest'
import { flattenUpgradeTree, getModeDefinition } from '../src/index.js'
import type { UpgradeTreeNode } from '../src/index.js'

function node(
  id: string,
  offset: { x: number; y: number },
  extra: Partial<UpgradeTreeNode> = {},
): UpgradeTreeNode {
  return { id, cost: { r0: { baseCost: 1 } }, purchaseLimit: 1, offset, ...extra }
}

/** One category holding `roots` — most cases only care about a single group. */
const inOne = (roots: UpgradeTreeNode[]) => [{ id: 'c0', upgrades: roots }]

describe('flattenUpgradeTree', () => {
  it('resolves a root offset to an absolute position from the origin', () => {
    const flat = flattenUpgradeTree(inOne([node('a', { x: 200, y: -50 })]))
    expect(flat).toHaveLength(1)
    expect(flat[0].position).toEqual({ x: 200, y: -50 })
  })

  it('accumulates offsets through nested depth', () => {
    const tree: UpgradeTreeNode[] = [
      node(
        'root',
        { x: 100, y: 100 },
        {
          children: [
            node(
              'child',
              { x: 50, y: -20 },
              {
                children: [node('grandchild', { x: 10, y: 10 })],
              },
            ),
          ],
        },
      ),
    ]
    const byId = new Map(flattenUpgradeTree(inOne(tree)).map((u) => [u.id, u]))
    expect(byId.get('root')!.position).toEqual({ x: 100, y: 100 })
    expect(byId.get('child')!.position).toEqual({ x: 150, y: 80 })
    expect(byId.get('grandchild')!.position).toEqual({ x: 160, y: 90 })
  })

  it('flattens every node in the tree', () => {
    const tree: UpgradeTreeNode[] = [
      node('a', { x: 0, y: 0 }, { children: [node('b', { x: 1, y: 0 })] }),
      node('c', { x: 0, y: 1 }),
    ]
    expect(
      flattenUpgradeTree(inOne(tree))
        .map((u) => u.id)
        .sort(),
    ).toEqual(['a', 'b', 'c'])
  })

  it('throws on a duplicate id', () => {
    const tree: UpgradeTreeNode[] = [
      node('dup', { x: 0, y: 0 }, { children: [node('dup', { x: 1, y: 0 })] }),
    ]
    expect(() => flattenUpgradeTree(inOne(tree))).toThrow(/duplicate upgrade id/iu)
  })

  it('passes gameplay fields through verbatim and drops offset/children', () => {
    const tree: UpgradeTreeNode[] = [
      node(
        'a',
        { x: 5, y: 5 },
        {
          cost: { r0: { baseCost: 25 }, r1: { baseCost: 5 } },
          purchaseLimit: Infinity,
          goalType: 'buy-upgrade',
          prerequisites: { type: 'upgrade', id: 'x' },
          effects: [
            { type: 'baseModifier', stage: 'additive', field: 'r0', value: 5 },
            { type: 'highlightMultiplier', multiplier: 2 },
          ],
          children: [node('b', { x: 1, y: 1 })],
        },
      ),
    ]
    const a = flattenUpgradeTree(inOne(tree)).find((u) => u.id === 'a')!
    expect(a).toEqual({
      id: 'a',
      cost: { r0: { baseCost: 25 }, r1: { baseCost: 5 } },
      purchaseLimit: Infinity,
      goalType: 'buy-upgrade',
      prerequisites: { type: 'upgrade', id: 'x' },
      effects: [
        { type: 'baseModifier', stage: 'additive', field: 'r0', value: 5 },
        { type: 'highlightMultiplier', multiplier: 2 },
      ],
      position: { x: 5, y: 5 },
      category: 'c0',
    })
    expect('offset' in a).toBe(false)
    expect('children' in a).toBe(false)
  })

  it('returns an empty array for no roots', () => {
    expect(flattenUpgradeTree([])).toEqual([])
    expect(flattenUpgradeTree(inOne([]))).toEqual([])
  })

  it('stamps each upgrade with its category, children included', () => {
    const flat = flattenUpgradeTree([
      {
        id: 'c0',
        upgrades: [node('a', { x: 0, y: 0 }, { children: [node('b', { x: 1, y: 0 })] })],
      },
      { id: 'c1', upgrades: [node('c', { x: 300, y: 0 })] },
    ])
    expect(flat.map((u) => [u.id, u.category])).toEqual([
      ['a', 'c0'],
      ['b', 'c0'],
      ['c', 'c1'],
    ])
    // Every category's roots share one origin, so positions stay global.
    expect(flat.find((u) => u.id === 'c')!.position).toEqual({ x: 300, y: 0 })
  })

  it('throws on an id duplicated across categories', () => {
    expect(() =>
      flattenUpgradeTree([
        { id: 'c0', upgrades: [node('dup', { x: 0, y: 0 })] },
        { id: 'c1', upgrades: [node('dup', { x: 1, y: 0 })] },
      ]),
    ).toThrow(/duplicate upgrade id/iu)
  })
})

describe('idler tree conversion (golden)', () => {
  it('flattens to the expected absolute positions', () => {
    const positionById = new Map(getModeDefinition('idler').upgrades.map((u) => [u.id, u.position]))
    expect(positionById.get('goal')).toEqual({ x: 48, y: 48 })
    expect(positionById.get('sc-unlock')).toEqual({ x: 792, y: 144 })
    // sc-af-cp is a layout child of sc-unlock (offset 0,96) → absolute (792, 240).
    expect(positionById.get('sc-af-cp')).toEqual({ x: 792, y: 240 })
    expect(positionById.get('sh-unlock')).toEqual({ x: 888, y: 432 })
  })

  it('groups the tree into its categories, with Highlight apart from Click', () => {
    const def = getModeDefinition('idler')
    const categoryById = new Map(def.upgrades.map((u) => [u.id, u.category]))
    expect(def.categories?.map((c) => c.id)).toEqual([
      'c0',
      'c1',
      'c2',
      'c3',
      'c4',
      'c5',
      'c6',
      'c7',
      'c8',
    ])
    expect(categoryById.get('goal')).toBe('c0')
    expect(categoryById.get('sc-unlock')).toBe('c4')
    expect(categoryById.get('sc-af-cp')).toBe('c4')
    expect(categoryById.get('sb-unlock')).toBe('c4')
    expect(categoryById.get('sh-unlock')).toBe('c5')
    expect(categoryById.get('shb-hcp')).toBe('c5')
    expect(categoryById.get('a-unlock')).toBe('c6')
    expect(categoryById.get('e-se-mr')).toBe('c8')
  })
})
