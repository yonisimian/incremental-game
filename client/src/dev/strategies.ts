/**
 * Idler strategy definitions for the dev panel simulator.
 *
 * Strategies are auto-generated from the mode definition by enumerating
 * valid upgrade subsets (respecting prerequisites + choice groups) and
 * producing a topological purchase ordering with highlight switches.
 */

import {
  getModeDefinition,
  getPrerequisiteUpgradeIds,
  getCostCurrency,
  getUpgradeCostTotal,
  isPrerequisiteSatisfied,
} from '@game/shared'
import type { ModeDefinition, PlayerState, UpgradeDefinition } from '@game/shared'

// ─── Types ───────────────────────────────────────────────────────────

export interface StrategyAction {
  type: 'buy' | 'set_highlight'
  upgradeId?: string
  highlight?: string
}

export interface Strategy {
  name: string
  actions: StrategyAction[]
}

// ─── Helpers ─────────────────────────────────────────────────────────

const buy = (upgradeId: string): StrategyAction => ({ type: 'buy', upgradeId })
const hl = (h: string): StrategyAction => ({ type: 'set_highlight', highlight: h })

// ─── Upgrade abbreviations (for chart markers & table display) ──────

export const UPGRADE_ABBR: Record<string, string> = {
  uh: 'FT', // Focus Training
  u1: 'HL', // Heavy Logging
  u5: 'RT', // Royal Throne (trophy)
}

// ─── Strategy Generator ──────────────────────────────────────────────

/**
 * Largest upgrade count for which exhaustive `2^n` subset enumeration stays
 * tractable. Above this, `generateStrategies` skips generation rather than
 * hanging the dev panel. `2^8 = 256` subsets is well within budget.
 */
const MAX_ENUM_UPGRADES = 8

/**
 * Generate all valid strategies for a mode by enumerating upgrade subsets.
 *
 * For each subset:
 * 1. Validate prerequisite closure (all prereqs in subset)
 * 2. Validate choice-group exclusivity (at most one per group)
 * 3. Topologically sort by dependency depth then cost
 * 4. Insert highlight switches before currency transitions
 */
function generateStrategies(modeDef: ModeDefinition): Strategy[] {
  // Filter to timed-goal upgrades only (exclude trophy/buy-upgrade goals)
  const upgrades = modeDef.upgrades.filter((u) => !u.goalType)

  // Build prereq map and choice groups
  const prereqMap = new Map<string, readonly string[]>()
  const choiceGroups = new Map<string, string[]>() // group → upgrade IDs
  for (const u of upgrades) {
    prereqMap.set(u.id, getPrerequisiteUpgradeIds(u.prerequisites))
    if (u.choiceGroup) {
      const list = choiceGroups.get(u.choiceGroup) ?? []
      list.push(u.id)
      choiceGroups.set(u.choiceGroup, list)
    }
  }

  const strategies: Strategy[] = []

  // Always include the "no upgrades" baseline (highlight the score resource and
  // idle). Every strategy starts with a highlight so the simulator/charts have a
  // defined active resource from t=0.
  strategies.push({ name: 'No upgrades', actions: [hl(modeDef.scoreResource)] })

  // Enumerate subsets via bitmask. This is exponential (2^n), so it only stays
  // tractable for small trees; beyond MAX_ENUM_UPGRADES it would hang the dev
  // panel (and `1 << n` silently overflows JS's 32-bit bitwise math at n ≥ 31).
  const n = upgrades.length
  if (n > MAX_ENUM_UPGRADES) {
    console.warn(
      `[strategies] ${n} upgrades → 2^${n} subsets is intractable; skipping auto-generation (cap ${MAX_ENUM_UPGRADES}).`,
    )
    return strategies
  }
  for (let mask = 1; mask < 1 << n; mask++) {
    const subset = upgrades.filter((_, i) => mask & (1 << i))
    const subsetIds = new Set(subset.map((u) => u.id))

    // Validate prerequisite closure
    if (!isPrereqClosed(subset, subsetIds)) continue

    // Validate choice-group exclusivity
    if (!isChoiceValid(subset, choiceGroups)) continue

    // Topological sort
    const ordered = topoSort(subset, prereqMap)
    if (!ordered) continue // cycle (shouldn't happen)

    // Build action sequence with highlight switches
    const actions = buildActions(ordered, modeDef)
    const name = ordered.map((u) => UPGRADE_ABBR[u.id] ?? u.id).join('→')

    strategies.push({ name, actions })
  }

  return strategies
}

