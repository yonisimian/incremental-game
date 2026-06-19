import type { GameMode, Goal } from '@game/shared'
import {
  getModeDefinition,
  getModeFlavor,
  AVAILABLE_MODES,
  customizeGoal,
  MIN_TARGET_SCORE,
  MAX_TARGET_SCORE,
  MIN_ROUND_DURATION_SEC,
  MAX_ROUND_DURATION_SEC,
} from '@game/shared'
import type { GameState } from '../game.js'
import { cancelQueue, quitMatch, requestBot, updateRoomSettings } from '../game.js'
import { connect } from '../network.js'
import { app, escapeAttr } from './helpers.js'

// ─── Shared Fragments ────────────────────────────────────────────────

function botButtonHtml(id: string): string {
  return `<button class="bot-btn" id="${id}">🤖 Play against a bot</button>`
}

export function renderWakingScreen(): void {
  app.innerHTML = `
    <div class="screen waking-screen">
      <h1>incremen<span class="brand-t">T</span>al</h1>
      <p class="status-text">Waking up server…</p>
      <div class="spinner"></div>
    </div>
  `
}

export function renderLoadingScreen(): void {
  app.innerHTML = `
    <div class="screen waking-screen">
      <h1>incremen<span class="brand-t">T</span>al</h1>
      <p class="status-text">Loading game…</p>
      <div class="spinner"></div>
    </div>
  `
}

export function renderLoadErrorScreen(): void {
  app.innerHTML = `
    <div class="screen waking-screen">
      <h1>incremen<span class="brand-t">T</span>al</h1>
      <p class="status-text">Couldn't load the game data.</p>
      <button class="bot-btn" id="retry-load-btn">Retry</button>
    </div>
  `

  document.getElementById('retry-load-btn')!.addEventListener('click', () => {
    void connect()
  })
}

export function renderWaitingScreen(): void {
  app.innerHTML = `
    <div class="screen waiting-screen">
      <button class="quit-btn" id="cancel-queue-btn">← Cancel</button>
      <h1>incremen<span class="brand-t">T</span>al</h1>
      <p class="status-text">Looking for opponent…</p>
      <div class="spinner"></div>
      ${botButtonHtml('bot-btn')}
    </div>
  `

  document.getElementById('cancel-queue-btn')!.addEventListener('click', cancelQueue)
  document.getElementById('bot-btn')!.addEventListener('click', requestBot)
}

export function renderCountdownScreen(state: Readonly<GameState>): void {
  app.innerHTML = `
    <div class="screen countdown-screen">
      <button class="quit-btn" id="quit-btn">← Quit</button>
      <div class="countdown-number" id="countdown">${state.countdown}</div>
    </div>
  `

  document.getElementById('quit-btn')!.addEventListener('click', quitMatch)
}

export function updateCountdown(state: Readonly<GameState>): void {
  const el = document.getElementById('countdown')
  if (el) {
    el.textContent = state.countdown <= 0 ? 'GO!' : String(state.countdown)
  }
}

// ─── Room Screen ─────────────────────────────────────────────────────

