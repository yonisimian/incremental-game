// ─── Upgrade Tree Visibility ─────────────────────────────────────────
//
// Which upgrades the tree shows: all of them, only the ones the player can
// reach, or those plus one step ahead. A player setting, persisted to
// localStorage and read synchronously. Display-only — the server never sees it.

import { getPrerequisiteUpgradeIds } from '@game/shared'
import type { GameState } from '../game.js'
import { isUnlocked } from './helpers.js'

// ─── Types ───────────────────────────────────────────────────────────

/**
 * - `full` — every upgrade.
 * - `hidden` — only upgrades whose prerequisites are met.
 * - `peek` — `hidden`, plus the children of those upgrades.
 */
export type TreeVisibility = 'full' | 'hidden' | 'peek'

// ─── Rule ────────────────────────────────────────────────────────────

/**
 * Ids of the upgrades whose prerequisites are met (`isUnlocked`). Computed once
 * per render and shared by the visibility rule and the tree's edge styling.
 */
export function unlockedUpgradeIds(
  state: Readonly<Pick<GameState, 'upgrades' | 'player'>>,
): ReadonlySet<string> {
  return new Set(state.upgrades.filter((u) => isUnlocked(state, u)).map((u) => u.id))
}

/**
 * Ids of the upgrades the tree shows for this player under `mode`. Parent and
 * child follow prerequisite edges, not layout nesting. Cost doesn't matter: an
 * upgrade the player can't afford is still shown once it's reachable. Pass
 * `unlocked` when the caller already has {@link unlockedUpgradeIds}.
 */
export function visibleUpgradeIds(
  state: Readonly<Pick<GameState, 'upgrades' | 'player'>>,
  mode: TreeVisibility,
  unlocked?: ReadonlySet<string>,
): ReadonlySet<string> {
  const { upgrades } = state
  if (mode === 'full') return new Set(upgrades.map((u) => u.id))

  const revealed = unlocked ?? unlockedUpgradeIds(state)
  if (mode === 'hidden') return revealed

  // One pass over the revealed set, never recursing, so grandchildren stay hidden.
  const visible = new Set(revealed)
  for (const u of upgrades) {
    if (getPrerequisiteUpgradeIds(u.prerequisites).some((id) => revealed.has(id))) {
      visible.add(u.id)
    }
  }
  return visible
}

// ─── Setting ─────────────────────────────────────────────────────────

const STORAGE_KEY = 'tree-visibility'
const DEFAULT: TreeVisibility = 'full'

let current: TreeVisibility = loadSetting()

function loadSetting(): TreeVisibility {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return isTreeVisibility(raw) ? raw : DEFAULT
  } catch {
    return DEFAULT
  }
}

function isTreeVisibility(v: unknown): v is TreeVisibility {
  return v === 'full' || v === 'hidden' || v === 'peek'
}

export function getTreeVisibility(): TreeVisibility {
  return current
}

export function setTreeVisibility(mode: TreeVisibility): void {
  current = mode
  try {
    localStorage.setItem(STORAGE_KEY, mode)
  } catch {
    /* localStorage unavailable */
  }
}
