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

/** Absolute canvas position of a node, or `null` if the id is unknown. */
export function nodePosition(tree: TreeFile, id: string): { x: number; y: number } | null {
  const p = walkPositioned(tree).find((n) => n.node.id === id)
  return p ? { x: p.x, y: p.y } : null
}

/**
 * Move a node so its absolute position becomes (`absX`, `absY`), by adjusting
 * its offset relative to its layout parent. Children move with it (their offsets
 * are unchanged). No-op if the id is unknown.
 */
export function setNodePosition(tree: TreeFile, id: string, absX: number, absY: number): void {
  const target = walkPositioned(tree).find((p) => p.node.id === id)
  if (!target) return
  const parentX = target.x - target.node.offset.x
  const parentY = target.y - target.node.offset.y
  target.node.offset = { x: absX - parentX, y: absY - parentY }
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

// ─── Mutation ────────────────────────────────────────────────────────

type Prereq = NonNullable<TreeUpgradeNode['prerequisites']>

/**
 * Set (or clear) a node's children. zod's recursive getter types `children`
 * loosely, so the write goes through a narrow cast; an empty array is removed
 * entirely to keep the serialized tree minimal (matches the authoring shape).
 */
function setChildren(node: TreeUpgradeNode, children: TreeUpgradeNode[]): void {
  const mutable = node as { children?: TreeUpgradeNode[] }
  if (children.length === 0) delete mutable.children
  else mutable.children = children
}

/** A fresh, minimal-but-valid node at the given offset. */
export function createNode(id: string, offset: { x: number; y: number }): TreeUpgradeNode {
  return { id, cost: {}, purchaseLimit: 1, modifiers: [], offset }
}

/** Generate an id not already used in the tree (`base`, then `base-2`, …). */
export function uniqueId(tree: TreeFile, base = 'node'): string {
  const existing = new Set(collectIds(tree))
  if (!existing.has(base)) return base
  let n = 2
  while (existing.has(`${base}-${n}`)) n++
  return `${base}-${n}`
}

/**
 * Append `node` as a child of `parentId`, or as a new root when `parentId` is
 * `null` (or the parent can't be found). Mutates the tree in place.
 */
export function addNode(tree: TreeFile, parentId: string | null, node: TreeUpgradeNode): void {
  const parent = parentId === null ? null : findNode(tree, parentId)
  if (!parent) {
    tree.upgrades.push(node)
    return
  }
  setChildren(parent, [...childrenOf(parent), node])
}

/** All ids in the subtree rooted at `node` (the node itself plus descendants). */
function subtreeIds(node: TreeUpgradeNode): string[] {
  const ids = [node.id]
  for (const child of childrenOf(node)) ids.push(...subtreeIds(child))
  return ids
}

/** Drop references to any removed id from a prerequisite expression. */
function prunePrereq(expr: Prereq, removed: ReadonlySet<string>): Prereq | undefined {
  if (expr.type === 'upgrade') return removed.has(expr.id) ? undefined : expr
  const items = expr.items
    .map((item) => prunePrereq(item, removed))
    .filter((item): item is Prereq => item !== undefined)
  if (items.length === 0) return undefined
  return { type: expr.type, items }
}

/** Strip prerequisite references to any of `removed` across the whole tree. */
function pruneReferences(tree: TreeFile, removed: ReadonlySet<string>): void {
  for (const { node } of walkPositioned(tree)) {
    if (!node.prerequisites) continue
    const pruned = prunePrereq(node.prerequisites, removed)
    if (pruned) node.prerequisites = pruned
    else delete (node as { prerequisites?: Prereq }).prerequisites
  }
}

/**
 * Remove the node with `id` (and its whole subtree) from the tree, then strip
 * any prerequisite references to the removed ids so the result stays valid.
 * Returns the removed ids, or `[]` if nothing matched.
 */
export function removeNode(tree: TreeFile, id: string): string[] {
  let removed: string[] = []
  const flavorUpgrades = tree.flavors[0]?.upgrades ?? []

  const removeFrom = (list: TreeUpgradeNode[]): boolean => {
    const idx = list.findIndex((n) => n.id === id)
    if (idx >= 0) {
      removed = subtreeIds(list[idx])
      list.splice(idx, 1)
      return true
    }
    for (const node of list) {
      const kids = [...childrenOf(node)]
      if (kids.length > 0 && removeFrom(kids)) {
        setChildren(node, kids)
        return true
      }
    }
    return false
  }
  removeFrom(tree.upgrades)
  if (removed.length > 0) {
    tree.flavors = tree.flavors.map((flavor, index) =>
      index === 0 ? { ...flavor, upgrades: flavorUpgrades.filter((entry) => !removed.includes(entry.id)) } : flavor,
    )
    pruneReferences(tree, new Set(removed))
  }
  return removed
}

/** The id of a node's layout parent, or `null` if it's a root (or unknown). */
export function parentOf(tree: TreeFile, id: string): string | null {
  const p = walkPositioned(tree).find((n) => n.node.id === id)
  return p?.parent?.id ?? null
}

/** Every id in the subtree rooted at `id` (inclusive), or `[]` if unknown. */
export function subtreeIdsOf(tree: TreeFile, id: string): string[] {
  const node = findNode(tree, id)
  return node ? subtreeIds(node) : []
}

/** Detach `id` from wherever it sits and return its node, or `null` if absent. */
function detachNode(tree: TreeFile, id: string): TreeUpgradeNode | null {
  let found: TreeUpgradeNode | null = null
  const removeFrom = (list: TreeUpgradeNode[]): boolean => {
    const idx = list.findIndex((n) => n.id === id)
    if (idx >= 0) {
      found = list[idx]
      list.splice(idx, 1)
      return true
    }
    for (const node of list) {
      const kids = [...childrenOf(node)]
      if (kids.length > 0 && removeFrom(kids)) {
        setChildren(node, kids)
        return true
      }
    }
    return false
  }
  removeFrom(tree.upgrades)
  return found
}

/**
 * Re-parent `id` under `newParentId` (or make it a root when `null`), preserving
 * the node's absolute canvas position by recomputing its offset — so its whole
 * subtree stays put visually but now drags with the new parent. No-op (returns
 * `false`) when the id is unknown, the parent is unchanged, or the move would
 * create a cycle (the new parent is the node itself or one of its descendants).
 */
export function reparentNode(tree: TreeFile, id: string, newParentId: string | null): boolean {
  if (id === newParentId) return false
  if (parentOf(tree, id) === newParentId) return false
  const node = findNode(tree, id)
  if (!node) return false
  if (newParentId !== null && subtreeIds(node).includes(newParentId)) return false

  const abs = nodePosition(tree, id)
  if (!abs) return false

  detachNode(tree, id)

  // Keep the absolute position fixed: offset = abs − parentAbs (origin for roots).
  const base =
    newParentId === null ? { x: 0, y: 0 } : (nodePosition(tree, newParentId) ?? { x: 0, y: 0 })
  node.offset = { x: abs.x - base.x, y: abs.y - base.y }
  addNode(tree, newParentId, node)
  return true
}
