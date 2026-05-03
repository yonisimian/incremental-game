import type { GameState } from '../game.js'
import { quitMatch } from '../game.js'
import { getModeDefinition } from '@game/shared'
import type { ModeFlavor } from '@game/shared'
import { renderTimer, renderProgressBars } from './components.js'
import {
  app,
  setText,
  formatTime,
  formatScore,
  updateProgressBar,
  playerDisplayName,
  opponentDisplayName,
} from './helpers.js'
import { bumpScore } from './vfx/index.js'
import {
  renderTabGrid,
  renderPanelContainer,
  renderActivePanel,
  updateActivePanel,
  bindTabEvents,
  configurePanels,
} from './panels.js'
import { getModeUI, type ModeUI } from './mode-ui.js'

// ─── Render ──────────────────────────────────────────────────────────

// Module-level cache — set in renderPlayingScreen, read in updatePlaying.
// Safe to leave stale: updatePlaying is only called while screen === 'playing',
// and renderPlayingScreen always re-assigns before the first updatePlaying call.
// Flavor objects are static constants, so stale refs don't leak allocations.
let activeModeUI: ModeUI | null = null
let activeFlavor: ModeFlavor | null = null

/** Resource bar shown in the header, visible across all tabs. */
function renderResourceBar(state: Readonly<GameState>): string {
  if (!activeFlavor || activeFlavor.resources.length === 0) return ''
  return `
    <div class="resource-bar" id="resource-bar">
      ${activeFlavor.resources
        .map((r) => {
          const cls = `resource-item${r.className ? ` ${r.className}` : ''}`
          return `<span class="${cls}">${r.icon} <span id="header-${r.key}">${Math.floor(state.player.resources[r.key])}</span></span>`
        })
        .join('')}
    </div>
  `
}

/** Shared scoreboard HTML for both modes. */
function renderScoreboard(state: Readonly<GameState>): string {
  if (state.goal?.type === 'target-score') return ''
  return `
    <div class="scoreboard">
      <div class="player-col you">
        <span class="label">${playerDisplayName(state)}</span>
        <span class="score" id="player-score">${formatScore(state.player.score, state)}</span>
      </div>
      <div class="vs">vs</div>
      <div class="player-col opponent">
        <span class="label">${opponentDisplayName(state)}</span>
        <span class="score" id="opponent-score">${formatScore(state.opponent.score, state)}</span>
      </div>
    </div>
  `
}

export function renderPlayingScreen(state: Readonly<GameState>): void {
  prevPlayerScore = 0
  activeModeUI = state.mode ? getModeUI(state.mode) : null
  const modeDef = state.mode ? getModeDefinition(state.mode) : null
  activeFlavor = modeDef?.flavor ?? null
  configurePanels(activeModeUI?.panels ?? [])

  const themeClass = activeFlavor?.themeClass ?? ''

  app.innerHTML = `
    <div class="screen playing-screen ${themeClass}">
      <div class="playing-top">
        <header class="game-header">
          <button class="quit-btn" id="quit-btn">← Quit</button>
          ${renderTimer(state)}
          ${renderProgressBars(state)}
        </header>
        ${renderScoreboard(state)}
        ${renderResourceBar(state)}
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

  // Update resource bar (visible across all tabs)
  if (activeFlavor) {
    for (const r of activeFlavor.resources) {
      setText(`header-${r.key}`, String(Math.floor(state.player.resources[r.key])))
    }
  }

  // Delegate panel-specific updates to the active panel
  updateActivePanel(state)
}
