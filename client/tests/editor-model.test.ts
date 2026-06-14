import { describe, expect, it } from 'vitest'
import { parseTreeFile, type TreeFile, type TreeUpgradeNode } from '@game/shared'
import idlerTreeFile from '@game/shared/trees/idler.json'
import {
  cloneTree,
  walkPositioned,
  findNode,
  collectIds,
  prerequisiteRefs,
  createNode,
  uniqueId,
  addNode,
  removeNode,
  nodePosition,
  setNodePosition,
  parentOf,
  subtreeIdsOf,
  reparentNode,
} from '../src/dev/editor/model.js'
import { renderCanvas, NODE_SIZE } from '../src/dev/editor/canvas.js'

// ─── Fixtures ────────────────────────────────────────────────────────

function node(
  id: string,
  offset: { x: number; y: number },
  extra?: Partial<TreeUpgradeNode>,
): TreeUpgradeNode {
  return { id, cost: {}, purchaseLimit: 1, modifiers: [], offset, ...extra }
}

/** A tree with known offsets: A→B→C plus a sibling D, all under the idler shell. */
function makeTree(): TreeFile {
  const tree = cloneTree(parseTreeFile(idlerTreeFile))
  tree.upgrades = [
    node(
      'a',
      { x: 0, y: 0 },
      {
        children: [node('b', { x: 100, y: 50 }, { children: [node('c', { x: 10, y: 10 })] })],
      },
    ),
    node('d', { x: -40, y: 20 }, { prerequisites: { type: 'upgrade', id: 'a' } }),
  ]
  return tree
}

// ─── walkPositioned ──────────────────────────────────────────────────

describe('walkPositioned', () => {
  it('accumulates offsets into absolute positions', () => {
    const positioned = walkPositioned(makeTree())
    const byId = new Map(positioned.map((p) => [p.node.id, p]))
    expect(byId.get('a')).toMatchObject({ x: 0, y: 0 })
    expect(byId.get('b')).toMatchObject({ x: 100, y: 50 })
    expect(byId.get('c')).toMatchObject({ x: 110, y: 60 })
    expect(byId.get('d')).toMatchObject({ x: -40, y: 20 })
  })

  it('records the layout parent of each node', () => {
    const byId = new Map(walkPositioned(makeTree()).map((p) => [p.node.id, p]))
    expect(byId.get('a')!.parent).toBeNull()
    expect(byId.get('c')!.parent?.id).toBe('b')
  })
})

// ─── findNode / collectIds ───────────────────────────────────────────

describe('findNode', () => {
  it('finds a deeply nested node', () => {
    expect(findNode(makeTree(), 'c')?.id).toBe('c')
  })

  it('returns null for an unknown id', () => {
    expect(findNode(makeTree(), 'nope')).toBeNull()
  })
})

describe('collectIds', () => {
  it('lists every node id', () => {
    expect(collectIds(makeTree()).sort()).toEqual(['a', 'b', 'c', 'd'])
  })
})

// ─── uniqueId ────────────────────────────────────────────────────────

describe('uniqueId', () => {
  it('returns the base when it is unused', () => {
    expect(uniqueId(makeTree(), 'fresh')).toBe('fresh')
  })

  it('suffixes a counter when the base collides', () => {
    const tree = makeTree()
    tree.upgrades.push(node('node', { x: 0, y: 0 }))
    expect(uniqueId(tree, 'node')).toBe('node-2')
  })
})

// ─── addNode ─────────────────────────────────────────────────────────

describe('addNode', () => {
  it('appends a new root when parentId is null', () => {
    const tree = makeTree()
    addNode(tree, null, createNode('root2', { x: 0, y: 0 }))
    expect(tree.upgrades.map((n) => n.id)).toContain('root2')
  })

  it('appends a child to the named parent', () => {
    const tree = makeTree()
    addNode(tree, 'b', createNode('b-child', { x: 0, y: 50 }))
    const parent = walkPositioned(tree).find((p) => p.node.id === 'b-child')?.parent
    expect(parent?.id).toBe('b')
  })

  it('falls back to a root when the parent is missing', () => {
    const tree = makeTree()
    addNode(tree, 'ghost', createNode('orphan', { x: 0, y: 0 }))
    expect(tree.upgrades.map((n) => n.id)).toContain('orphan')
  })
})

// ─── removeNode ──────────────────────────────────────────────────────

