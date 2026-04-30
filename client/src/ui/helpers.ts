import type { UpgradeCategory, UpgradeDefinition } from '@game/shared'
import { getModeDefinition } from '@game/shared'
import type { GameState } from '../game.js'
import { doBuy } from '../game.js'

// ─── Hotkeys ─────────────────────────────────────────────────────────

/**
 * Per-category index-hotkey characters — single source of truth for both
 * rendering (per-card label) and the global keydown handler (key → upgrade
 * by index). The Nth character is the hotkey for the Nth upgrade in that
 * category. Upgrades past the string length render without a hotkey label
 * and aren't keyboard-buyable; extend the string to add more.
 *
 * Categories without an entry (e.g. 'tree') get no per-index hotkeys.
 * Tree-specific hotkeys (buy-cheapest-in-tree, buy-all-in-tree) are tracked
 * in TODO.md and intentionally not wired here yet.
 */
export const UPGRADE_HOTKEYS: Partial<Record<UpgradeCategory, string>> = {
  play: '123456789',
}

// ─── Shared DOM Root ─────────────────────────────────────────────────

// Guarded for non-DOM environments (vitest in node). Production always has #app.
export const app =
  typeof document !== 'undefined'
    ? document.querySelector<HTMLDivElement>('#app')!
    : (null as unknown as HTMLDivElement)

// ─── DOM Helpers ─────────────────────────────────────────────────────

export function setText(id: string, text: string): void {
  const el = document.getElementById(id)
  if (el) el.textContent = text
}

export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds))
  const min = Math.floor(s / 60)
  const sec = s % 60
  return `${min}:${sec.toString().padStart(2, '0')}`
}

// ─── Game-Related Helpers ────────────────────────────────────────────

/** Format a score for the scoreboard (includes target for target-score goal). */
export function formatScore(score: number, state: Readonly<GameState>): string {
  const suffix = state.mode === 'idler' ? ' 🪵' : ''
  if (state.goal?.type === 'target-score') {
    return `${Math.floor(score)}${suffix} / ${state.goal.target}`
  }
  return `${Math.floor(score)}${suffix}`
}

/** Can the player afford this upgrade (and is it still purchasable)? */
export function canAfford(state: Readonly<GameState>, u: UpgradeDefinition): boolean {
  const owned = state.player.upgrades[u.id] ?? 0
  if (!u.repeatable && owned > 0) return false
  if (!state.mode) return false
  const modeDef = getModeDefinition(state.mode)
  const costResource = u.costCurrency ?? modeDef.scoreResource
  const balance = state.player.resources[costResource] ?? 0
  return balance >= u.cost
}

/** Are this upgrade's prerequisites all owned? Empty / missing prereqs = always unlocked. */
export function isUnlocked(state: Readonly<GameState>, u: UpgradeDefinition): boolean {
  for (const pid of u.prerequisites ?? []) {
    if ((state.player.upgrades[pid] ?? 0) <= 0) return false
  }
  return true
}

/** Combined check: prerequisites satisfied AND can afford (repeatability/balance/owned). */
export function canBuy(state: Readonly<GameState>, u: UpgradeDefinition): boolean {
  return isUnlocked(state, u) && canAfford(state, u)
}

/** Update a progress bar element's width. */
export function updateProgressBar(id: string, score: number, target: number): void {
  const el = document.getElementById(id)
  if (el) el.style.width = `${Math.min(100, (score / target) * 100)}%`
}

/** Bind click handler via event delegation on the given container. Defaults to '#upgrades'. */
export function bindUpgradeEvents(containerId = 'upgrades'): void {
  const container = document.getElementById(containerId)
  if (!container || container.dataset.delegated) return
  container.dataset.delegated = 'true'
  container.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.upgrade-btn')
    if (!btn || btn.disabled) return
    const uid = btn.dataset.upgrade
    if (uid) doBuy(uid)
  })
}
