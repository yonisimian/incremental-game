import type { UpgradeDefinition, UpgradePosition } from '../types.js'

/**
 * Authoring form of an upgrade: a layout-tree node.
 *
 * Carries every gameplay field of `UpgradeDefinition` except the absolute
 * `position`, which is computed by {@link flattenUpgradeTree} from the node's
 * `offset` relative to its layout parent. `children` are **layout** children
 * (drawn relative to this node), not prerequisites — gating still lives entirely
 * in `prerequisites`.
 */
export interface UpgradeTreeNode extends Omit<UpgradeDefinition, 'position'> {
  /** Position relative to the layout parent (roots are relative to the origin). */
  readonly offset: UpgradePosition
  /** Layout children, positioned relative to this node. */
  readonly children?: readonly UpgradeTreeNode[]
}

const ORIGIN: UpgradePosition = { x: 0, y: 0 }

/**
 * Flatten a nested authoring tree into the flat `UpgradeDefinition[]` the engine
 * and renderer already consume.
 *
 * Each node's absolute `position` is resolved as `parentAbsolute + offset`,
 * recursing through `children`. Literal nested objects cannot cycle, so only
 * duplicate ids are checked (they would corrupt the flat id-keyed maps).
 *
 * Output is **pre-order** (each node precedes its descendants); consumers that
 * care about array order should rely on this rather than authoring order.
 */
export function flattenUpgradeTree(
  roots: readonly UpgradeTreeNode[],
): readonly UpgradeDefinition[] {
  const out: UpgradeDefinition[] = []
  const seen = new Set<string>()

  const walk = (node: UpgradeTreeNode, parentAbs: UpgradePosition): void => {
    if (seen.has(node.id)) {
      throw new Error(`Duplicate upgrade id in tree: ${node.id}`)
    }
    seen.add(node.id)

    const position: UpgradePosition = {
      x: parentAbs.x + node.offset.x,
      y: parentAbs.y + node.offset.y,
    }
    const { offset: _offset, children, ...def } = node
    out.push({ ...def, position })

    for (const child of children ?? []) walk(child, position)
  }

  for (const root of roots) walk(root, ORIGIN)
  return out
}