export function renderRoomScreen(state: Readonly<GameState>): void {
  const { roomCode, roomSettings, roomPlayers, isRoomCreator } = state
  if (!roomCode || !roomSettings) return

  const shareUrl = `${location.origin}${location.pathname}?room=${roomCode}`
  const playerSlots = renderPlayerSlots(roomPlayers)
  const settingsHtml = isRoomCreator
    ? renderCreatorSettings(roomSettings.mode, roomSettings.goal)
    : renderJoinerSettings(roomSettings.mode, roomSettings.goal)
  const botBtnHtml = isRoomCreator && roomPlayers.length < 2 ? botButtonHtml('room-bot-btn') : ''

  app.innerHTML = `
    <div class="screen room-screen">
      <button class="quit-btn" id="leave-room-btn">← Leave</button>
      <h1>incremen<span class="brand-t">T</span>al</h1>
      <div class="room-code-display">
        <span class="room-code-label">Room Code</span>
        <span class="room-code" id="room-code">${roomCode}</span>
        <button class="copy-btn" id="copy-link-btn" data-tooltip="Copy invite link">📋</button>
        ${hasShareApi() ? '<button class="share-btn" id="share-btn" data-tooltip="Share invite">📤</button>' : ''}
      </div>
      <div class="room-players" id="room-players">${playerSlots}</div>
      ${settingsHtml}
      ${botBtnHtml}
    </div>
  `

  // Event listeners
  document.getElementById('leave-room-btn')!.addEventListener('click', cancelQueue)

  document.getElementById('copy-link-btn')!.addEventListener('click', () => {
    void navigator.clipboard.writeText(shareUrl)
    const btn = document.getElementById('copy-link-btn')!
    btn.textContent = '✓'
    btn.style.color = '#4ade80'
    setTimeout(() => {
      btn.textContent = '📋'
      btn.style.color = ''
    }, 1500)
  })

  document.getElementById('share-btn')?.addEventListener('click', () => {
    void navigator.share({ title: 'Join my game!', url: shareUrl })
  })

  if (isRoomCreator) {
    wireCreatorSettings(roomSettings.mode)
  }

  document.getElementById('room-bot-btn')?.addEventListener('click', requestBot)
}

export function updateRoomScreen(state: Readonly<GameState>): void {
  // Re-render the player slots and settings in-place
  const playersEl = document.getElementById('room-players')
  if (playersEl) {
    playersEl.innerHTML = renderPlayerSlots(state.roomPlayers)
  }

  // Settings section needs full re-render (mode/goal may have changed)
  const settingsEl = document.getElementById('room-settings')
  if (settingsEl && state.roomSettings) {
    const newSettingsHtml = state.isRoomCreator
      ? renderCreatorSettings(state.roomSettings.mode, state.roomSettings.goal)
      : renderJoinerSettings(state.roomSettings.mode, state.roomSettings.goal)
    settingsEl.outerHTML = newSettingsHtml
    if (state.isRoomCreator) {
      wireCreatorSettings(state.roomSettings.mode)
    }
  }

  // Show/hide bot button
  const botBtn = document.getElementById('room-bot-btn')
  if (botBtn) {
    botBtn.style.display = state.isRoomCreator && state.roomPlayers.length < 2 ? '' : 'none'
  }
}

// ─── Room Helpers ────────────────────────────────────────────────────

function renderPlayerSlots(players: string[]): string {
  const p1 = players[0] ?? null
  const p2 = players[1] ?? null
  return `
    <div class="player-slot filled">${p1 ? escapeAttr(p1) : 'You'}</div>
    <div class="player-slot-vs">vs</div>
    <div class="player-slot ${p2 ? 'filled' : 'empty'}">${p2 ? escapeAttr(p2) : 'Waiting…'}</div>
  `
}

function renderCreatorSettings(mode: GameMode, goal: Goal): string {
  const modeDef = getModeDefinition(mode)
  // Hide the mode picker entirely when there's only one mode to choose from (D10).
  const modeRow =
    AVAILABLE_MODES.length > 1
      ? `
      <div class="setting-row">
        <span class="setting-label">Mode</span>
        <div class="mode-chips" id="mode-chips">${AVAILABLE_MODES.map((m) => {
          const def = getModeDefinition(m)
          // Always true while only one mode exists; kept for when AVAILABLE_MODES grows.
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
          const selected = m === mode ? ' selected' : ''
          return `<button class="mode-chip${selected}" data-mode="${m}">${escapeAttr(getModeFlavor(def).displayName)}</button>`
        }).join('')}</div>
      </div>`
      : ''

  const goalChips = modeDef.goals
    .map((g) => {
      const selected = g.type === goal.type ? ' selected' : ''
      return `<button class="goal-chip${selected}" data-goal-type="${g.type}">${escapeAttr(g.label)}</button>`
    })
    .join('')

  return `
    <div class="room-settings" id="room-settings">${modeRow}
      <div class="setting-row">
        <span class="setting-label">Goal</span>
        <div class="goal-chips" id="goal-chips">${goalChips}</div>
      </div>
      ${renderGoalTuningRow(goal)}
    </div>
  `
}

