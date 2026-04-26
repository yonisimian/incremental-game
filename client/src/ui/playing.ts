import type { GameState } from '../game.js'
import { quitMatch } from '../game.js'
import { renderTimer, renderProgressBars } from './components.js'
import { app, setText, formatTime, formatScore, updateProgressBar } from './helpers.js'
import { bumpScore } from './vfx/index.js'
import {
  renderTabGrid,
  renderPanelContainer,
  renderActivePanel,
  updateActivePanel,
  bindTabEvents,
  resetTabs,
} from './panels.js'

// ─── Render ──────────────────────────────────────────────────────────

/** Shared scoreboard HTML for both modes. */
function renderScoreboard(state: Readonly<GameState>): string {
  if (state.goal?.type === 'target-score') return ''
  return `
    <div class="scoreboard">
      <div class="player-col you">
        <span class="label">You</span>
        <span class="score" id="player-score">${formatScore(state.player.score, state)}</span>
      </div>
      <div class="vs">vs</div>
      <div class="player-col opponent">
        <span class="label">Opponent</span>
        <span class="score" id="opponent-score">${formatScore(state.opponent.score, state)}</span>
      </div>
    </div>
  `
}

export function renderPlayingScreen(state: Readonly<GameState>): void {
  prevPlayerScore = 0
  resetTabs()

  app.innerHTML = `
    <div class="screen playing-screen">
      <div class="playing-top">
        <header class="game-header">
          <button class="quit-btn" id="quit-btn">← Quit</button>
          ${renderTimer(state)}
          ${renderProgressBars(state)}
        </header>
        ${renderScoreboard(state)}
      </div>

      ${renderTabGrid()}
      ${renderPanelContainer()}
    </div>
  `

  document.getElementById('quit-btn')!.addEventListener('click', quitMatch)
  bindTabEvents()
  renderActivePanel(state)
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

  // Delegate panel-specific updates to the active panel
  updateActivePanel(state)
}
