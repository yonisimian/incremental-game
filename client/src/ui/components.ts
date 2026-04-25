import type { GameState } from '../game.js'
import { canAfford, formatTime, formatScore } from './helpers.js'
import type { UpgradeDefinition } from '@game/shared'

// ─── Goal Header Components ─────────────────────────────────────────

/** The timer element — styled as a safety-cap timer for target-score goals. */
export function renderTimer(state: Readonly<GameState>): string {
  const cls = state.goal?.type === 'target-score' ? 'timer safety-timer' : 'timer'
  return `<div class="${cls}" id="timer">${formatTime(state.timeLeft)}</div>`
}

/**
 * Full-width progress bars with embedded score labels for target-score mode.
 * Returns empty string for timed goals (no bars needed).
 */
export function renderProgressBars(state: Readonly<GameState>): string {
  if (state.goal?.type !== 'target-score') return ''
  const target = state.goal.target
  const playerPct = Math.min(100, (state.player.score / target) * 100)
  const opponentPct = Math.min(100, (state.opponent.score / target) * 100)
  return `
    <div class="target-progress">
      <div class="progress-row you">
        <div class="progress-bar bar-you">
          <div class="progress-fill you" id="player-progress" style="width:${playerPct}%"></div>
          <span class="bar-label">You: <span id="player-bar-score">${formatScore(state.player.score, state)}</span></span>
        </div>
      </div>
      <div class="progress-row opponent">
        <div class="progress-bar bar-opponent">
          <div class="progress-fill opponent" id="opponent-progress" style="width:${opponentPct}%"></div>
          <span class="bar-label">Opponent: <span id="opponent-bar-score">${formatScore(state.opponent.score, state)}</span></span>
        </div>
      </div>
    </div>
  `
}

// ─── Upgrades ────────────────────────────────────────────────────────

export function renderClickerUpgrades(state: Readonly<GameState>): string {
  return state.upgrades
    .map((u, i) => {
      const owned = state.player.upgrades[u.id]
      const affordable = canAfford(state, u)
      const disabled = owned || !affordable
      const hotkey = i + 1
      return `
        <button
          class="upgrade-btn ${owned ? 'owned' : ''} ${!affordable && !owned ? 'too-expensive' : ''}"
          data-upgrade="${u.id}"
          ${disabled ? 'disabled' : ''}
        >
          <span class="upgrade-name">${u.name}</span>
          <span class="upgrade-cost">${owned ? '✓' : `$${u.cost}`}</span>
          <span class="upgrade-desc">${u.description}</span>
          <span class="upgrade-hotkey">${hotkey}</span>
        </button>
      `
    })
    .join('')
}

export function renderIdlerUpgrades(state: Readonly<GameState>): string {
  return state.upgrades
    .map((u: UpgradeDefinition, i: number) => {
      const owned = state.player.upgrades[u.id]
      const affordable = canAfford(state, u)
      const disabled = (!u.repeatable && owned) || !affordable
      const emoji = u.costCurrency === 'wood' ? '🪵' : '🍺'
      const count = u.repeatable ? owned || 0 : 0
      const costLabel =
        !u.repeatable && owned ? '✓' : `${u.cost} ${emoji}${count > 0 ? ` (×${count})` : ''}`
      const hotkey = i + 1
      return `
        <button
          class="upgrade-btn ${!u.repeatable && owned ? 'owned' : ''} ${!affordable && !(owned && !u.repeatable) ? 'too-expensive' : ''}"
          data-upgrade="${u.id}"
          ${disabled ? 'disabled' : ''}
        >
          <span class="upgrade-name">${u.name}</span>
          <span class="upgrade-cost">${costLabel}</span>
          <span class="upgrade-desc">${u.description}</span>
          <span class="upgrade-hotkey">${hotkey}</span>
        </button>
      `
    })
    .join('')
}
