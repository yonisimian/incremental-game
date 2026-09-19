import type {
  PlayerState,
  PrerequisiteExpression,
  UpgradeDefinition,
  UpgradePrerequisites,
} from './types.js'

/**
 * The `meta` counters a prerequisite may test. A whitelist rather than a free
 * string: the server is the only writer of these keys, so a key nothing stamps
 * would lock its node forever, and that should fail at boot, not in play.
 *
 * - `attacksSuffered` — how many enemy *active* strikes have landed on this
 *   player (moved something or opened a window; a miss does not count).
 *   Stamped by the server's strike resolution.
 */
export const PREREQUISITE_META_KEYS = ['attacksSuffered'] as const

/** A `meta` key a prerequisite may test (see {@link PREREQUISITE_META_KEYS}). */
export type PrerequisiteMetaKey = (typeof PREREQUISITE_META_KEYS)[number]

/**
 * How each `meta` prerequisite reads in a "Requires …" label — the noun phrase
 * for `min: 1`; `formatPrerequisiteExpression` appends `×N` for a higher bar.
 */
const PREREQUISITE_META_LABELS: Record<PrerequisiteMetaKey, string> = {
  attacksSuffered: 'being hit by an enemy attack',
}

function isPrerequisiteMetaKey(key: string): key is PrerequisiteMetaKey {
  return (PREREQUISITE_META_KEYS as readonly string[]).includes(key)
}

/** Whether the given prerequisite declaration is satisfied by the player's owned upgrades. */
export function isPrerequisiteSatisfied(
  prerequisites: UpgradePrerequisites | undefined,
  state: PlayerState,
): boolean {
  const expr = prerequisites ?? null
  if (!expr) return true
  return evaluatePrerequisiteExpression(expr, state)
}

function evaluatePrerequisiteExpression(expr: PrerequisiteExpression, state: PlayerState): boolean {
  if (expr.type === 'upgrade') {
    const minLevel = expr.minLevel ?? 1
    return (state.upgrades[expr.id] ?? 0) >= minLevel
  }

  if (expr.type === 'meta') {
    // An unstamped counter reads as zero — the round starts with none of them.
    const value = state.meta[expr.key]
    return (typeof value === 'number' ? value : 0) >= expr.min
  }

  if (expr.items.length === 0) {
    return expr.type === 'all'
  }

  if (expr.type === 'all') {
    return expr.items.every((item) => evaluatePrerequisiteExpression(item, state))
  }

  return expr.items.some((item) => evaluatePrerequisiteExpression(item, state))
}

/**
 * Get the flat list of upgrade IDs referenced by a prerequisite declaration.
 * `meta` nodes name no upgrade and so contribute nothing here — they cannot
 * take part in a dependency cycle.
 */
export function getPrerequisiteUpgradeIds(
  prerequisites: UpgradePrerequisites | undefined,
): readonly string[] {
  const expr = prerequisites ?? null
  if (!expr) return []
  const ids = new Set<string>()

  const collect = (node: PrerequisiteExpression): void => {
    if (node.type === 'upgrade') {
      ids.add(node.id)
      return
    }
    if (node.type === 'meta') return
    for (const item of node.items) collect(item)
  }

  collect(expr)
  return [...ids]
}

/** Convert a prerequisite declaration into a human-readable label.
 *
 * By default each upgrade is shown by its raw id. Pass `resolveName` to map ids
 * to display names (e.g. flavor names) for a friendlier label. A `meta` node
 * renders its fixed label (e.g. "being hit by an enemy attack"), with `×N`
 * appended when it asks for more than one.
 */
