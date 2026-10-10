import type { GameState } from '../game.js'
import { externalModifiers, resignMatch, togglePause } from '../game.js'
import {
  collectModifiers,
  computePassiveRates,
  getModeDefinition,
  getModeFlavor,
} from '@game/shared'
import type { ModeDefinition, ModeFlavor } from '@game/shared'
import {
  renderTimer,
  renderProgressBars,
  renderResignButton,
  syncResignButton,
  renderPauseButton,
  syncPauseButton,
} from './components.js'
import { app, setText, formatScore, playerDisplayName, opponentDisplayName } from './helpers.js'
import { formatNumber } from './format-number.js'
import { bumpScore } from './vfx/index.js'
import { counterAttr, paintCounters, syncCounters } from './counters.js'
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
  // Merge in the debuffs the opponent's passive attacks inflict and the pact
  // bonuses in force (both sent by the server) so the header shows the true
  // rate — matching the income the server actually applies. The client can't
  // derive these itself (it never sees the opponent's state), but it does
  // resolve them, since they arrive unresolved and a highlight-factor entry has
  // to land on the resource we're holding right now.
  return computePassiveRates(
    [
      ...collectModifiers(state.player, activeModeDef),
      ...externalModifiers(state.player, activeModeDef),
    ],
    activeModeDef.resources,
  )
}

/** Format an idle production rate for the header (e.g. "+2/s", "+0.5/s", "-1/s"). */
function formatRate(rate: number): string {
  const decimals = Number.isInteger(rate) ? 0 : 1
  // A debuff can push a rate negative; format the magnitude with an explicit
  // sign so we never render "+-2/s".
  const sign = rate < 0 ? '-' : '+'
  return `${sign}${formatNumber(Math.abs(rate), decimals)}/s`
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
            <span class="resource-amount">${r.icon} <span id="header-${r.key}"${counterAttr('own', r.key)}>${formatNumber(state.player.resources[r.key])}</span></span>
            <span class="resource-rate" id="rate-${r.key}">${formatRate(rates[r.key] ?? 0)}</span>
          </span>`
        })
        .join('')}
    </div>
  `
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
        <span class="score" id="player-score"${counterAttr('own')}>${formatScore(state.player.score, state)}</span>
      </div>
      <div class="vs">vs</div>
      <div class="player-col opponent">
        <span class="label">${opponentDisplayName(state)}</span>
        <span class="score" id="opponent-score"${counterAttr('theirs')}>${formatScore(state.opponent.score ?? 0, state)}</span>
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
          ${renderResignButton(state)}
          ${renderPauseButton(state)}
          ${renderTimer(state)}
          ${renderProgressBars(state)}
        </header>
        ${renderScoreboard(state)}
        ${renderResourceBar(state)}
        <div class="paused-banner" id="pause-banner"${state.paused ? '' : ' hidden'}>PAUSED</div>
      </div>

      ${renderTabGrid(state)}
      <div class="panel-region">
        ${renderPanelContainer()}
        <div class="toast-layer" id="toast-layer" aria-hidden="true"></div>
        <div class="sr-only" id="toast-announcer" aria-live="polite"></div>
      </div>
    </div>
  `

  document.getElementById('resign-btn')!.addEventListener('click', resignMatch)
  document.getElementById('pause-btn')?.addEventListener('click', togglePause)
  bindTabEvents()
  renderActivePanel(state)
}

// ─── In-place Update ─────────────────────────────────────────────────

let prevPlayerScore = 0

export function updatePlaying(state: Readonly<GameState>): void {
  const scoreChanged = state.player.score !== prevPlayerScore
  prevPlayerScore = state.player.score

  if (state.goal?.type === 'target-score') {
    if (scoreChanged) bumpScore('player-bar-score')
  } else if (showsScoreboard(state.goal)) {
    if (scoreChanged) bumpScore('player-score')
  }

  // Update pause banner.
  const pauseBanner = document.getElementById('pause-banner')
  if (pauseBanner) {
    pauseBanner.hidden = !state.paused
    pauseBanner.textContent = state.paused ? 'PAUSED' : ''
  }

  syncResignButton(state)
  syncPauseButton(state)

  // Amounts, scores and the timer are painted by the counters; only the rates are written here.
  if (activeFlavor && activeModeDef) {
    const rates = passiveRates(state)
    for (const r of activeFlavor.resources) {
      setText(`rate-${r.key}`, formatRate(rates[r.key] ?? 0))
    }
    syncCounters(state, activeModeDef, rates)
  }

  // Reflect any tab that unlocked this frame (e.g. generators panel upgrade).
  refreshTabLocks(state)

  // Delegate panel-specific updates to the active panel
  updateActivePanel(state)

  // Last, so a panel that just re-rendered a counter shows the interpolated value.
  paintCounters()
}