describe('removeNode', () => {
  it('removes a leaf and returns its id', () => {
    const tree = makeTree()
    expect(removeNode(tree, 'd')).toEqual(['d'])
    expect(collectIds(tree)).not.toContain('d')
  })

  it('removes a whole subtree and returns every removed id', () => {
    const tree = makeTree()
    expect(removeNode(tree, 'b').sort()).toEqual(['b', 'c'])
    // 'd' is a sibling root, so it survives removing the b→c branch.
    expect(collectIds(tree).sort()).toEqual(['a', 'd'])
  })

  it('prunes prerequisite references to removed nodes', () => {
    const tree = makeTree()
    // 'd' requires 'a'; removing 'a' should drop that dangling prerequisite.
    removeNode(tree, 'a')
    expect(findNode(tree, 'd')?.prerequisites).toBeUndefined()
  })

  it('keeps surviving references when pruning an all/any group', () => {
    const tree = makeTree()
    findNode(tree, 'd')!.prerequisites = {
      type: 'all',
      items: [
        { type: 'upgrade', id: 'c' },
        { type: 'upgrade', id: 'a' },
      ],
    }
    // Removing the leaf 'c' leaves the reference to 'a' (a sibling root) intact.
    removeNode(tree, 'c')
    expect(findNode(tree, 'd')?.prerequisites).toEqual({
      type: 'all',
      items: [{ type: 'upgrade', id: 'a' }],
    })
  })

  it('returns [] when the id is not found', () => {
    const tree = makeTree()
    expect(removeNode(tree, 'nope')).toEqual([])
    expect(collectIds(tree).sort()).toEqual(['a', 'b', 'c', 'd'])
  })
})

// ─── nodePosition / setNodePosition ──────────────────────────────────

describe('nodePosition', () => {
  it('returns the absolute position of a nested node', () => {
    expect(nodePosition(makeTree(), 'c')).toEqual({ x: 110, y: 60 })
  })

  it('returns null for an unknown id', () => {
    expect(nodePosition(makeTree(), 'nope')).toBeNull()
  })
})

describe('setNodePosition', () => {
  it('adjusts a root offset to the target absolute position', () => {
    const tree = makeTree()
    setNodePosition(tree, 'a', 48, 24)
    expect(nodePosition(tree, 'a')).toEqual({ x: 48, y: 24 })
    expect(findNode(tree, 'a')!.offset).toEqual({ x: 48, y: 24 })
  })

  it('keeps children in place by only changing the moved node offset', () => {
    const tree = makeTree()
    // 'b' is at (100,50); move it to (200,100). 'c' (offset 10,10) follows.
    setNodePosition(tree, 'b', 200, 100)
    expect(nodePosition(tree, 'b')).toEqual({ x: 200, y: 100 })
    expect(nodePosition(tree, 'c')).toEqual({ x: 210, y: 110 })
    expect(findNode(tree, 'c')!.offset).toEqual({ x: 10, y: 10 })
  })

  it('positions a child relative to its parent', () => {
    const tree = makeTree()
    // 'c's parent 'b' sits at (100,50); placing 'c' at (130,80) means offset (30,30).
    setNodePosition(tree, 'c', 130, 80)
    expect(findNode(tree, 'c')!.offset).toEqual({ x: 30, y: 30 })
  })

  it('is a no-op for an unknown id', () => {
    const tree = makeTree()
    setNodePosition(tree, 'nope', 0, 0)
    expect(nodePosition(tree, 'a')).toEqual({ x: 0, y: 0 })
  })
})

// ─── parentOf / subtreeIdsOf ─────────────────────────────────────────

describe('parentOf', () => {
  it('returns the layout parent id', () => {
    expect(parentOf(makeTree(), 'c')).toBe('b')
  })

  it('returns null for a root', () => {
    expect(parentOf(makeTree(), 'a')).toBeNull()
  })

  it('returns null for an unknown id', () => {
    expect(parentOf(makeTree(), 'nope')).toBeNull()
  })
})

describe('subtreeIdsOf', () => {
  it('lists the node and all its descendants', () => {
    expect(subtreeIdsOf(makeTree(), 'a').sort()).toEqual(['a', 'b', 'c'])
  })

  it('lists just the node for a leaf', () => {
    expect(subtreeIdsOf(makeTree(), 'c')).toEqual(['c'])
  })

  it('returns [] for an unknown id', () => {
    expect(subtreeIdsOf(makeTree(), 'nope')).toEqual([])
  })
})

// ─── reparentNode ────────────────────────────────────────────────────

