// ─── Upgrade Tree Categories ─────────────────────────────────────────
//
// Whether the upgrade tree shows one category at a time, with arrows between
// them, or the whole tree on one canvas. A player setting, persisted to
// localStorage and read synchronously. Display-only — the server never sees it.

import type { ModeDefinition, UpgradeDefinition } from '@game/shared'

// ─── Rules ───────────────────────────────────────────────────────────

/**
 * The mode's category ids in arrow order, minus the ones with no upgrade in
 * this round (`upgrades` is the round's list, already filtered by goal, so the
 * trophy's category drops out of most rounds). Empty when the mode has none.
 */
export function roundCategories(
  modeDef: ModeDefinition,
  upgrades: readonly UpgradeDefinition[],
): readonly string[] {
  const used = new Set(upgrades.map((u) => u.category))
  return (modeDef.categories ?? []).map((c) => c.id).filter((id) => used.has(id))
}

/** The category `step` places from `current`, wrapping around both ends. */
export function stepCategory(ids: readonly string[], current: string, step: 1 | -1): string {
  const i = ids.indexOf(current)
  return ids[(i + step + ids.length) % ids.length]
}

// ─── Setting ─────────────────────────────────────────────────────────

const STORAGE_KEY = 'tree-categories'

let current = loadSetting()

function loadSetting(): boolean {
  try {
    // Off unless explicitly on, so a missing or unknown value keeps today's tree.
    return localStorage.getItem(STORAGE_KEY) === 'on'
  } catch {
    return false
  }
}

export function getTreeCategories(): boolean {
  return current
}

export function setTreeCategories(on: boolean): void {
  current = on
  try {
    localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off')
  } catch {
    /* localStorage unavailable */
  }
}