export function formatPrerequisiteExpression(
  prerequisites: UpgradePrerequisites | undefined,
  resolveName?: (id: string) => string,
): string {
  const expr = prerequisites ?? null
  if (!expr) return ''

  const format = (node: PrerequisiteExpression): string => {
    if (node.type === 'upgrade') {
      const label = resolveName ? resolveName(node.id) : node.id
      const minLevel = node.minLevel ?? 1
      return minLevel > 1 ? `${label} (level ${minLevel}+)` : label
    }
    if (node.type === 'meta') {
      const label = PREREQUISITE_META_LABELS[node.key]
      return node.min > 1 ? `${label} ×${node.min}` : label
    }
    const delimiter = node.type === 'all' ? ' and ' : ' or '
    return node.items
      .map((item) => {
        const rendered = format(item)
        if (item.type !== 'upgrade' && item.type !== 'meta' && item.type !== node.type) {
          return `(${rendered})`
        }
        return rendered
      })
      .join(delimiter)
  }

  return format(expr)
}

/** Validate prerequisites for a single upgrade. */
export function validatePrerequisiteExpression(
  prerequisites: UpgradePrerequisites | undefined,
  upgradeById: ReadonlyMap<string, UpgradeDefinition>,
  upgradeId: string,
): void {
  if (!prerequisites) return

  const validateNode = (node: PrerequisiteExpression): void => {
    if (node.type === 'upgrade') {
      const target = upgradeById.get(node.id)
      if (!target) {
        throw new Error(
          `[prerequisites] upgrade '${upgradeId}' references unknown prerequisite '${node.id}'`,
        )
      }

      if (node.minLevel !== undefined) {
        if (!Number.isInteger(node.minLevel) || node.minLevel < 1) {
          throw new Error(
            `[prerequisites] upgrade '${upgradeId}' references prerequisite '${node.id}' with invalid minLevel ${node.minLevel}`,
          )
        }
        if (target.purchaseLimit !== Infinity && node.minLevel > target.purchaseLimit) {
          throw new Error(
            `[prerequisites] upgrade '${upgradeId}' references prerequisite '${node.id}' with minLevel ${node.minLevel} greater than max level ${target.purchaseLimit}`,
          )
        }
      }
      return
    }

    if (node.type === 'meta') {
      // The type already narrows `key`, but a mode assembled from JSON or built
      // in code with a cast can still carry a stray string — check at runtime too.
      if (!isPrerequisiteMetaKey(node.key)) {
        throw new Error(
          `[prerequisites] upgrade '${upgradeId}' references unknown meta prerequisite '${String(node.key)}' (known: ${PREREQUISITE_META_KEYS.join(', ')})`,
        )
      }
      if (!Number.isInteger(node.min) || node.min < 1) {
        throw new Error(
          `[prerequisites] upgrade '${upgradeId}' meta prerequisite '${node.key}' has invalid min ${node.min} (must be a positive integer)`,
        )
      }
      return
    }

    if (node.items.length === 0) {
      throw new Error(
        `[prerequisites] upgrade '${upgradeId}' has empty '${node.type}' prerequisite group`,
      )
    }

    for (const item of node.items) {
      validateNode(item)
    }
  }

  validateNode(prerequisites)
}

/** Validate all upgrade prerequisite definitions and detect cycles. */
export function validateUpgradePrerequisites(upgrades: readonly UpgradeDefinition[]): void {
  const upgradeById = new Map(upgrades.map((u) => [u.id, u]))

  for (const upgrade of upgrades) {
    validatePrerequisiteExpression(upgrade.prerequisites, upgradeById, upgrade.id)
  }

  const graph = new Map<string, readonly string[]>()
  for (const upgrade of upgrades) {
    graph.set(upgrade.id, getPrerequisiteUpgradeIds(upgrade.prerequisites))
  }

  const visiting = new Set<string>()
  const visited = new Set<string>()

  const visit = (id: string, path: string[]): void => {
    if (visiting.has(id)) {
      const cycle = [...path, id].join(' -> ')
      throw new Error(`[prerequisites] circular dependency detected: ${cycle}`)
    }
    if (visited.has(id)) return

    visiting.add(id)
    const next = graph.get(id) ?? []
    for (const dep of next) {
      visit(dep, [...path, id])
    }
    visiting.delete(id)
    visited.add(id)
  }

  for (const upgrade of upgrades) {
    visit(upgrade.id, [])
  }
}