/** Check that all prerequisites of each subset member are also in the subset. */
function isPrereqClosed(subset: UpgradeDefinition[], subsetIds: Set<string>): boolean {
  for (const u of subset) {
    // For ANY-type prereqs, at least one prereq must be in subset
    // For ALL-type prereqs, all must be in subset
    if (!u.prerequisites) continue

    const state: PlayerState = {
      score: 0,
      resources: {},
      upgrades: Object.fromEntries([...subsetIds].map((id) => [id, 1])),
      generators: {},
      meta: {},
    }
    if (!isPrerequisiteSatisfied(u.prerequisites, state)) return false
  }
  return true
}

/** At most one upgrade per choice group in the subset. */
function isChoiceValid(subset: UpgradeDefinition[], choiceGroups: Map<string, string[]>): boolean {
  for (const [, members] of choiceGroups) {
    const count = subset.filter((u) => members.includes(u.id)).length
    if (count > 1) return false
  }
  return true
}

/** Topological sort by dependency depth (ties broken by cost ascending). */
function topoSort(
  subset: UpgradeDefinition[],
  prereqMap: Map<string, readonly string[]>,
): UpgradeDefinition[] | null {
  const subsetIds = new Set(subset.map((u) => u.id))
  const result: UpgradeDefinition[] = []
  const visited = new Set<string>()
  const visiting = new Set<string>()

  function visit(u: UpgradeDefinition): boolean {
    if (visited.has(u.id)) return true
    if (visiting.has(u.id)) return false // cycle
    visiting.add(u.id)

    const prereqs = prereqMap.get(u.id) ?? []
    for (const pid of prereqs) {
      if (!subsetIds.has(pid)) continue
      const parent = subset.find((s) => s.id === pid)
      if (parent && !visit(parent)) return false
    }

    visiting.delete(u.id)
    visited.add(u.id)
    result.push(u)
    return true
  }

  // Sort by cost to get deterministic ordering for same-depth nodes
  const sorted = [...subset].sort((a, b) => getUpgradeCostTotal(a, 0) - getUpgradeCostTotal(b, 0))
  for (const u of sorted) {
    if (!visit(u)) return null
  }

  return result
}

/** Build action sequence: insert highlight switches before currency transitions. */
function buildActions(ordered: UpgradeDefinition[], modeDef: ModeDefinition): StrategyAction[] {
  const actions: StrategyAction[] = []

  // Start with the highlight matching the first upgrade's currency
  const firstCurrency = ordered[0]
    ? getCostCurrency(ordered[0], modeDef.scoreResource)
    : modeDef.scoreResource
  actions.push(hl(firstCurrency))
  let currentHighlight = firstCurrency

  for (const u of ordered) {
    const currency = getCostCurrency(u, modeDef.scoreResource)
    if (currency !== currentHighlight) {
      actions.push(hl(currency))
      currentHighlight = currency
    }
    actions.push(buy(u.id))
  }

  // End with highlighting the score resource for remaining time
  if (currentHighlight !== modeDef.scoreResource) {
    actions.push(hl(modeDef.scoreResource))
  }

  return actions
}

// ─── Exported Strategies ─────────────────────────────────────────────

export const IDLER_STRATEGIES: readonly Strategy[] = generateStrategies(getModeDefinition('idler'))
