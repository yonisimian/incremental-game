import type { GameState } from '../game.js'
import { quitMatch, togglePause } from '../game.js'
import {
  collectModifiers,
  computePassiveRates,
  getModeDefinition,
  getModeFlavor,
} from '@game/shared'
import type { ModeDefinition, ModeFlavor } from '@game/shared'
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
import { formatNumber } from './format-number.js'
import { bumpScore } from './vfx/index.js'
import {
  renderTabGrid,
  renderPanelContainer,
  renderActivePanel,
  updateActivePanel,
  bindTabEvents,
  configurePanels,
  refreshTabLocks,
} from './panels.js'
import { getModeUI, type ModeUI } from './mode-ui.js'

// ─── Render ──────────────────────────────────────────────────────────

// Module-level cache — set in renderPlayingScreen, read in updatePlaying.
// Safe to leave stale: updatePlaying is only called while screen === 'playing',
// and renderPlayingScreen always re-assigns before the first updatePlaying call.
// Flavor objects are static constants, so stale refs don't leak allocations.
let activeModeUI: ModeUI | null = null
let activeFlavor: ModeFlavor | null = null
let activeModeDef: ModeDefinition | null = null

/** Idle production per resource — includes highlight, excludes click income. */
function passiveRates(state: Readonly<GameState>): Record<string, number> {
  if (!activeModeDef) return {}
  return computePassiveRates(collectModifiers(state.player, activeModeDef), activeModeDef.resources)
}

/** Format an idle production rate for the header (e.g. "+2/s", "+0.5/s"). */
function formatRate(rate: number): string {
  const decimals = Number.isInteger(rate) ? 0 : 1
  return `+${formatNumber(rate, decimals)}/s`
}

/** Resource bar shown in the header, visible across all tabs. */
function renderResourceBar(state: Readonly<GameState>): string {
  if (!activeFlavor || activeFlavor.resources.length === 0) return ''
  const rates = passiveRates(state)
  return `
    <div class="resource-bar" id="resource-bar">
      ${activeFlavor.resources
        .map((r) => {
          const cls = `resource-item${r.className ? ` ${r.className}` : ''}`
          return `<span class="${cls}">
            <span class="resource-amount">${r.icon} <span id="header-${r.key}">${formatNumber(state.player.resources[r.key])}</span></span>
            <span class="resource-rate" id="rate-${r.key}">${formatRate(rates[r.key] ?? 0)}</span>
          </span>`
        })
        .join('')}
    </div>
  `
}

/**
 * Pause/resume button — only rendered in bot matches, where pausing is allowed.
 * The icon doubles as a play triangle while paused so the same control resumes.
 */
function renderPauseButton(state: Readonly<GameState>): string {
  if (!state.vsBot) return ''
  const label = state.paused ? 'Resume match' : 'Pause match'
  const icon = state.paused ? '▶' : '⏸'
  return `<button class="pause-btn" id="pause-btn" aria-label="${label}" title="${label}">${icon}</button>`
}

/**
 * Whether the head-to-head scoreboard applies to this goal. 'target-score' uses
 * progress bars instead, and 'buy-upgrade' (Race to Buy) is won by buying the
 * goal upgrade, not by score — neither shows a score race.
 */
function showsScoreboard(goal: GameState['goal']): boolean {
  return goal?.type !== 'target-score' && goal?.type !== 'buy-upgrade'
}

/** Shared scoreboard HTML for both modes. */
function renderScoreboard(state: Readonly<GameState>): string {
  if (!showsScoreboard(state.goal)) return ''
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
  activeModeDef = modeDef
  activeFlavor = modeDef ? getModeFlavor(modeDef) : null
  configurePanels(activeModeUI?.panels ?? [])

  const themeClass = activeFlavor?.themeClass ?? ''

  app.innerHTML = `
    <div class="screen playing-screen ${themeClass}">
      <div class="playing-top">
        <header class="game-header">
          <button class="quit-btn" id="quit-btn">← Quit</button>
          ${renderPauseButton(state)}
          ${renderTimer(state)}
          ${renderProgressBars(state)}
        </header>
        ${renderScoreboard(state)}
        ${renderResourceBar(state)}
        <div class="paused-banner" id="pause-banner"${state.paused ? '' : ' hidden'}>PAUSED</div>
      </div>

      ${renderTabGrid(state)}
      ${renderPanelContainer()}
    </div>
  `

  document.getElementById('quit-btn')!.addEventListener('click', quitMatch)
  document.getElementById('pause-btn')?.addEventListener('click', togglePause)
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
  } else if (showsScoreboard(state.goal)) {
    setText('player-score', formatScore(state.player.score, state))
    setText('opponent-score', formatScore(state.opponent.score, state))
    if (scoreChanged) bumpScore('player-score')
  }

  // Update pause banner.
  const pauseBanner = document.getElementById('pause-banner')
  if (pauseBanner) {
    pauseBanner.hidden = !state.paused
    pauseBanner.textContent = state.paused ? 'PAUSED' : ''
  }

  // Update pause button icon/label to reflect the current state.
  const pauseBtn = document.getElementById('pause-btn')
  if (pauseBtn) {
    const label = state.paused ? 'Resume match' : 'Pause match'
    pauseBtn.textContent = state.paused ? '▶' : '⏸'
    pauseBtn.setAttribute('aria-label', label)
    pauseBtn.setAttribute('title', label)
  }

  // Update resource bar (visible across all tabs)
  if (activeFlavor) {
    const rates = passiveRates(state)
    for (const r of activeFlavor.resources) {
      setText(`header-${r.key}`, formatNumber(state.player.resources[r.key]))
      setText(`rate-${r.key}`, formatRate(rates[r.key] ?? 0))
    }
  }

  // Reflect any tab that unlocked this frame (e.g. generators panel upgrade).
  refreshTabLocks(state)

  // Delegate panel-specific updates to the active panel
  updateActivePanel(state)
}
