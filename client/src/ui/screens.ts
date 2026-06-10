import type { GameMode } from '@game/shared'
import { getModeDefinition, AVAILABLE_MODES } from '@game/shared'
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
    ? renderCreatorSettings(roomSettings.mode, roomSettings.goal.type)
    : renderJoinerSettings(roomSettings.mode, roomSettings.goal.type)
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
      ? renderCreatorSettings(state.roomSettings.mode, state.roomSettings.goal.type)
      : renderJoinerSettings(state.roomSettings.mode, state.roomSettings.goal.type)
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

function renderCreatorSettings(mode: GameMode, goalType: string): string {
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
          return `<button class="mode-chip${selected}" data-mode="${m}">${escapeAttr(def.flavor.displayName)}</button>`
        }).join('')}</div>
      </div>`
      : ''

  const goalChips = modeDef.goals
    .map((g) => {
      const selected = g.type === goalType ? ' selected' : ''
      return `<button class="goal-chip${selected}" data-goal-type="${g.type}">${escapeAttr(g.label)}</button>`
    })
    .join('')

  return `
    <div class="room-settings" id="room-settings">${modeRow}
      <div class="setting-row">
        <span class="setting-label">Goal</span>
        <div class="goal-chips" id="goal-chips">${goalChips}</div>
      </div>
    </div>
  `
}

function renderJoinerSettings(mode: GameMode, goalType: string): string {
  const modeDef = getModeDefinition(mode)
  const goal = modeDef.goals.find((g) => g.type === goalType)
  const goalLabel = goal?.label ?? goalType
  return `
    <div class="room-settings" id="room-settings">
      <div class="setting-row">
        <span class="setting-label">Mode</span>
        <span class="setting-value">${escapeAttr(modeDef.flavor.displayName)}</span>
      </div>
      <div class="setting-row">
        <span class="setting-label">Goal</span>
        <span class="setting-value">${escapeAttr(goalLabel)}</span>
      </div>
    </div>
  `
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
}

function hasShareApi(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function'
}
