import { flattenUpgradeTree } from '../modes/upgrade-tree.js'

import type { ModeDefinition } from '../modes/types.js'
import type { UpgradeTreeNode } from '../modes/upgrade-tree.js'
import type { GameMode } from '../types.js'
import { registerMode, validateModeDefinition } from '../modes/index.js'
import { CURRENT_TREE_VERSION, TreeFileSchema } from './schema.js'

import type { TreeFile, TreeUpgradeNode } from './schema.js'

// ─── Versioning / migration ──────────────────────────────────────────

/**
 * Bring a raw, untrusted object up to the current schema version before it is
 * validated. The single seam for backward compatibility: when the file shape
 * changes, bump `CURRENT_TREE_VERSION` and add a step that upgrades the previous
 * version here (e.g. `if (version === 1) raw = migrateV1toV2(raw)`).
 *
 * Returns the (possibly transformed) object for `TreeFileSchema` to validate.
 * Throws on a missing or unsupported version rather than guessing.
 */
function migrateTreeFile(json: unknown): unknown {
  const version = (json as { version?: unknown } | null)?.version
  if (version !== CURRENT_TREE_VERSION) {
    throw new Error(
      `Unsupported tree file version: ${String(version)} (expected ${String(CURRENT_TREE_VERSION)})`,
    )
  }

  const tree = json as {
    upgrades?: Array<{
      id?: string
      flavorName?: string
      flavorIcon?: string
      flavorDescription?: string
      children?: unknown[]
    }>
    flavors?: Array<{
      upgrades?: Array<{ id: string; name?: string; icon?: string; description?: string }>
    }>
  }

  const flavorEntries = new Map(
    (tree.flavors?.[0]?.upgrades ?? []).map((entry) => [entry.id, entry]),
  )
  const visit = (
    nodes:
      | Array<{
          id?: string
          flavorName?: string
          flavorIcon?: string
          flavorDescription?: string
          children?: unknown[]
        }>
      | undefined,
  ): void => {
    if (!Array.isArray(nodes)) return
    for (const node of nodes) {
      const entry = node.id ? flavorEntries.get(node.id) : undefined
      node.flavorName ??= entry?.name ?? node.id ?? 'Upgrade'
      node.flavorIcon ??= entry?.icon ?? '•'
      node.flavorDescription ??= entry?.description ?? ''
      visit(node.children as typeof nodes)
    }
  }

  visit(tree.upgrades)
  return tree
}

// ─── Parse (JSON → validated authoring tree) ─────────────────────────

/**
 * Validate an untrusted value into a typed {@link TreeFile}: migrate to the
 * current version, then check it against {@link TreeFileSchema}. Throws
 * (`ZodError` or a version error) on any malformed input.
 *
 * Callers pass an already-parsed JSON value (e.g. `await res.json()`).
 */
function hydrateFlavorFields(tree: TreeFile): TreeFile {
  const flavorMap = new Map((tree.flavors[0]?.upgrades ?? []).map((entry) => [entry.id, entry]))

  const visit = (nodes: readonly TreeUpgradeNode[]): void => {
    for (const node of nodes) {
      const entry = flavorMap.get(node.id)
      if (entry) {
        if (node.flavorName === undefined) node.flavorName = entry.name
        if (node.flavorIcon === undefined) node.flavorIcon = entry.icon
        if (node.flavorDescription === undefined) node.flavorDescription = entry.description
      }
      if (node.children) visit(node.children)
    }
  }

  visit(tree.upgrades)
  return tree
}