/** Editable numeric input for the selected goal's tunable value (creator only). */
function renderGoalTuningRow(goal: Goal): string {
  if (goal.type === 'target-score') {
    return `
      <div class="setting-row">
        <span class="setting-label">Target score</span>
        <input
          class="setting-input"
          id="goal-target-input"
          type="number"
          inputmode="numeric"
          min="${MIN_TARGET_SCORE}"
          max="${MAX_TARGET_SCORE}"
          step="1"
          value="${goal.target}"
        />
      </div>`
  }
  if (goal.type === 'timed') {
    return `
      <div class="setting-row">
        <span class="setting-label">Time (seconds)</span>
        <input
          class="setting-input"
          id="goal-duration-input"
          type="number"
          inputmode="numeric"
          min="${MIN_ROUND_DURATION_SEC}"
          max="${MAX_ROUND_DURATION_SEC}"
          step="1"
          value="${goal.durationSec}"
        />
      </div>`
  }
  return ''
}

function renderJoinerSettings(mode: GameMode, goal: Goal): string {
  const modeDef = getModeDefinition(mode)
  const predefined = modeDef.goals.find((g) => g.type === goal.type)
  const goalLabel = predefined?.label ?? goal.type
  const detail = goalDetail(goal)
  return `
    <div class="room-settings" id="room-settings">
      <div class="setting-row">
        <span class="setting-label">Mode</span>
        <span class="setting-value">${escapeAttr(getModeFlavor(modeDef).displayName)}</span>
      </div>
      <div class="setting-row">
        <span class="setting-label">Goal</span>
        <span class="setting-value">${escapeAttr(goalLabel)}${detail ? ` · ${escapeAttr(detail)}` : ''}</span>
      </div>
    </div>
  `
}

/** Human-readable summary of a goal's tunable value, or '' if none. */
function goalDetail(goal: Goal): string {
  if (goal.type === 'target-score') return `${goal.target} pts`
  if (goal.type === 'timed') return `${goal.durationSec}s`
  return ''
}

function wireCreatorSettings(currentMode: GameMode): void {
  // Mode chips
  document.querySelectorAll<HTMLButtonElement>('#mode-chips .mode-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const mode = chip.dataset.mode as GameMode | undefined
      if (mode && AVAILABLE_MODES.includes(mode)) {
        updateRoomSettings({ mode })
      }
    })
  })

  // Goal chips
  document.querySelectorAll<HTMLButtonElement>('#goal-chips .goal-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const goalType = chip.dataset.goalType
      if (!goalType) return
      const modeDef = getModeDefinition(currentMode)
      const goal = modeDef.goals.find((g) => g.type === goalType)
      if (goal) updateRoomSettings({ goal })
    })
  })

  // Goal tuning inputs (target score / duration). Commit on change/blur so the
  // value is sent once the creator finishes editing rather than per keystroke.
  wireGoalTuningInput('goal-target-input', currentMode, 'target-score', (g, value) => ({
    ...g,
    target: value,
  }))
  wireGoalTuningInput('goal-duration-input', currentMode, 'timed', (g, value) => ({
    ...g,
    durationSec: value,
  }))
}

/**
 * Wire a numeric goal-tuning input: on commit, rebuild the goal from the mode's
 * predefined definition with the edited value, clamp it via the shared helper,
 * and push the update. Clamping keeps the optimistic local value in sync with
 * what the authoritative server will broadcast back.
 */
function wireGoalTuningInput(
  inputId: string,
  currentMode: GameMode,
  goalType: Goal['type'],
  withValue: (goal: Goal, value: number) => Goal,
): void {
  const input = document.getElementById(inputId) as HTMLInputElement | null
  if (!input) return
  const commit = (): void => {
    const modeDef = getModeDefinition(currentMode)
    const base = modeDef.goals.find((g) => g.type === goalType)
    if (!base) return
    const parsed = Number(input.value)
    if (!Number.isFinite(parsed)) return
    const goal = customizeGoal(base, withValue(base, parsed))
    updateRoomSettings({ goal })
  }
  input.addEventListener('change', commit)
}

function hasShareApi(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function'
}
