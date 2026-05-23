import type {
  PlayerState,
  PrerequisiteExpression,
  UpgradeDefinition,
  UpgradePrerequisites,
} from './types.js'

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
    return (state.upgrades[expr.id] ?? 0) > 0
  }

  if (expr.items.length === 0) {
    return expr.type === 'all'
  }

  if (expr.type === 'all') {
    return expr.items.every((item) => evaluatePrerequisiteExpression(item, state))
  }

  return expr.items.some((item) => evaluatePrerequisiteExpression(item, state))
}

/** Get the flat list of upgrade IDs referenced by a prerequisite declaration. */
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
    for (const item of node.items) collect(item)
  }

  collect(expr)
  return [...ids]
}

/** Convert a prerequisite declaration into a human-readable label. */
export function formatPrerequisiteExpression(
  prerequisites: UpgradePrerequisites | undefined,
): string {
  const expr = prerequisites ?? null
  if (!expr) return ''

  const format = (node: PrerequisiteExpression): string => {
    if (node.type === 'upgrade') return node.id
    const delimiter = node.type === 'all' ? ' and ' : ' or '
    return node.items
      .map((item) => {
        const rendered = format(item)
        if (item.type !== 'upgrade' && item.type !== node.type) {
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
  validUpgradeIds: ReadonlySet<string>,
  upgradeId: string,
): void {
  if (!prerequisites) return

  const validateNode = (node: PrerequisiteExpression): void => {
    if (node.type === 'upgrade') {
      if (!validUpgradeIds.has(node.id)) {
        throw new Error(
          `[prerequisites] upgrade '${upgradeId}' references unknown prerequisite '${node.id}'`,
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
  const validUpgradeIds = new Set(upgrades.map((u) => u.id))

  for (const upgrade of upgrades) {
    validatePrerequisiteExpression(upgrade.prerequisites, validUpgradeIds, upgrade.id)
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
