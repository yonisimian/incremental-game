import './style.css'
import { setMessageHandler, setConnectionStateHandler, connect, sendRoomJoin } from './network.js'
import {
  handleServerMessage,
  setStateChangeHandler,
  getState,
  setRoomJoinedCallback,
} from './game.js'
import { render, handleConnectionChange } from './ui/index.js'
import { initDevRecorder } from './dev-recorder.js'

// ─── URL room-code handling ──────────────────────────────────────────

let pendingRoomCode = new URLSearchParams(location.search).get('room')

/** Strip the ?room= param from the URL bar (once join succeeds or fails). */
function clearRoomParam(): void {
  if (!pendingRoomCode) return
  pendingRoomCode = null
  const url = new URL(location.href)
  url.searchParams.delete('room')
  history.replaceState(null, '', url.pathname + url.search)
}

// Wire modules together
setMessageHandler(handleServerMessage)
setStateChangeHandler(render)
setRoomJoinedCallback(clearRoomParam)
setConnectionStateHandler((connState) => {
  handleConnectionChange(connState)

  // Auto-join room when connected, if a ?room= param was present
  if (connState === 'connected' && pendingRoomCode) {
    // Defer to next microtask so the first render completes before the
    // server can respond with ROOM_JOINED / ROOM_ERROR.
    queueMicrotask(() => {
      if (!pendingRoomCode) return
      const name = getState().playerName
      sendRoomJoin(pendingRoomCode, name)
    })
  }
})

// Activate dev recorder if ?dev or localStorage flag is set
initDevRecorder()

// Go!
void connect()
