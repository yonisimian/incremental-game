import type { GameState } from '../game.js'
import { doClick, quitMatch, setHighlight } from '../game.js'
import { handledByHotkey } from './hotkeys.js'
import {
  renderTimer,
  renderProgressBars,
  renderClickerUpgrades,
  renderIdlerUpgrades,
} from './components.js'
import {
  app,
  setText,
  formatTime,
  formatScore,
  updateProgressBar,
  bindUpgradeEvents,
} from './helpers.js'
import { bumpScore } from './vfx/index.js'

// ─── Render ──────────────────────────────────────────────────────────

export function renderPlayingScreen(state: Readonly<GameState>): void {
  prevPlayerScore = 0
  if (state.mode !== 'clicker') {
    renderIdlerPlayingScreen(state)
    return
  }

  app.innerHTML = `
    <div class="screen playing-screen">
      <header class="game-header">
        <button class="quit-btn" id="quit-btn">← Quit</button>
        ${renderTimer(state)}
        ${renderProgressBars(state)}
      </header>

      ${
        state.goal?.type !== 'target-score'
          ? `<div class="scoreboard">
        <div class="player-col you">
          <span class="label">You</span>
          <span class="score" id="player-score">${formatScore(state.player.score, state)}</span>
        </div>
        <div class="vs">vs</div>
        <div class="player-col opponent">
          <span class="label">Opponent</span>
          <span class="score" id="opponent-score">${formatScore(state.opponent.score, state)}</span>
        </div>
      </div>`
          : ''
      }

      <button class="click-button" id="click-btn">CLICK<span class="btn-hotkey">Space</span></button>

      <div class="upgrades-wrapper">
        <div class="upgrades-header">
          <span class="currency-bar" id="currency-bar">💰 <span id="currency">${Math.floor(state.player.resources.currency)}</span></span>
          <span class="upgrades-hotkey"><span class="btn-hotkey">C</span> buy cheapest</span>
        </div>
        <div class="upgrades" id="upgrades">
          ${renderClickerUpgrades(state)}
        </div>
      </div>
    </div>
  `

  bindPlayingEvents(true)
}

function renderIdlerPlayingScreen(state: Readonly<GameState>): void {
  const highlight = (state.player.meta.highlight as string | undefined) ?? 'wood'
  const wood = Math.floor(state.player.resources.wood)
  const ale = Math.floor(state.player.resources.ale)

  app.innerHTML = `
    <div class="screen playing-screen idler-playing">
      <header class="game-header">
        <button class="quit-btn" id="quit-btn">← Quit</button>
        ${renderTimer(state)}
        ${renderProgressBars(state)}
      </header>

      ${
        state.goal?.type !== 'target-score'
          ? `<div class="scoreboard">
        <div class="player-col you">
          <span class="label">You</span>
          <span class="score" id="player-score">${formatScore(state.player.score, state)}</span>
        </div>
        <div class="vs">vs</div>
        <div class="player-col opponent">
          <span class="label">Opponent</span>
          <span class="score" id="opponent-score">${formatScore(state.opponent.score, state)}</span>
        </div>
      </div>`
          : ''
      }

      <div class="currency-cards">
        <span class="cards-hotkey">Tab</span>
        <button class="currency-card ${highlight === 'wood' ? 'highlighted' : ''}" id="card-wood">
          <span class="card-emoji">🪵</span>
          <span class="card-name">Wood</span>
          <span class="card-balance" id="wood-balance">${wood}</span>
        </button>
        <button class="currency-card ${highlight === 'ale' ? 'highlighted' : ''}" id="card-ale">
          <span class="card-emoji">🍺</span>
          <span class="card-name">Ale</span>
          <span class="card-balance" id="ale-balance">${ale}</span>
        </button>
      </div>

      <div class="upgrades-wrapper">
        <div class="upgrades-header">
          <span></span>
          <span class="upgrades-hotkey"><span class="btn-hotkey">C</span> buy cheapest</span>
        </div>
        <div class="upgrades" id="upgrades">
          ${renderIdlerUpgrades(state)}
        </div>
      </div>
    </div>
  `

  document.getElementById('quit-btn')!.addEventListener('click', quitMatch)
  bindIdlerEvents()
}

// ─── In-place Update ─────────────────────────────────────────────────

let prevPlayerScore = 0

export function updatePlaying(state: Readonly<GameState>): void {
  // Update timer / safety-cap timer
  setText('timer', formatTime(state.timeLeft))

  const scoreChanged = state.player.score !== prevPlayerScore
  prevPlayerScore = state.player.score

  // Update target-score progress if applicable
  if (state.goal?.type === 'target-score') {
    const target = state.goal.target
    updateProgressBar('player-progress', state.player.score, target)
    updateProgressBar('opponent-progress', state.opponent.score, target)
    setText('player-bar-score', formatScore(state.player.score, state))
    setText('opponent-bar-score', formatScore(state.opponent.score, state))
    if (scoreChanged) bumpScore('player-bar-score')
  } else {
    setText('player-score', formatScore(state.player.score, state))
    setText('opponent-score', formatScore(state.opponent.score, state))
    if (scoreChanged) bumpScore('player-score')
  }

  if (state.mode === 'idler') {
    setText('wood-balance', String(Math.floor(state.player.resources.wood)))
    setText('ale-balance', String(Math.floor(state.player.resources.ale)))

    // Update highlight state on currency cards
    const highlight = (state.player.meta.highlight as string | undefined) ?? 'wood'
    const woodCard = document.getElementById('card-wood')
    const aleCard = document.getElementById('card-ale')
    if (woodCard) woodCard.classList.toggle('highlighted', highlight === 'wood')
    if (aleCard) aleCard.classList.toggle('highlighted', highlight === 'ale')

    const container = document.getElementById('upgrades')
    if (container) container.innerHTML = renderIdlerUpgrades(state)
    bindUpgradeEvents()
  } else {
    setText('currency', String(Math.floor(state.player.resources.currency)))
    const container = document.getElementById('upgrades')
    if (container) container.innerHTML = renderClickerUpgrades(state)
    bindUpgradeEvents()
  }
}

// ─── Event Binding ───────────────────────────────────────────────────

function bindPlayingEvents(clickEnabled: boolean): void {
  if (clickEnabled) {
    document.getElementById('click-btn')!.addEventListener('click', () => {
      // Skip if we already processed this input via the keyboard hotkey handler
      if (handledByHotkey) return
      doClick()
    })
  }
  document.getElementById('quit-btn')!.addEventListener('click', quitMatch)
  bindUpgradeEvents()
}

function bindIdlerEvents(): void {
  document.getElementById('card-wood')!.addEventListener('click', () => {
    setHighlight('wood')
  })
  document.getElementById('card-ale')!.addEventListener('click', () => {
    setHighlight('ale')
  })
  bindUpgradeEvents()
}
