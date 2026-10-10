import type { GameMode, Goal, GoalChoice } from '@game/shared'
import {
  getModeDefinition,
  getModeFlavor,
  getAvailableModes,
  isAvailableMode,
  customizeGoal,
  RANDOM_GOAL,
  MIN_TARGET_SCORE,
  MAX_TARGET_SCORE,
  MIN_ROUND_DURATION_SEC,
  MAX_ROUND_DURATION_SEC,
} from '@game/shared'
import type { GameState } from '../game.js'
import { cancelQueue, quitMatch, requestBot, startRoomMatch, updateRoomSettings } from '../game.js'
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

// Signature of the last-rendered room-settings block. Lets updateRoomScreen
// skip re-rendering when nothing in the settings changed — important because
// the creator's goal-tuning input is focusable: an unrelated update (e.g. an
// opponent joining) must not blow away an in-progress edit and steal focus.
let lastSettingsSig: string | null = null

/** Identifies everything the settings block renders from (role + mode + goal). */
function settingsSignature(isCreator: boolean, mode: GameMode, goal: GoalChoice): string {
  const tunable =
    goal.type === 'target-score' ? goal.target : goal.type === 'timed' ? goal.durationSec : ''
  return `${isCreator ? 'c' : 'j'}|${mode}|${goal.type}|${tunable}`
}

export function renderRoomScreen(state: Readonly<GameState>): void {
  const { roomCode, roomSettings, roomPlayers, isRoomCreator } = state
  if (!roomCode || !roomSettings) return

  lastSettingsSig = settingsSignature(isRoomCreator, roomSettings.mode, roomSettings.goal)
  const shareUrl = `${location.origin}${location.pathname}?room=${roomCode}`
  const playerSlots = renderPlayerSlots(roomPlayers)
  const settingsHtml = isRoomCreator
    ? renderCreatorSettings(roomSettings.mode, roomSettings.goal)
    : renderJoinerSettings(roomSettings.mode, roomSettings.goal)
  const actionsSig = roomActionsSignature(isRoomCreator, roomPlayers.length)

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
      <div class="room-actions" id="room-actions" data-sig="${actionsSig}">${renderRoomActions(isRoomCreator, roomPlayers.length)}</div>
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

  wireRoomActions()
}

export function updateRoomScreen(state: Readonly<GameState>): void {
  // Re-render the player slots and settings in-place
  const playersEl = document.getElementById('room-players')
  if (playersEl) {
    playersEl.innerHTML = renderPlayerSlots(state.roomPlayers)
  }

  // Settings section: re-render only when its inputs would actually differ.
  // Skipping no-op renders preserves an in-progress goal-tuning edit (and its
  // focus) when an unrelated update — like an opponent joining — arrives.
  const settingsEl = document.getElementById('room-settings')
  if (settingsEl && state.roomSettings) {
    const sig = settingsSignature(
      state.isRoomCreator,
      state.roomSettings.mode,
      state.roomSettings.goal,
    )
    if (sig !== lastSettingsSig) {
      lastSettingsSig = sig
      const newSettingsHtml = state.isRoomCreator
        ? renderCreatorSettings(state.roomSettings.mode, state.roomSettings.goal)
        : renderJoinerSettings(state.roomSettings.mode, state.roomSettings.goal)
      settingsEl.outerHTML = newSettingsHtml
      if (state.isRoomCreator) {
        wireCreatorSettings(state.roomSettings.mode)
      }
    }
  }

  // Call to action: swap it only when the role or head count changed.
  const actionsEl = document.getElementById('room-actions')
  if (actionsEl) {
    const sig = roomActionsSignature(state.isRoomCreator, state.roomPlayers.length)
    if (actionsEl.dataset.sig !== sig) {
      actionsEl.dataset.sig = sig
      actionsEl.innerHTML = renderRoomActions(state.isRoomCreator, state.roomPlayers.length)
      wireRoomActions()
    }
  }
}

/** Identifies everything the room's call-to-action block renders from. */
function roomActionsSignature(isCreator: boolean, playerCount: number): string {
  return `${isCreator ? 'c' : 'j'}|${playerCount}`
}

