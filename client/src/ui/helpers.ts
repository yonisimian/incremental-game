import type { ModeFlavor, UpgradeDefinition } from '@game/shared'
import {
  getModeDefinition,
  getResourceIcon,
  getUpgradeName,
  isChoiceGroupAvailable,
  isCostAffordable,
  isMaxed,
  isPrerequisiteSatisfied,
  getUpgradeNextCost,
  TIMER_CENTISECONDS_BELOW_SEC,
} from '@game/shared'
import type { GameState } from '../game.js'
import { doBuy } from '../game.js'
import { formatNumber } from './format-number.js'

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
  const clamped = Math.max(0, seconds)
  if (clamped < TIMER_CENTISECONDS_BELOW_SEC) {
    const sec = Math.floor(clamped)
    const centi = Math.floor((clamped - sec) * 100)
    return `${sec}:${centi.toString().padStart(2, '0')}`
  }
  const total = Math.floor(clamped)
  const min = Math.floor(total / 60)
  const sec = total % 60
  return `${min}:${sec.toString().padStart(2, '0')}`
}

// ─── Game-Related Helpers ────────────────────────────────────────────

/** Escape HTML-special characters to prevent XSS when interpolating into innerHTML / attributes. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Public alias for escaping untrusted strings inside HTML attribute values. */
export const escapeAttr = escapeHtml

/** Get the display name for the local player ('Player' if empty). */
export function playerDisplayName(state: Readonly<GameState>): string {
  const name = state.playerName.trim()
  return name ? escapeHtml(name) : 'Player'
}

/** Get the display name for the opponent ('Opponent' if empty). */
export function opponentDisplayName(state: Readonly<GameState>): string {
  const name = state.opponentName.trim()
  return name ? escapeHtml(name) : 'Opponent'
}

/** Format a score for the scoreboard (includes target for target-score goal). */
export function formatScore(score: number, state: Readonly<GameState>): string {
  if (state.goal?.type === 'target-score') {
    return `${formatNumber(score)} / ${formatNumber(state.goal.target)}`
  }
  return formatNumber(score)
}

/** Can the player afford this upgrade (and is it still purchasable)? */
export function canAfford(state: Readonly<GameState>, u: UpgradeDefinition): boolean {
  const owned = state.player.upgrades[u.id] ?? 0
  if (isMaxed(u, owned)) return false
  if (!state.mode) return false
  return isCostAffordable(state.player.resources, getUpgradeNextCost(u, owned))
}

/** Render a cost map as a `"<amount> <icon>"` label, one entry per currency. */
export function formatCostLabel(
  cost: Readonly<Record<string, number>>,
  flavor: ModeFlavor,
): string {
  return Object.entries(cost)
    .map(([currency, amount]) => `${formatNumber(amount)} ${getResourceIcon(flavor, currency)}`)
    .join('  ')
}

/** Are this upgrade's prerequisites all owned? Empty / missing prereqs = always unlocked. */
export function isUnlocked(state: Readonly<GameState>, u: UpgradeDefinition): boolean {
  return isPrerequisiteSatisfied(u.prerequisites, state.player)
}

/** Combined check: prerequisites satisfied AND can afford (repeatability/balance/owned). */
export function canBuy(state: Readonly<GameState>, u: UpgradeDefinition): boolean {
  if (!state.mode) return false
  const modeDef = getModeDefinition(state.mode)
  return (
    isUnlocked(state, u) &&
    isChoiceGroupAvailable(u, state.player, modeDef.upgrades) &&
    canAfford(state, u)
  )
}

/** Update a progress bar element's width. */
export function updateProgressBar(id: string, score: number, target: number): void {
  const el = document.getElementById(id)
  if (el) el.style.width = `${Math.min(100, (score / target) * 100)}%`
}

/** Format purchased upgrade IDs as names with ×N suffix for repeats; preserves first-purchase order; unknown IDs fall back to the raw id. */
export function formatUpgradesPurchased(purchased: readonly string[], flavor: ModeFlavor): string {
  if (purchased.length === 0) return 'none'
  const counts = new Map<string, number>()
  for (const id of purchased) {
    counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  return [...counts]
    .map(([id, n]) => {
      const name = getUpgradeName(flavor, id)
      return n > 1 ? `${name} ×${n}` : name
    })
    .join(', ')
}

/**
 * Bind click handler via event delegation on the given container. Defaults to
 * '#upgrades' and buying directly. Pass `onActivate` to handle node clicks
 * differently (e.g. the tree panel opens a detail popup instead of buying).
 */
export function bindUpgradeEvents(
  containerId = 'upgrades',
  onActivate: (upgradeId: string) => void = doBuy,
): void {
  const container = document.getElementById(containerId)
  if (!container || container.dataset.delegated) return
  container.dataset.delegated = 'true'
  container.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.upgrade-btn')
    if (!btn || btn.disabled) return
    const uid = btn.dataset.upgrade
    if (uid) onActivate(uid)
  })
}
