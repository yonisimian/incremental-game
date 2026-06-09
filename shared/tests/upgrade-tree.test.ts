import { describe, expect, it } from 'vitest'
import { flattenUpgradeTree, getModeDefinition } from '../src/index.js'
import type { UpgradeTreeNode } from '../src/index.js'

function node(
  id: string,
  offset: { x: number; y: number },
  extra: Partial<UpgradeTreeNode> = {},
): UpgradeTreeNode {
  return { id, cost: { r0: 1 }, purchaseLimit: 1, modifiers: [], offset, ...extra }
}

describe('flattenUpgradeTree', () => {
  it('resolves a root offset to an absolute position from the origin', () => {
    const flat = flattenUpgradeTree([node('a', { x: 200, y: -50 })])
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
    const byId = new Map(flattenUpgradeTree(tree).map((u) => [u.id, u]))
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
      flattenUpgradeTree(tree)
        .map((u) => u.id)
        .sort(),
    ).toEqual(['a', 'b', 'c'])
  })

  it('throws on a duplicate id', () => {
    const tree: UpgradeTreeNode[] = [
      node('dup', { x: 0, y: 0 }, { children: [node('dup', { x: 1, y: 0 })] }),
    ]
    expect(() => flattenUpgradeTree(tree)).toThrow(/duplicate upgrade id/iu)
  })

  it('passes gameplay fields through verbatim and drops offset/children', () => {
    const tree: UpgradeTreeNode[] = [
      node(
        'a',
        { x: 5, y: 5 },
        {
          cost: { r0: 25, r1: 5 },
          purchaseLimit: Infinity,
          goalType: 'buy-upgrade',
          prerequisites: { type: 'upgrade', id: 'x' },
          modifiers: [{ stage: 'additive', field: 'r0', value: 5 }],
          effects: [{ type: 'highlightMultiplier', unlockUpgradeId: 'x', multiplier: 2 }],
          children: [node('b', { x: 1, y: 1 })],
        },
      ),
    ]
    const a = flattenUpgradeTree(tree).find((u) => u.id === 'a')!
    expect(a).toEqual({
      id: 'a',
      cost: { r0: 25, r1: 5 },
      purchaseLimit: Infinity,
      goalType: 'buy-upgrade',
      prerequisites: { type: 'upgrade', id: 'x' },
      modifiers: [{ stage: 'additive', field: 'r0', value: 5 }],
      effects: [{ type: 'highlightMultiplier', unlockUpgradeId: 'x', multiplier: 2 }],
      position: { x: 5, y: 5 },
    })
    expect('offset' in a).toBe(false)
    expect('children' in a).toBe(false)
  })

  it('returns an empty array for no roots', () => {
    expect(flattenUpgradeTree([])).toEqual([])
  })
})

describe('idler tree conversion (golden)', () => {
  it('flattens to the prior absolute positions (no behavior change)', () => {
    const positionById = new Map(getModeDefinition('idler').upgrades.map((u) => [u.id, u.position]))
    expect(positionById.get('uh')).toEqual({ x: 0, y: 0 })
    expect(positionById.get('u1')).toEqual({ x: 200, y: 0 })
    expect(positionById.get('u5')).toEqual({ x: 600, y: 0 })
  })
})
