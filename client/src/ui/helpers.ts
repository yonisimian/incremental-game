import type { UpgradeDefinition, UpgradeId } from '@game/shared'
import type { GameState } from '../game.js'
import { doBuy } from '../game.js'

// ─── Shared DOM Root ─────────────────────────────────────────────────

export const app = document.querySelector<HTMLDivElement>('#app')!

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
  const owned = state.player.upgrades[u.id]
  if (!u.repeatable && owned) return false
  if (u.costCurrency) {
    const balance = u.costCurrency === 'wood' ? (state.player.wood ?? 0) : (state.player.ale ?? 0)
    return balance >= u.cost
  }
  return state.player.currency >= u.cost
}

/** Update a progress bar element's width. */
export function updateProgressBar(id: string, score: number, target: number): void {
  const el = document.getElementById(id)
  if (el) el.style.width = `${Math.min(100, (score / target) * 100)}%`
}

/** Bind click handlers on all .upgrade-btn elements. */
export function bindUpgradeEvents(): void {
  document.querySelectorAll<HTMLButtonElement>('.upgrade-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const uid = btn.dataset.upgrade
      if (uid) doBuy(uid as UpgradeId)
    })
  })
}
