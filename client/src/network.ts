import type {
  ActionBatchMessage,
  GameMode,
  Goal,
  ModeSelectMessage,
  PlayerAction,
  ServerMessage,
} from '@game/shared'

// ─── Types ───────────────────────────────────────────────────────────

export type ServerMessageHandler = (msg: ServerMessage) => void
export type ConnectionStateHandler = (state: ConnectionState) => void
export type ConnectionState =
  | 'waking' // HTTP health check in progress (cold-start)
  | 'connecting' // WebSocket handshake in progress
  | 'connected' // WebSocket open
  | 'disconnected' // closed / failed

// ─── Constants ───────────────────────────────────────────────────────

const BATCH_INTERVAL_MS = 100
const INITIAL_BACKOFF_MS = 1000
const MAX_BACKOFF_MS = 60_000
const HEALTH_COLD_START_MS = 2000

// ─── State ───────────────────────────────────────────────────────────

let ws: WebSocket | null = null
let seq = 0
let pendingActions: PlayerAction[] = []
let batchTimer: ReturnType<typeof setInterval> | null = null
let backoff = INITIAL_BACKOFF_MS
let intentionalClose = false

let onMessage: ServerMessageHandler = () => {}
let onConnectionState: ConnectionStateHandler = () => {}

// ─── Public API ──────────────────────────────────────────────────────

/** Set the handler for incoming server messages. */
export function setMessageHandler(handler: ServerMessageHandler): void {
  onMessage = handler
}

/** Set the handler for connection state changes. */
export function setConnectionStateHandler(handler: ConnectionStateHandler): void {
  onConnectionState = handler
}

/**
 * Connect to the game server.
 * Performs a health check first to detect cold-start,
 * then opens a WebSocket.
 */
export async function connect(): Promise<void> {
  intentionalClose = false
  const wsUrl = import.meta.env.VITE_WS_URL as string
  const httpUrl = wsUrl.replace(/^ws:/, 'http:').replace(/^wss:/, 'https:').replace(/\/ws$/, '/')

  // Health check — detect cold start
  onConnectionState('waking')
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => {
      controller.abort()
    }, HEALTH_COLD_START_MS)
    const res = await fetch(httpUrl, { signal: controller.signal })
    clearTimeout(timeout)
    if (!res.ok) throw new Error('unhealthy')
  } catch {
    // Server is waking — retry after backoff
    scheduleReconnect()
    return
  }

  openWebSocket(wsUrl)
}

/** Disconnect and stop reconnecting. */
export function disconnect(): void {
  intentionalClose = true
  stopBatching()
  if (ws) {
    ws.close()
    ws = null
  }
}

/** Queue a player action to be sent in the next batch. */
export function queueAction(action: PlayerAction): void {
  pendingActions.push(action)
}

/** Send a mode + goal selection message to the server (enters matchmaking). Returns false if not connected. */
export function sendModeSelect(mode: GameMode, goal: Goal, name: string): boolean {
  if (ws?.readyState !== WebSocket.OPEN) return false
  const msg: ModeSelectMessage = { type: 'MODE_SELECT', mode, goal, name }
  ws.send(JSON.stringify(msg))
  return true
}

/** Send a quit message to voluntarily leave the current match. */
export function sendQuit(): void {
  if (ws?.readyState !== WebSocket.OPEN) return
  ws.send(JSON.stringify({ type: 'QUIT' }))
}

/** Send a bot request message (while in queue). */
export function sendBotRequest(): void {
  if (ws?.readyState !== WebSocket.OPEN) return
  ws.send(JSON.stringify({ type: 'BOT_REQUEST' }))
}

/** Get the current sequence number (for optimistic reconciliation). */
export function getSeq(): number {
  return seq
}

/** Reset sequence counter (call when starting a new match). */
export function resetSeq(): void {
  seq = 0
  pendingActions = []
}

// ─── Private ─────────────────────────────────────────────────────────

function openWebSocket(url: string): void {
  onConnectionState('connecting')
  ws = new WebSocket(url)

  ws.addEventListener('open', () => {
    backoff = INITIAL_BACKOFF_MS
    onConnectionState('connected')
    startBatching()
  })

  ws.addEventListener('message', (event) => {
    try {
      const msg = JSON.parse(event.data as string) as ServerMessage
      onMessage(msg)
    } catch {
      // malformed message — ignore
    }
  })

  ws.addEventListener('close', () => {
    ws = null
    stopBatching()
    onConnectionState('disconnected')
    if (!intentionalClose) scheduleReconnect()
  })

  ws.addEventListener('error', () => {
    // 'close' will fire after 'error' — reconnect handled there
  })
}

function scheduleReconnect(): void {
  const delay = backoff + Math.random() * 500
  backoff = Math.min(backoff * 2, MAX_BACKOFF_MS)
  setTimeout(() => {
    if (!intentionalClose) void connect()
  }, delay)
}

function startBatching(): void {
  if (batchTimer) return
  batchTimer = setInterval(flushBatch, BATCH_INTERVAL_MS)
}

function stopBatching(): void {
  if (batchTimer) {
    clearInterval(batchTimer)
    batchTimer = null
  }
}

function flushBatch(): void {
  if (pendingActions.length === 0) return
  if (ws?.readyState !== WebSocket.OPEN) return

  seq++
  const msg: ActionBatchMessage = {
    type: 'ACTION_BATCH',
    seq,
    actions: pendingActions.splice(0),
  }
  ws.send(JSON.stringify(msg))
}
