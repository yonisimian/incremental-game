import { flattenUpgradeTree } from '../modes/upgrade-tree.js'

import type { ModeDefinition } from '../modes/types.js'
import type { UpgradeTreeNode } from '../modes/upgrade-tree.js'
import type { GameMode } from '../types.js'
import { registerMode, validateModeDefinition } from '../modes/index.js'
import { CURRENT_TREE_VERSION, TreeFileSchema } from './schema.js'

import type { TreeFile, TreeUpgradeNode } from './schema.js'

// ─── Versioning / migration ──────────────────────────────────────────

/**
 * V1 → V2: the per-upgrade `modifiers` array became `baseModifier` effects.
 * Rewrite every node (recursing into layout `children`) so each `{stage, field,
 * value}` modifier is appended to the node's `effects` as a `baseModifier` ref,
 * then drop the now-removed `modifiers` field. Order is preserved and existing
 * effects are kept ahead of the migrated ones.
 */
function migrateV1toV2(json: unknown): unknown {
  const migrateNode = (node: Record<string, unknown>): Record<string, unknown> => {
    const { modifiers, children, ...rest } = node
    const mods: unknown[] = Array.isArray(modifiers) ? modifiers : []
    const baseEffects = mods.map((m) => {
      const mod = m as Record<string, unknown>
      return { type: 'baseModifier', stage: mod.stage, field: mod.field, value: mod.value }
    })
    const existing: unknown[] = Array.isArray(rest.effects) ? rest.effects : []
    const effects = [...existing, ...baseEffects]
    const out: Record<string, unknown> = { ...rest }
    if (effects.length > 0) out.effects = effects
    if (Array.isArray(children)) {
      const kids: unknown[] = children
      out.children = kids.map((c) => migrateNode(c as Record<string, unknown>))
    }
    return out
  }

  const file = json as Record<string, unknown>
  const rawUpgrades: unknown[] = Array.isArray(file.upgrades) ? file.upgrades : []
  const upgrades = rawUpgrades.map((u) => migrateNode(u as Record<string, unknown>))
  return { ...file, version: 2, upgrades }
}

/**
 * Bring a raw, untrusted object up to the current schema version before it is
 * validated. The single seam for backward compatibility: when the file shape
 * changes, bump `CURRENT_TREE_VERSION` and add a step that upgrades the previous
 * version here.
 *
 * Returns the (possibly transformed) object for `TreeFileSchema` to validate.
 * Throws on a missing or unsupported version rather than guessing.
 */
function migrateTreeFile(json: unknown): unknown {
  let raw = json
  if ((raw as { version?: unknown } | null)?.version === 1) raw = migrateV1toV2(raw)
  const version = (raw as { version?: unknown } | null)?.version
  if (version === CURRENT_TREE_VERSION) return raw
  throw new Error(
    `Unsupported tree file version: ${String(version)} (expected ${String(CURRENT_TREE_VERSION)})`,
  )
}

// ─── Parse (JSON → validated authoring tree) ─────────────────────────

/**
 * Validate an untrusted value into a typed {@link TreeFile}: migrate to the
 * current version, then check it against {@link TreeFileSchema}. Throws
 * (`ZodError` or a version error) on any malformed input.
 *
 * Callers pass an already-parsed JSON value (e.g. `await res.json()`).
 */
export function parseTreeFile(json: unknown): TreeFile {
  return TreeFileSchema.parse(migrateTreeFile(json))
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
    attacks: tree.attacks,
    goals: tree.goals,
    flavors: tree.flavors,
    upgrades: flattenUpgradeTree(tree.upgrades.map(toRuntimeNode)),
    // Optional fields are assigned only when present so the result stays minimal.
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
  return JSON.stringify(TreeFileSchema.parse(tree), null, 2)
}
