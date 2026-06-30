/**
 * Editor data model — a mutable working copy of a `TreeFile` plus pure helpers
 * for walking the nested authoring tree, resolving absolute node positions from
 * relative offsets, and looking nodes up by id.
 *
 * The editor mutates this working copy in place (zod-inferred arrays are
 * mutable); `io.ts` is the only boundary that validates it against the schema.
 */

import type { TreeFile, TreeUpgradeNode } from '@game/shared'
import { ENEMY_DATA_RATE_SUFFIX, enemyDataResourceKey } from '@game/shared'

/** A node's display-flavor entry, as stored in the mode flavor table. */
export type NodeFlavor = TreeFile['flavors'][number]['upgrades'][number]

/** Default icon for a freshly seeded flavor entry (matches the canvas default). */
const DEFAULT_FLAVOR_ICON = '❓'

/** Default icon for a freshly added resource. */
const DEFAULT_RESOURCE_ICON = '💎'

/** Default icon for a freshly added generator. */
const DEFAULT_GENERATOR_ICON = '🏭'

/**
 * Source-key prefix marking a `relativeModifier` source as a resource stockpile
 * (e.g. `resource:r0`). Mirrors the private constant in the shared
 * `addressable` module — kept in sync via the round-trip tests.
 */
const RESOURCE_SOURCE_PREFIX = 'resource:'

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
  return { id, cost: {}, purchaseLimit: 1, offset }
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
 * `null` (or the parent can't be found). Mutates the tree in place. Also seeds a
 * default flavor entry for the node so the tree stays loadable (the runtime
 * requires every upgrade to have one); idempotent, so re-parenting won't
 * duplicate it.
 */
export function addNode(tree: TreeFile, parentId: string | null, node: TreeUpgradeNode): void {
  ensureNodeFlavor(tree, node.id)
  const parent = parentId === null ? null : findNode(tree, parentId)
  if (!parent) {
    tree.upgrades.push(node)
    return
  }
  setChildren(parent, [...childrenOf(parent), node])
}

// ─── Display flavor (the mode flavor table) ──────────────────────────
//
// Flavor lives solely in `flavors[].upgrades[]`; the runtime resolves names,
// icons, and descriptions only from there. The editor reads/writes the primary
// flavor (`flavors[0]`) and keeps every flavor's table in sync with the node set
// so the tree stays valid (`validateModeDefinition` forbids missing/orphaned
// entries in any flavor).

/** The primary flavor's editable upgrade table, or `[]` if the tree has none. */
function primaryFlavorUpgrades(tree: TreeFile): NodeFlavor[] {
  return tree.flavors[0]?.upgrades ?? []
}

/** The display flavor for `id`, or a default derived from the id when absent. */
export function nodeFlavor(tree: TreeFile, id: string): NodeFlavor {
  return (
    primaryFlavorUpgrades(tree).find((entry) => entry.id === id) ?? {
      id,
      name: id,
      icon: DEFAULT_FLAVOR_ICON,
      description: '',
    }
  )
}

/** Upsert the primary display flavor for `id`. Mutates the tree in place. */
export function setNodeFlavor(
  tree: TreeFile,
  id: string,
  values: { name: string; icon: string; description: string },
): void {
  const table = primaryFlavorUpgrades(tree)
  const existing = table.find((entry) => entry.id === id)
  if (existing) {
    existing.name = values.name
    existing.icon = values.icon
    existing.description = values.description
  } else {
    table.push({ id, ...values })
  }
}

/**
 * Rename a node's id, keeping the rest of the tree referentially valid: every
 * flavor entry and every prerequisite reference pointing at the old id is
 * rewritten in lockstep (the runtime rejects orphaned flavor entries and
 * dangling prerequisite references alike, so a bare `node.id =` would invalidate
 * the tree). Returns `true` when the rename is applied; fails without mutating
 * when the new id is blank, already in use, or the node is absent. An unchanged
 * id is a successful no-op.
 */
export function renameNode(tree: TreeFile, oldId: string, newId: string): boolean {
  if (oldId === newId) return true
  if (newId === '' || findNode(tree, newId)) return false
  const node = findNode(tree, oldId)
  if (!node) return false

  node.id = newId
  for (const flavor of tree.flavors) {
    const entry = flavor.upgrades.find((e) => e.id === oldId)
    if (entry) entry.id = newId
  }
  for (const { node: ref } of walkPositioned(tree)) {
    if (ref.prerequisites) ref.prerequisites = renamePrereqRef(ref.prerequisites, oldId, newId)
  }
  return true
}

/** Ensure every flavor has an entry for `id` (default when missing). No-op if present. */
function ensureNodeFlavor(tree: TreeFile, id: string): void {
  for (const flavor of tree.flavors) {
    if (!flavor.upgrades.some((entry) => entry.id === id)) {
      flavor.upgrades.push({ id, name: id, icon: DEFAULT_FLAVOR_ICON, description: '' })
    }
  }
}

/** Drop flavor entries for any of `removed` from every flavor. */
function pruneFlavors(tree: TreeFile, removed: ReadonlySet<string>): void {
  for (const flavor of tree.flavors) {
    flavor.upgrades = flavor.upgrades.filter((entry) => !removed.has(entry.id))
  }
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

/** Rewrite every reference to `oldId` as `newId` within a prerequisite expression. */
function renamePrereqRef(expr: Prereq, oldId: string, newId: string): Prereq {
  if (expr.type === 'upgrade') return expr.id === oldId ? { ...expr, id: newId } : expr
  return { type: expr.type, items: expr.items.map((item) => renamePrereqRef(item, oldId, newId)) }
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
    const removedSet = new Set(removed)
    pruneFlavors(tree, removedSet)
    pruneReferences(tree, removedSet)
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

// ─── Resources + generators ──────────────────────────────────────────
//
// Resources, generators, upgrades, effects, and flavor all cross-reference each
// other (see plan 19). These helpers keep the working tree referentially valid
// continuously: rename rewrites every reference, and delete is *blocked* (with a
// human reason) while anything still points at the id, so the tree never needs a
// repair pass. `io.ts`'s `assertLoadable` remains the final guard at export.

/** A successful mutation, or a blocked one with a human-readable reason. */
export type MutationResult = { ok: true } | { ok: false; reason: string }

/** An editable resource row: stable key + primary-flavor display + initial amount. */
export interface ResourceRow {
  readonly key: string
  readonly displayName: string
  readonly icon: string
  readonly className?: string
  readonly initial: number
  readonly isScore: boolean
}

/** An editable generator row: mechanics + primary-flavor display, flattened. */
export interface GeneratorRow {
  readonly id: string
  readonly name: string
  readonly icon: string
  readonly baseCost: number
  readonly costScaling: number
  readonly costCurrency: string
  readonly productionResource: string
  readonly productionRate: number
}

/** A mutable effect ref (the file's loose `{ type, …params }` shape). */
type EffectRefMut = { type: string } & Record<string, unknown>

/**
 * Every effect ref in the tree, mutable in place: the mode-level `tree.effects`
 * **and** every upgrade's `effects`. Both are validated by the runtime, so a
 * cascade that misses either location would let an export fail.
 */
function* allEffectRefs(tree: TreeFile): Generator<EffectRefMut> {
  for (const ref of tree.effects ?? []) yield ref
  for (const { node } of walkPositioned(tree)) {
    for (const ref of node.effects ?? []) yield ref
  }
}

/** The `highlight` meta value (a resource key) if set, else `undefined`. */
function highlightKey(tree: TreeFile): string | undefined {
  const h = tree.initialMeta.highlight
  return typeof h === 'string' ? h : undefined
}

// ─── Resources ───────────────────────────────────────────────────────

/** The next free `rN` resource key. */
function uniqueResourceKey(tree: TreeFile): string {
  const used = new Set(tree.resources)
  let n = 0
  while (used.has(`r${n}`)) n++
  return `r${n}`
}

/** Resource rows for the editor (primary flavor joined, in declaration order). */
export function listResources(tree: TreeFile): ResourceRow[] {
  const flavor = new Map((tree.flavors[0]?.resources ?? []).map((r) => [r.key, r]))
  return tree.resources.map((key) => {
    const f = flavor.get(key)
    const initial = tree.initialResources[key]
    return {
      key,
      displayName: f?.displayName ?? key,
      icon: f?.icon ?? DEFAULT_RESOURCE_ICON,
      ...(f?.className ? { className: f.className } : {}),
      initial: typeof initial === 'number' ? initial : 0,
      isScore: tree.scoreResource === key,
    }
  })
}

/**
 * Append a new resource: a unique `rN` key, a zero starting amount, and a default
 * flavor entry in **every** flavor (the runtime requires matching keys across
 * flavors). Returns the new key.
 */
export function addResource(tree: TreeFile): string {
  const key = uniqueResourceKey(tree)
  tree.resources.push(key)
  tree.initialResources[key] = 0
  for (const f of tree.flavors) {
    f.resources.push({ key, displayName: key, icon: DEFAULT_RESOURCE_ICON })
  }
  return key
}

/**
 * The human-readable references that pin resource `key` in place (and thus block
 * deletion): the only-resource and score-resource invariants, generator cost +
 * production, the `highlight` meta, native modifier fields, upgrade costs, and
 * effect refs. Owned data that cascades on delete (initial amount, flavor
 * entries) is deliberately excluded.
 */
export function resourceReferences(tree: TreeFile, key: string): string[] {
  const refs: string[] = []
  if (tree.resources.length <= 1) refs.push('the only resource')
  if (tree.scoreResource === key) refs.push('the score resource')
  for (const g of tree.generators) {
    if (g.costCurrency === key) refs.push(`generator '${g.id}' cost`)
    if (g.production.resource === key) refs.push(`generator '${g.id}' production`)
  }
  if (highlightKey(tree) === key) refs.push('the highlight meta')
  if (tree.nativeModifiers.some((m) => m.field === key)) refs.push('a native modifier')
  for (const { node } of walkPositioned(tree)) {
    if (key in node.cost) refs.push(`upgrade '${node.id}' cost`)
  }
  for (const ref of allEffectRefs(tree)) {
    if (ref.type === 'relativeModifier') {
      if (ref.source === `${RESOURCE_SOURCE_PREFIX}${key}`) refs.push('a relativeModifier source')
      if (ref.field === key) refs.push('a relativeModifier field')
    } else if (
      ref.type === 'accessEnemyData' &&
      typeof ref.data === 'string' &&
      enemyDataResourceKey(ref.data) === key
    ) {
      refs.push('an accessEnemyData effect')
    }
  }
  return refs
}

/**
 * Rename resource `oldKey → newKey`, rewriting every reference so the tree stays
 * loadable: the resource list, score resource, initial amounts, the `highlight`
 * meta, native-modifier fields (resource keys only — never the `clickIncome`/
 * `globalMultiplier` specials), generator cost + production, upgrade cost record
 * keys, effect refs (the `resource:`-prefixed `relativeModifier` source, the bare
 * `field` target, and `accessEnemyData` data in both effect locations), and every
 * flavor's resource entry. Fails (no mutation) when the new key is blank, already
 * in use, or the old key is absent. An unchanged key is a successful no-op.
 */
export function renameResource(tree: TreeFile, oldKey: string, newKey: string): boolean {
  if (oldKey === newKey) return true
  if (newKey === '' || tree.resources.includes(newKey)) return false
  if (!tree.resources.includes(oldKey)) return false

  tree.resources = tree.resources.map((k) => (k === oldKey ? newKey : k))
  if (tree.scoreResource === oldKey) tree.scoreResource = newKey
  if (oldKey in tree.initialResources) {
    tree.initialResources[newKey] = tree.initialResources[oldKey]
    Reflect.deleteProperty(tree.initialResources, oldKey)
  }
  if (highlightKey(tree) === oldKey) tree.initialMeta.highlight = newKey
  for (const m of tree.nativeModifiers) {
    if (m.field === oldKey) m.field = newKey
  }
  for (const g of tree.generators) {
    if (g.costCurrency === oldKey) g.costCurrency = newKey
    if (g.production.resource === oldKey) g.production.resource = newKey
  }
  for (const { node } of walkPositioned(tree)) {
    if (oldKey in node.cost) {
      node.cost[newKey] = node.cost[oldKey]
      Reflect.deleteProperty(node.cost, oldKey)
    }
  }
  for (const ref of allEffectRefs(tree)) {
    if (ref.type === 'relativeModifier') {
      if (ref.source === `${RESOURCE_SOURCE_PREFIX}${oldKey}`)
        ref.source = `${RESOURCE_SOURCE_PREFIX}${newKey}`
      if (ref.field === oldKey) ref.field = newKey
    } else if (
      ref.type === 'accessEnemyData' &&
      typeof ref.data === 'string' &&
      enemyDataResourceKey(ref.data) === oldKey
    ) {
      ref.data = ref.data.endsWith(ENEMY_DATA_RATE_SUFFIX)
        ? `${newKey}${ENEMY_DATA_RATE_SUFFIX}`
        : newKey
    }
  }
  for (const f of tree.flavors) {
    for (const r of f.resources) if (r.key === oldKey) r.key = newKey
  }
  return true
}

/**
 * Remove resource `key`, dropping its owned data (initial amount + every flavor's
 * entry). Blocked when anything still references it (see {@link
 * resourceReferences}) so the tree stays loadable without a repair pass.
 */
export function removeResource(tree: TreeFile, key: string): MutationResult {
  if (!tree.resources.includes(key)) return { ok: false, reason: `unknown resource '${key}'` }
  const refs = resourceReferences(tree, key)
  if (refs.length > 0) return { ok: false, reason: `referenced by ${refs.join(', ')}` }
  tree.resources = tree.resources.filter((k) => k !== key)
  Reflect.deleteProperty(tree.initialResources, key)
  for (const f of tree.flavors) {
    f.resources = f.resources.filter((r) => r.key !== key)
  }
  return { ok: true }
}

/** Upsert the primary flavor's display data for resource `key`. No-op if absent. */
export function setResourceFlavor(
  tree: TreeFile,
  key: string,
  values: { displayName: string; icon: string; className?: string },
): void {
  const entry = tree.flavors[0]?.resources.find((r) => r.key === key)
  if (!entry) return
  entry.displayName = values.displayName
  entry.icon = values.icon
  if (values.className) entry.className = values.className
  else delete entry.className
}

/** Set the starting amount for resource `key`. */
export function setInitialResource(tree: TreeFile, key: string, amount: number): void {
  if (tree.resources.includes(key)) tree.initialResources[key] = amount
}

/** Point `scoreResource` at `key` (must be a live resource). */
export function setScoreResource(tree: TreeFile, key: string): void {
  if (tree.resources.includes(key)) tree.scoreResource = key
}

// ─── Generators ──────────────────────────────────────────────────────

/** The next free `gN` generator id. */
function uniqueGeneratorId(tree: TreeFile): string {
  const used = new Set(tree.generators.map((g) => g.id))
  let n = 0
  while (used.has(`g${n}`)) n++
  return `g${n}`
}

/** Generator rows for the editor (primary flavor joined, in declaration order). */
export function listGenerators(tree: TreeFile): GeneratorRow[] {
  const flavor = new Map((tree.flavors[0]?.generators ?? []).map((g) => [g.id, g]))
  return tree.generators.map((g) => {
    const f = flavor.get(g.id)
    return {
      id: g.id,
      name: f?.name ?? g.id,
      icon: f?.icon ?? DEFAULT_GENERATOR_ICON,
      baseCost: g.baseCost,
      costScaling: g.costScaling,
      costCurrency: g.costCurrency,
      productionResource: g.production.resource,
      productionRate: g.production.rate,
    }
  })
}

/**
 * Append a new generator with a unique `gN` id, sensible defaults (cost +
 * production in the first resource), and a default flavor entry in every flavor.
 * Returns the new id.
 */
export function addGenerator(tree: TreeFile): string {
  const id = uniqueGeneratorId(tree)
  const resource = tree.resources[0] ?? 'r0'
  tree.generators.push({
    id,
    baseCost: 10,
    costScaling: 1.15,
    costCurrency: resource,
    production: { resource, rate: 1 },
  })
  for (const f of tree.flavors) {
    f.generators.push({ id, name: id, icon: DEFAULT_GENERATOR_ICON })
  }
  return id
}

/**
 * Human-readable references that block deleting generator `id`: `generatorCost` /
 * `generatorUnlock` effects naming it, and `relativeModifier` fields targeting its
 * output — across both effect locations.
 */
export function generatorReferences(tree: TreeFile, id: string): string[] {
  const refs: string[] = []
  for (const ref of allEffectRefs(tree)) {
    if ((ref.type === 'generatorCost' || ref.type === 'generatorUnlock') && ref.generator === id) {
      refs.push(`a ${ref.type} effect`)
    } else if (ref.type === 'relativeModifier' && ref.field === id) {
      refs.push('a relativeModifier field')
    }
  }
  return refs
}

/**
 * Rename generator `oldId → newId`, rewriting every reference (the `generator`
 * param of `generatorCost`/`generatorUnlock`, `relativeModifier` field targets,
 * across both effect locations, and every flavor's generator entry). Fails (no
 * mutation) when the new id is blank, in use, or the old id is absent.
 */
export function renameGenerator(tree: TreeFile, oldId: string, newId: string): boolean {
  if (oldId === newId) return true
  if (newId === '' || tree.generators.some((g) => g.id === newId)) return false
  const gen = tree.generators.find((g) => g.id === oldId)
  if (!gen) return false

  gen.id = newId
  for (const f of tree.flavors) {
    for (const fg of f.generators) if (fg.id === oldId) fg.id = newId
  }
  for (const ref of allEffectRefs(tree)) {
    if (
      (ref.type === 'generatorCost' || ref.type === 'generatorUnlock') &&
      ref.generator === oldId
    ) {
      ref.generator = newId
    } else if (ref.type === 'relativeModifier' && ref.field === oldId) {
      ref.field = newId
    }
  }
  return true
}

/**
 * Remove generator `id` and its flavor entries. Blocked when an effect still
 * references it (see {@link generatorReferences}).
 */
export function removeGenerator(tree: TreeFile, id: string): MutationResult {
  if (!tree.generators.some((g) => g.id === id))
    return { ok: false, reason: `unknown generator '${id}'` }
  const refs = generatorReferences(tree, id)
  if (refs.length > 0) return { ok: false, reason: `referenced by ${refs.join(', ')}` }
  tree.generators = tree.generators.filter((g) => g.id !== id)
  for (const f of tree.flavors) {
    f.generators = f.generators.filter((fg) => fg.id !== id)
  }
  return { ok: true }
}

/** Patch a generator's mechanics. Unknown id is a no-op. */
export function setGeneratorField(
  tree: TreeFile,
  id: string,
  patch: Partial<{
    baseCost: number
    costScaling: number
    costCurrency: string
    productionResource: string
    productionRate: number
  }>,
): void {
  const gen = tree.generators.find((g) => g.id === id)
  if (!gen) return
  if (patch.baseCost !== undefined) gen.baseCost = patch.baseCost
  if (patch.costScaling !== undefined) gen.costScaling = patch.costScaling
  if (patch.costCurrency !== undefined) gen.costCurrency = patch.costCurrency
  if (patch.productionResource !== undefined) gen.production.resource = patch.productionResource
  if (patch.productionRate !== undefined) gen.production.rate = patch.productionRate
}

/** Upsert the primary flavor's display data for generator `id`. No-op if absent. */
export function setGeneratorFlavor(
  tree: TreeFile,
  id: string,
  values: { name: string; icon: string },
): void {
  const entry = tree.flavors[0]?.generators.find((g) => g.id === id)
  if (!entry) return
  entry.name = values.name
  entry.icon = values.icon
}