/**
 * The room's call to action: alone, the creator can summon a bot; once the
 * second player is in, the creator starts the match and the joiner waits.
 */
function renderRoomActions(isCreator: boolean, playerCount: number): string {
  if (playerCount < 2) return isCreator ? botButtonHtml('room-bot-btn') : ''
  if (isCreator) return '<button class="start-btn" id="room-start-btn">▶ Start game</button>'
  return '<p class="status-text" id="room-waiting">Waiting for the host to start…</p>'
}

function wireRoomActions(): void {
  document.getElementById('room-bot-btn')?.addEventListener('click', requestBot)
  document.getElementById('room-start-btn')?.addEventListener('click', startRoomMatch)
}

// ─── Room Helpers ────────────────────────────────────────────────────

/**
 * The two seats. The host always sits first (the server lists the creator
 * first, and promotion keeps it that way). A seated player with no name shows
 * a role label instead, so an empty name never reads as an empty seat.
 */
function renderPlayerSlots(players: string[]): string {
  const host = players[0] ?? ''
  const guest = players.length > 1 ? (players[1] ?? '') : null
  const guestLabel = guest === null ? 'Waiting…' : guest ? escapeAttr(guest) : 'Guest'
  return `
    <div class="player-slot filled">${host ? escapeAttr(host) : 'Host'}</div>
    <div class="player-slot-vs">vs</div>
    <div class="player-slot ${guest === null ? 'empty' : 'filled'}">${guestLabel}</div>
  `
}

function renderCreatorSettings(mode: GameMode, goal: GoalChoice): string {
  const modeDef = getModeDefinition(mode)
  const modes = getAvailableModes()
  // Hide the mode picker entirely when there's only one mode to choose from.
  const modeRow =
    modes.length > 1
      ? `
      <div class="setting-row">
        <span class="setting-label">Mode</span>
        <div class="mode-chips" id="mode-chips">${modes
          .map((m) => {
            const def = getModeDefinition(m)
            const selected = m === mode ? ' selected' : ''
            return `<button class="mode-chip${selected}" data-mode="${m}">${escapeAttr(getModeFlavor(def).displayName)}</button>`
          })
          .join('')}</div>
      </div>`
      : ''

  // "Random" only means something when there is more than one goal to roll.
  const goalChoices: readonly GoalChoice[] =
    modeDef.goals.length > 1 ? [...modeDef.goals, RANDOM_GOAL] : modeDef.goals
  const goalChips = goalChoices
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

/**
 * Editable numeric input for the selected goal's tunable value (creator only).
 * The random pick has nothing to tune; it says when the roll happens instead.
 */
function renderGoalTuningRow(goal: GoalChoice): string {
  if (goal.type === 'random') {
    return `
      <div class="setting-row">
        <span class="setting-label">Rolled</span>
        <span class="setting-value">When the match starts</span>
      </div>`
  }
  if (goal.type === 'target-score') {
    return `
      <div class="setting-row">
        <span class="setting-label">Target score</span>
        <input
          class="setting-input"
          id="goal-target-input"
          type="number"
          aria-label="Target score"
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
          aria-label="Time in seconds"
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

function renderJoinerSettings(mode: GameMode, goal: GoalChoice): string {
  const modeDef = getModeDefinition(mode)
  const predefined =
    goal.type === 'random' ? RANDOM_GOAL : modeDef.goals.find((g) => g.type === goal.type)
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
function goalDetail(goal: GoalChoice): string {
  if (goal.type === 'target-score') return `${goal.target} pts`
  if (goal.type === 'timed') return `${goal.durationSec}s`
  return ''
}

function wireCreatorSettings(currentMode: GameMode): void {
  // Mode chips
  document.querySelectorAll<HTMLButtonElement>('#mode-chips .mode-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const mode = chip.dataset.mode
      if (isAvailableMode(mode)) {
        updateRoomSettings({ mode })
      }
    })
  })

  // Goal chips
  document.querySelectorAll<HTMLButtonElement>('#goal-chips .goal-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const goalType = chip.dataset.goalType
      if (!goalType) return
      const goal =
        goalType === 'random'
          ? RANDOM_GOAL
          : getModeDefinition(currentMode).goals.find((g) => g.type === goalType)
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
