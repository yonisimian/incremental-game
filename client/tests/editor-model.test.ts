import { describe, expect, it } from 'vitest'
import { buildIdlerTreeFile, type TreeFile, type TreeUpgradeNode } from '@game/shared'
import {
  cloneTree,
  walkPositioned,
  findNode,
  collectIds,
  prerequisiteRefs,
} from '../src/dev/editor/model.js'
import { renderCanvas, NODE_W, NODE_H } from '../src/dev/editor/canvas.js'

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
  const tree = cloneTree(buildIdlerTreeFile())
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
    // `[ "]` excludes the inner spans (ed-node-id / -cost / -limit).
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
    expect(bounds.minX).toBe(-40)
    expect(bounds.minY).toBe(0)
    expect(bounds.maxX).toBe(110 + NODE_W)
    expect(bounds.maxY).toBe(60 + NODE_H)
  })

  it('escapes html in node ids', () => {
    const tree = cloneTree(buildIdlerTreeFile())
    tree.upgrades = [node('<script>', { x: 0, y: 0 })]
    expect(renderCanvas(tree, null).nodes).not.toContain('<script>')
  })
})