function syncFlavorFields(tree: TreeFile): TreeFile {
  const next = structuredClone(tree)
  const flavorEntries = [...(next.flavors[0]?.upgrades ?? [])]

  const visit = (nodes: readonly TreeUpgradeNode[]): void => {
    for (const node of nodes) {
      const existing = flavorEntries.find((entry) => entry.id === node.id)
      const name = node.flavorName ?? existing?.name ?? node.id
      const icon = node.flavorIcon ?? existing?.icon ?? '•'
      const description = node.flavorDescription ?? existing?.description ?? ''

      node.flavorName = name
      node.flavorIcon = icon
      node.flavorDescription = description

      const index = flavorEntries.findIndex((entry) => entry.id === node.id)
      const flavorEntry = { id: node.id, name, icon, description }
      if (index >= 0) flavorEntries[index] = flavorEntry
      else flavorEntries.push(flavorEntry)

      if (node.children) visit(node.children)
    }
  }

  visit(next.upgrades)
  next.flavors = next.flavors.map((flavor, index) =>
    index === 0 ? { ...flavor, upgrades: flavorEntries } : flavor,
  )

  return next
}

export function parseTreeFile(json: unknown): TreeFile {
  return hydrateFlavorFields(TreeFileSchema.parse(migrateTreeFile(json)))
}

// ─── Authoring tree → runtime mode definition ────────────────────────

/**
 * Convert a serializable node into the runtime authoring node: map the unlimited
 * sentinel (`null`) back to `Infinity` and recurse into layout children.
 */
function toRuntimeNode(node: TreeUpgradeNode): UpgradeTreeNode {
  const { purchaseLimit, children, ...rest } = node
  const runtime: UpgradeTreeNode = { ...rest, purchaseLimit: purchaseLimit ?? Infinity }
  return children ? { ...runtime, children: children.map(toRuntimeNode) } : runtime
}

/**
 * Assemble a validated {@link TreeFile} into a runtime {@link ModeDefinition}:
 * map sentinels, flatten the offset tree to absolute positions, then run the
 * existing mode/prerequisite/choice-group/effect validation. Throws on any
 * inconsistency (duplicate id, unknown effect type, malformed effect params, …).
 */
export function toModeDefinition(tree: TreeFile): ModeDefinition {
  const def: ModeDefinition = {
    resources: tree.resources,
    scoreResource: tree.scoreResource,
    clicksEnabled: tree.clicksEnabled,
    highlightEnabled: tree.highlightEnabled,
    initialResources: tree.initialResources,
    initialMeta: tree.initialMeta,
    nativeModifiers: tree.nativeModifiers,
    generators: tree.generators,
    goals: tree.goals,
    flavors: tree.flavors,
    upgrades: flattenUpgradeTree(tree.upgrades.map(toRuntimeNode)),
    // Optional fields are assigned only when present so the result stays minimal.
    ...(tree.highlightUnlockUpgrade !== undefined
      ? { highlightUnlockUpgrade: tree.highlightUnlockUpgrade }
      : {}),
    ...(tree.effects !== undefined ? { effects: tree.effects } : {}),
  }
  validateModeDefinition(tree.id, def)
  return def
}

/**
 * The single trust boundary between untrusted tree data and the engine:
 * `parse → migrate → validate → flatten → assemble → re-validate`. Returns a
 * ready-to-register {@link ModeDefinition}, or throws on any invalid input.
 */
export function parseTree(json: unknown): ModeDefinition {
  return toModeDefinition(parseTreeFile(json))
}

/**
 * Parse, validate, and register a tree file as a runtime mode in one step — the
 * boot entry point. The server reads the file from disk and the client fetches
 * it from the server, then both call this before any `getModeDefinition` (D18).
 * Returns the registered mode id. Throws on any invalid input.
 */
export function loadTree(json: unknown): GameMode {
  const file = parseTreeFile(json)
  const id = file.id as GameMode
  registerMode(id, toModeDefinition(file))
  return id
}

// ─── Serialize (authoring tree → JSON) ───────────────────────────────

/**
 * Serialize an authoring {@link TreeFile} to a pretty-printed JSON string. The
 * tree is re-validated first, so an invalid tree is never written to disk.
 * Inverse of {@link parseTreeFile}: `parseTreeFile(JSON.parse(serializeTree(t)))`
 * is structurally identical to `t`.
 */
export function serializeTree(tree: TreeFile): string {
  return JSON.stringify(TreeFileSchema.parse(syncFlavorFields(tree)), null, 2)
}
