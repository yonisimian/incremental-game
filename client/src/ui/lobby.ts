import type { GameMode } from '@game/shared'
import { getModeDefinition } from '@game/shared'
import { selectMode } from '../game.js'
import { app } from './helpers.js'

export function renderLobbyScreen(): void {
  app.innerHTML = `
    <div class="screen lobby-screen">
      <h1>incremen<span class="brand-t">T</span>al</h1>
      <p class="status-text">Choose a game mode</p>
      <div class="mode-buttons" id="mode-buttons">
        <button class="mode-btn" data-mode="clicker">
          <span class="mode-name">Clicker</span>
          <span class="mode-desc">Click fast, buy upgrades, outscore your opponent</span>
        </button>
        <button class="mode-btn" data-mode="idler">
          <span class="mode-name">Idler</span>
          <span class="mode-desc">Passive income only — pure upgrade strategy</span>
        </button>
        <button class="mode-btn tbd" disabled>
          <span class="mode-name">TBD</span>
          <span class="mode-desc">Coming soon…</span>
        </button>
      </div>
      <div class="goal-picker hidden" id="goal-picker"></div>
    </div>
  `

  document.querySelectorAll<HTMLButtonElement>('.mode-btn:not(:disabled)').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode as GameMode | undefined
      if (mode === 'clicker' || mode === 'idler') showGoalPicker(mode)
    })
  })
}

/** Replace mode buttons with just the selected one, then show goal cards. */
function showGoalPicker(mode: GameMode): void {
  const config = getModeDefinition(mode)
  const buttonsContainer = document.getElementById('mode-buttons')!
  const picker = document.getElementById('goal-picker')!

  // Keep only the selected button (instant swap)
  const selectedBtn = buttonsContainer.querySelector<HTMLButtonElement>(`[data-mode="${mode}"]`)
  if (selectedBtn) {
    selectedBtn.classList.add('selected')
    buttonsContainer.innerHTML = selectedBtn.outerHTML
  }

  // Build goal cards
  const cards = config.goals
    .map((goal) => {
      if (goal.type === 'timed') {
        return `
          <button class="goal-card" data-goal-type="timed">
            <span class="goal-icon">⏱</span>
            <span class="goal-name">Timed</span>
            <span class="goal-detail">${goal.durationSec}s</span>
          </button>
        `
      }
      if (goal.type === 'target-score') {
        return `
          <button class="goal-card" data-goal-type="target-score">
            <span class="goal-icon">🎯</span>
            <span class="goal-name">Race to ${goal.target}</span>
            <span class="goal-detail">First to ${goal.target} wins</span>
          </button>
        `
      }
      return `
        <button class="goal-card" data-goal-type="buy-upgrade">
          <span class="goal-icon">🏆</span>
          <span class="goal-name">Race to Buy</span>
          <span class="goal-detail">First to buy the trophy</span>
        </button>
      `
    })
    .join('')

  picker.innerHTML = `
    <p class="status-text">Choose a goal</p>
    <div class="goal-cards">${cards}</div>
    <button class="back-btn" id="goal-back-btn">← Back</button>
  `

  // Show picker immediately (single DOM reflow, no rAF delay)
  picker.classList.remove('hidden')
  picker.classList.add('fade-in')

  // Goal card click handlers
  picker.querySelectorAll<HTMLButtonElement>('.goal-card').forEach((card) => {
    card.addEventListener('click', () => {
      const goalType = card.dataset.goalType
      const goal = config.goals.find((g) => g.type === goalType)
      if (goal) selectMode(mode, goal)
    })
  })

  // Back button
  document.getElementById('goal-back-btn')!.addEventListener('click', () => {
    renderLobbyScreen()
  })
}
