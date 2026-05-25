import { quickMatch, createRoom, joinRoom, getState, setPlayerName } from '../game.js'
import { app, escapeAttr } from './helpers.js'
import { openSettings } from './settings-modal.js'

export function renderLobbyScreen(): void {
  const { playerName, roomError } = getState()

  const errorHtml = roomError
    ? `<p class="lobby-error" id="lobby-error">${errorMessage(roomError)}</p>`
    : ''

  app.innerHTML = `
    <div class="screen lobby-screen">
      <button class="settings-gear" id="settings-btn" aria-label="Settings">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="3"/>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1.08 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1.08 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1.08z"/>
        </svg>
      </button>
      <h1>incremen<span class="brand-t">T</span>al</h1>
      <input
        class="name-input"
        id="name-input"
        type="text"
        placeholder="Enter your name"
        maxlength="16"
        autocomplete="off"
        value="${escapeAttr(playerName)}"
      />
      ${errorHtml}
      <div class="lobby-actions">
        <button class="lobby-btn primary" id="quick-match-btn">
          <span class="btn-icon">⚡</span>
          <span class="btn-label">Quick Match</span>
          <span class="btn-desc">Random mode &amp; goal — instant pairing</span>
        </button>
        <button class="lobby-btn" id="create-room-btn">
          <span class="btn-icon">🏠</span>
          <span class="btn-label">Create Room</span>
          <span class="btn-desc">Choose your settings, invite a friend</span>
        </button>
      </div>
      <div class="join-room-row">
        <input
          class="room-code-input"
          id="room-code-input"
          type="text"
          placeholder="Room code"
          maxlength="6"
          autocomplete="off"
        />
        <button class="lobby-btn small" id="join-room-btn">Join</button>
      </div>
    </div>
  `

  document.getElementById('name-input')?.addEventListener('input', (e) => {
    setPlayerName((e.target as HTMLInputElement).value)
  })

  document.getElementById('settings-btn')!.addEventListener('click', openSettings)

  document.getElementById('quick-match-btn')!.addEventListener('click', (e) => {
    ;(e.currentTarget as HTMLButtonElement).disabled = true
    quickMatch()
  })

  document.getElementById('create-room-btn')!.addEventListener('click', (e) => {
    ;(e.currentTarget as HTMLButtonElement).disabled = true
    createRoom()
  })

  const codeInput = document.getElementById('room-code-input') as HTMLInputElement
  const joinBtn = document.getElementById('join-room-btn')!

  // Auto-uppercase and filter to valid chars
  codeInput.addEventListener('input', () => {
    codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z2-9]/g, '')
  })

  joinBtn.addEventListener('click', () => {
    const code = codeInput.value.trim()
    if (code.length === 6) joinRoom(code)
  })

  // Allow Enter key to join
  codeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const code = codeInput.value.trim()
      if (code.length === 6) joinRoom(code)
    }
  })
}

function errorMessage(reason: string): string {
  switch (reason) {
    case 'full':
      return 'Room is full'
    case 'not_found':
      return 'Room not found — it may have expired'
    case 'already_in_room':
      return 'You are already in a room'
    case 'room_limit':
      return 'Server is busy — try again later'
    default:
      return 'Something went wrong'
  }
}
