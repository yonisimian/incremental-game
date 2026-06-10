import type { ModeDefinition } from '../modes/types.js'
import type { UpgradeTreeNode } from '../modes/upgrade-tree.js'
import { CURRENT_TREE_VERSION, TreeFileSchema } from './schema.js'

import type { TreeFile, TreeUpgradeNode } from './schema.js'

// ─── Runtime authoring tree → serializable file form ─────────────────

/**
 * Convert a runtime authoring node to its serializable file form: map the
 * unlimited sentinel (`Infinity`) to `null` (JSON cannot encode `Infinity`) and
 * recurse into layout children. Inverse of the codec's `toRuntimeNode`.
 */
function toFileNode(node: UpgradeTreeNode): TreeUpgradeNode {
  const { purchaseLimit, children, ...rest } = node
  const fileNode = {
    ...rest,
    purchaseLimit: Number.isFinite(purchaseLimit) ? purchaseLimit : null,
    ...(children ? { children: children.map(toFileNode) } : {}),
  }
  // readonly arrays in `rest` are runtime-identical but not type-assignable to
  // the schema's mutable arrays; the cast bridges that without copying.
  return fileNode as TreeUpgradeNode
}

/**
 * Build a serializable {@link TreeFile} from a runtime {@link ModeDefinition}
 * plus its nested authoring roots (the offsets/nesting that flattening discards).
 * This is the authoring → file direction used by the build-time emit step;
 * {@link parseTree} is the inverse (file → runtime). The result is validated
 * against {@link TreeFileSchema}, so an invalid mode never yields a tree file.
 */
export function toTreeFile(
  id: string,
  mode: ModeDefinition,
  roots: readonly UpgradeTreeNode[],
): TreeFile {
  return TreeFileSchema.parse({
    version: CURRENT_TREE_VERSION,
    id,
    resources: mode.resources,
    scoreResource: mode.scoreResource,
    clicksEnabled: mode.clicksEnabled,
    highlightEnabled: mode.highlightEnabled,
    ...(mode.highlightUnlockUpgrade !== undefined
      ? { highlightUnlockUpgrade: mode.highlightUnlockUpgrade }
      : {}),
    initialResources: mode.initialResources,
    initialMeta: mode.initialMeta,
    nativeModifiers: mode.nativeModifiers,
    ...(mode.effects !== undefined ? { effects: mode.effects } : {}),
    generators: mode.generators,
    goals: mode.goals,
    flavor: mode.flavor,
    upgrades: roots.map(toFileNode),
  })
}