describe('reparentNode', () => {
  it('moves a root under a parent, preserving its absolute position', () => {
    const tree = makeTree()
    // 'd' is a root at (-40,20); parent it under 'b' (at (100,50)).
    expect(reparentNode(tree, 'd', 'b')).toBe(true)
    expect(parentOf(tree, 'd')).toBe('b')
    expect(nodePosition(tree, 'd')).toEqual({ x: -40, y: 20 })
    // Offset is now relative to 'b': (-40-100, 20-50) = (-140, -30).
    expect(findNode(tree, 'd')!.offset).toEqual({ x: -140, y: -30 })
  })

  it('drags descendants along after reparenting (they keep their offsets)', () => {
    const tree = makeTree()
    reparentNode(tree, 'b', 'd') // 'b' (with child 'c') moves under 'd'
    expect(nodePosition(tree, 'b')).toEqual({ x: 100, y: 50 })
    expect(nodePosition(tree, 'c')).toEqual({ x: 110, y: 60 })
    // Now moving 'd' shifts 'b' and 'c' with it.
    setNodePosition(tree, 'd', 0, 0)
    expect(nodePosition(tree, 'b')).toEqual({ x: 140, y: 30 })
    expect(nodePosition(tree, 'c')).toEqual({ x: 150, y: 40 })
  })

  it('makes a node a root when the new parent is null', () => {
    const tree = makeTree()
    expect(reparentNode(tree, 'c', null)).toBe(true)
    expect(parentOf(tree, 'c')).toBeNull()
    // 'c' was at (110,60); as a root its offset equals its absolute position.
    expect(nodePosition(tree, 'c')).toEqual({ x: 110, y: 60 })
    expect(findNode(tree, 'c')!.offset).toEqual({ x: 110, y: 60 })
  })

  it('refuses to create a cycle (parenting a node under its own descendant)', () => {
    const tree = makeTree()
    expect(reparentNode(tree, 'a', 'c')).toBe(false)
    expect(parentOf(tree, 'a')).toBeNull()
    expect(parentOf(tree, 'c')).toBe('b')
  })

  it('refuses to parent a node under itself', () => {
    const tree = makeTree()
    expect(reparentNode(tree, 'b', 'b')).toBe(false)
    expect(parentOf(tree, 'b')).toBe('a')
  })

  it('is a no-op when the parent is unchanged', () => {
    const tree = makeTree()
    expect(reparentNode(tree, 'c', 'b')).toBe(false)
  })

  it('returns false for an unknown id', () => {
    const tree = makeTree()
    expect(reparentNode(tree, 'nope', 'a')).toBe(false)
  })
})

// ─── prerequisiteRefs ────────────────────────────────────────────────

describe('prerequisiteRefs', () => {
  it('returns [] when there are no prerequisites', () => {
    expect(prerequisiteRefs(node('x', { x: 0, y: 0 }))).toEqual([])
  })

  it('extracts a single upgrade reference', () => {
    const n = node('x', { x: 0, y: 0 }, { prerequisites: { type: 'upgrade', id: 'a' } })
    expect(prerequisiteRefs(n)).toEqual(['a'])
  })

  it('extracts refs from nested all/any groups', () => {
    const n = node(
      'x',
      { x: 0, y: 0 },
      {
        prerequisites: {
          type: 'all',
          items: [
            { type: 'upgrade', id: 'a' },
            {
              type: 'any',
              items: [
                { type: 'upgrade', id: 'b' },
                { type: 'upgrade', id: 'c' },
              ],
            },
          ],
        },
      },
    )
    expect(prerequisiteRefs(n).sort()).toEqual(['a', 'b', 'c'])
  })
})

// ─── renderCanvas ────────────────────────────────────────────────────

describe('renderCanvas', () => {
  it('renders a card per node and marks the selected one', () => {
    const { nodes } = renderCanvas(makeTree(), 'b')
    // `[ "]` excludes the inner `ed-node-icon` span (followed by `-`).
    expect((nodes.match(/class="ed-node[ "]/g) ?? []).length).toBe(4)
    expect(nodes).toContain('ed-node selected')
    expect(nodes).toContain('data-node-id="b"')
  })

  it('draws an edge for each prerequisite reference', () => {
    const { edgesSvg } = renderCanvas(makeTree(), null)
    // Only 'd' has a prerequisite (→ a), so exactly one edge.
    expect((edgesSvg.match(/class="ed-edge"/g) ?? []).length).toBe(1)
  })

  it('computes bounds covering all node footprints', () => {
    const { bounds } = renderCanvas(makeTree(), null)
    // Positions are node centers, so footprints extend ±NODE_SIZE/2.
    const half = NODE_SIZE / 2
    expect(bounds.minX).toBe(-40 - half)
    expect(bounds.minY).toBe(0 - half)
    expect(bounds.maxX).toBe(110 + half)
    expect(bounds.maxY).toBe(60 + half)
  })

  it('escapes html in node ids', () => {
    const tree = cloneTree(parseTreeFile(idlerTreeFile))
    tree.upgrades = [node('<script>', { x: 0, y: 0 })]
    expect(renderCanvas(tree, null).nodes).not.toContain('<script>')
  })
})
