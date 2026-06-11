/**
 * Editor data model — a mutable working copy of a `TreeFile` plus pure helpers
 * for walking the nested authoring tree, resolving absolute node positions from
 * relative offsets, and looking nodes up by id.
 *
 * The editor mutates this working copy in place (zod-inferred arrays are
 * mutable); `io.ts` is the only boundary that validates it against the schema.
 */

import type { TreeFile, TreeUpgradeNode } from '@game/shared'

/** A node paired with its resolved absolute canvas position. */
export interface PositionedNode {
  readonly node: TreeUpgradeNode
  readonly x: number
  readonly y: number
  /** Absolute position of the layout parent (the origin for roots). */
  readonly parent: TreeUpgradeNode | null
}

/** Deep-clone a tree file so the editor can mutate without touching the source. */
export function cloneTree(tree: TreeFile): TreeFile {
  return structuredClone(tree)
}

/**
 * Typed accessor for a node's children. zod's recursive getter infers `children`
 * loosely (`Record<string, unknown>[]`), but parsed trees are validated, so the
 * narrowing to `TreeUpgradeNode[]` is sound.
 */
function childrenOf(node: TreeUpgradeNode): readonly TreeUpgradeNode[] {
  return (node.children ?? []) as unknown as readonly TreeUpgradeNode[]
}

/**
 * Walk every node depth-first, resolving each node's absolute position by
 * accumulating offsets (`abs = parentAbs + offset`; roots offset from origin).
 */
export function walkPositioned(tree: TreeFile): PositionedNode[] {
  const out: PositionedNode[] = []
  const visit = (
    nodes: readonly TreeUpgradeNode[],
    baseX: number,
    baseY: number,
    parent: TreeUpgradeNode | null,
  ): void => {
    for (const node of nodes) {
      const x = baseX + node.offset.x
      const y = baseY + node.offset.y
      out.push({ node, x, y, parent })
      const children = childrenOf(node)
      if (children.length > 0) visit(children, x, y, node)
    }
  }
  visit(tree.upgrades, 0, 0, null)
  return out
}

/** Find a node by id anywhere in the nested tree, or `null`. */
export function findNode(tree: TreeFile, id: string): TreeUpgradeNode | null {
  const stack = [...tree.upgrades]
  while (stack.length > 0) {
    const node = stack.pop()!
    if (node.id === id) return node
    stack.push(...childrenOf(node))
  }
  return null
}

/** Every node id in the tree (document order). */
export function collectIds(tree: TreeFile): string[] {
  return walkPositioned(tree).map((p) => p.node.id)
}

/**
 * The set of upgrade ids referenced by a prerequisite expression. Used to draw
 * prerequisite edges on the canvas.
 */
export function prerequisiteRefs(node: TreeUpgradeNode): string[] {
  const refs: string[] = []
  const collect = (expr: TreeUpgradeNode['prerequisites']): void => {
    if (!expr) return
    if (expr.type === 'upgrade') {
      refs.push(expr.id)
      return
    }
    for (const item of expr.items) collect(item)
  }
  collect(node.prerequisites)
  return refs
}
