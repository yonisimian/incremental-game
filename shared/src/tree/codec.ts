import { flattenUpgradeTree } from '../modes/upgrade-tree.js'

import type { ModeDefinition } from '../modes/types.js'
import type { UpgradeTreeNode } from '../modes/upgrade-tree.js'
import type { GameMode } from '../types.js'
import { registerMode, validateModeDefinition } from '../modes/index.js'
import { CURRENT_TREE_VERSION, TreeFileSchema } from './schema.js'

import type { TreeFile, TreeUpgradeNode } from './schema.js'

// ─── Versioning ──────────────────────────────────────────────────────

/**
 * Check a raw, untrusted object is at the current schema version before it is
 * validated. There is no migration: the game has no players and every tree file
 * lives in this repo, so a format change converts the files instead. Throws on
 * a missing or unsupported version rather than guessing.
 */
function checkTreeVersion(json: unknown): unknown {
  const version = (json as { version?: unknown } | null)?.version
  if (version === CURRENT_TREE_VERSION) return json
  throw new Error(
    `Unsupported tree file version: ${String(version)} (expected ${String(CURRENT_TREE_VERSION)})`,
  )
}

// ─── Parse (JSON → validated authoring tree) ─────────────────────────

/**
 * Validate an untrusted value into a typed {@link TreeFile}: check its version,
 * then check it against {@link TreeFileSchema}. Throws (`ZodError` or a version
 * error) on any malformed input.
 *
 * Callers pass an already-parsed JSON value (e.g. `await res.json()`).
 */
export function parseTreeFile(json: unknown): TreeFile {
  return TreeFileSchema.parse(checkTreeVersion(json))
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
 * `name` only labels those errors — the tree itself carries no mode id.
 */
export function toModeDefinition(tree: TreeFile, name = 'tree'): ModeDefinition {
  const def: ModeDefinition = {
    resources: tree.resources,
    scoreResource: tree.scoreResource,
    clicksEnabled: tree.clicksEnabled,
    highlightEnabled: tree.highlightEnabled,
    initialResources: tree.initialResources,
    initialMeta: tree.initialMeta,
    generators: tree.generators,
    attacks: tree.attacks,
    pacts: tree.pacts,
    goals: tree.goals,
    flavors: tree.flavors,
    upgrades: flattenUpgradeTree(
      tree.categories.map((c) => ({ id: c.id, upgrades: c.upgrades.map(toRuntimeNode) })),
    ),
    categories: tree.categories.map((c) => ({ id: c.id })),
    // The file's `startingEffects` are the runtime mode-level `effects` — one
    // channel under two names because the runtime field sits alongside each
    // upgrade's and attack's `effects`. Assigned only when non-empty so the
    // result stays minimal.
    ...(tree.startingEffects.length > 0 ? { effects: tree.startingEffects } : {}),
  }
  validateModeDefinition(name, def)
  return def
}

/**
 * The single trust boundary between untrusted tree data and the engine:
 * `parse → version check → validate → flatten → assemble → re-validate`. Returns a
 * ready-to-register {@link ModeDefinition}, or throws on any invalid input.
 */
export function parseTree(json: unknown, name?: string): ModeDefinition {
  return toModeDefinition(parseTreeFile(json), name)
}

/**
 * Parse, validate, and register a tree file as a runtime mode in one step — the
 * boot entry point. The server reads the file from disk and the client fetches
 * it from the server, then both call this before any `getModeDefinition`.
 * `mode` is the tree's file name (`trees/<mode>.json`) — the mode id it is
 * registered under. Throws on any invalid input.
 */
export function loadTree(mode: GameMode, json: unknown): void {
  registerMode(mode, toModeDefinition(parseTreeFile(json), mode))
}

// ─── Serialize (authoring tree → JSON) ───────────────────────────────

/**
 * Serialize an authoring {@link TreeFile} to a pretty-printed JSON string. The
 * tree is re-validated first, so an invalid tree is never written to disk.
 * Inverse of {@link parseTreeFile}: `parseTreeFile(JSON.parse(serializeTree(t)))`
 * is structurally identical to `t`.
 */
export function serializeTree(tree: TreeFile): string {
  return JSON.stringify(TreeFileSchema.parse(tree), null, 2)
}
