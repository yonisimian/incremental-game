import { quickMatch, createRoom, joinRoom, getState, setPlayerName } from '../game.js'
import { app, escapeAttr } from './helpers.js'

export function renderLobbyScreen(): void {
  const { playerName, roomError } = getState()

  const errorHtml = roomError
    ? `<p class="lobby-error" id="lobby-error">${errorMessage(roomError)}</p>`
    : ''

  app.innerHTML = `
    <div class="screen lobby-screen">
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
