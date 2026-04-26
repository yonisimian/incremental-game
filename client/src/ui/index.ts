import type { ConnectionState } from '../network.js'
import type { GameState, Screen } from '../game.js'
import { getState } from '../game.js'
import { app } from './helpers.js'
import { renderLobbyScreen } from './lobby.js'
import {
  renderWakingScreen,
  renderWaitingScreen,
  renderCountdownScreen,
  updateCountdown,
} from './screens.js'
import { renderPlayingScreen, updatePlaying } from './playing.js'
import { renderEndScreen } from './end.js'
import { initHotkeys } from './hotkeys.js'
import { initPanels } from './panels/init.js'

// ─── State ───────────────────────────────────────────────────────────

let currentScreen: Screen | 'waking' | null = null
let connectionState: ConnectionState = 'disconnected'

// ─── Public API ──────────────────────────────────────────────────────

/** Called whenever the game state changes. */
export function render(state: Readonly<GameState>): void {
  // The connection overlay takes priority during waking/connecting
  if (connectionState === 'waking' || connectionState === 'connecting') {
    if (currentScreen !== 'waking') {
      currentScreen = 'waking'
      renderWakingScreen()
    }
    return
  }

  if (state.screen !== currentScreen) {
    currentScreen = state.screen
    switch (state.screen) {
      case 'lobby':
        renderLobbyScreen()
        break
      case 'waiting':
        renderWaitingScreen()
        break
      case 'countdown':
        renderCountdownScreen(state)
        break
      case 'playing':
        renderPlayingScreen(state)
        break
      case 'ended':
        renderEndScreen(state)
        break
    }
  } else {
    // Update existing screen in-place
    switch (state.screen) {
      case 'countdown':
        updateCountdown(state)
        break
      case 'playing':
        updatePlaying(state)
        break
    }
  }
}

/** Called when the connection state changes. */
export function handleConnectionChange(state: ConnectionState): void {
  connectionState = state

  if (state === 'waking' || state === 'connecting') {
    if (currentScreen !== 'waking') {
      currentScreen = 'waking'
      renderWakingScreen()
    }
  } else if (state === 'connected') {
    // Re-render current game state
    currentScreen = null // force re-render
    render(getState())
  } else {
    // disconnected — show overlay when in an active session
    const gs = getState()
    if (gs.screen === 'playing' || gs.screen === 'countdown' || gs.screen === 'waiting') {
      app.innerHTML = `
        <div class="screen disconnected-screen">
          <h1>Disconnected</h1>
          <p>Reconnecting…</p>
        </div>
      `
      currentScreen = null
    }
  }
}

// ─── Init ────────────────────────────────────────────────────────────

initHotkeys()
initPanels()
