import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import WebSocket, { WebSocketServer } from 'ws'
import {
  HEARTBEAT_INTERVAL_MS,
  getAvailableUpgrades,
  getModeDefinition,
  getDefaultGoal,
} from '@game/shared'
import type { ClientMessage, GameMode, Goal } from '@game/shared'
import { addToQueue, removeFromQueue } from './matchmaking.js'
import { Match } from './match.js'
import { createBot } from './bot.js'

const PORT = Number(process.env.PORT) || 10000

// ─── HTTP Server (health check) ─────────────────────────────────────

const httpServer = createServer((_req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/plain',
    'Access-Control-Allow-Origin': '*',
  })
  res.end('ok')
})

// ─── WebSocket Server ────────────────────────────────────────────────

const wss = new WebSocketServer({ server: httpServer, path: '/ws' })

/** Per-connection metadata. */
interface PlayerData {
  id: string
  isAlive: boolean
}

const wsData = new Map<WebSocket, PlayerData>()
const playerMatches = new Map<string, Match>()
const queuedPlayers = new Map<string, { ws: WebSocket; mode: GameMode; goal: Goal; name: string }>()

wss.on('connection', (ws: WebSocket) => {
  const playerId = randomUUID()
  const data: PlayerData = { id: playerId, isAlive: true }
  wsData.set(ws, data)

  console.info(`[connect] ${playerId}`)

  // Heartbeat pong
  ws.on('pong', () => {
    data.isAlive = true
  })

  // Route messages
  ws.on('message', (raw: Buffer) => {
    const text = raw.toString('utf8')
    const m = playerMatches.get(data.id)
    if (m) {
      // Already in a match — forward to match handler
      m.handleMessage(data.id, text)
      return
    }

    // Not in a match — check for MODE_SELECT
    let msg: ClientMessage
    try {
      msg = JSON.parse(text) as ClientMessage
    } catch {
      return
    }

    if (msg.type === 'QUIT') {
      removeFromQueue(data.id)
      queuedPlayers.delete(data.id)
      return
    }

    if (msg.type === 'MODE_SELECT') {
      // Runtime validation — mode comes from untrusted client input
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (msg.mode !== 'clicker' && msg.mode !== 'idler') return
      if (queuedPlayers.has(data.id)) return

      // Validate and extract goal from the message
      const goal = parseGoal(msg.goal, msg.mode)
      const name =
        typeof msg.name === 'string'
          ? msg.name
              .trim()
              .replace(/\p{Cc}/gu, '')
              .slice(0, 16)
          : ''

      queuedPlayers.set(data.id, { ws, mode: msg.mode, goal, name })
      const match = addToQueue({ id: data.id, ws, name }, msg.mode, goal)
      if (match) {
        startMatch(match)
      }
      return
    }

    if (msg.type === 'BOT_REQUEST') {
      const entry = queuedPlayers.get(data.id)
      if (!entry) return // not in queue — ignore

      removeFromQueue(data.id)
      queuedPlayers.delete(data.id)

      const botId = `bot-${randomUUID()}`
      const modeDef = getModeDefinition(entry.mode)
      const availableUpgrades = getAvailableUpgrades(modeDef, entry.goal)
      const bot = createBot(entry.mode, modeDef, availableUpgrades)
      const match = new Match(
        { id: data.id, ws, name: entry.name },
        { id: botId, ws: null, name: 'Bot' },
        entry.mode,
        entry.goal,
        bot,
      )
      startMatch(match)
    }
  })

  // Handle disconnect
  ws.on('close', () => {
    console.info(`[disconnect] ${data.id}`)
    const m = playerMatches.get(data.id)
    if (m) {
      m.handleDisconnect(data.id)
    } else {
      removeFromQueue(data.id)
    }
    queuedPlayers.delete(data.id)
    wsData.delete(ws)
  })
})

// ─── Helpers ─────────────────────────────────────────────────────────

/** Register a match, wire up cleanup, and start it. */
function startMatch(match: Match): void {
  for (const pid of match.getPlayerIds()) {
    queuedPlayers.delete(pid)
    playerMatches.set(pid, match)
  }
  match.onEnd(() => {
    for (const pid of match.getPlayerIds()) {
      playerMatches.delete(pid)
    }
  })
  match.start()
}

/**
 * Validate and normalize the goal from an untrusted client message.
 * Only accepts goals that exactly match a predefined entry in MODE_CONFIGS.
 * Falls back to the mode's default goal if the payload is invalid.
 */
function parseGoal(raw: unknown, mode: GameMode): Goal {
  if (raw && typeof raw === 'object' && 'type' in raw) {
    const obj = raw as Record<string, unknown>
    const predefined = getModeDefinition(mode).goals.find((g) => g.type === obj.type)
    if (predefined) return predefined
  }
  // Fallback — ignored bad payload, use default goal for the selected mode
  return getDefaultGoal(mode)
}

// ─── Heartbeat ───────────────────────────────────────────────────────

const heartbeat = setInterval(() => {
  for (const [ws, data] of [...wsData]) {
    if (!data.isAlive) {
      ws.terminate()
      continue
    }
    data.isAlive = false
    ws.ping()
  }
}, HEARTBEAT_INTERVAL_MS)

wss.on('close', () => {
  clearInterval(heartbeat)
})

// ─── Start ───────────────────────────────────────────────────────────

httpServer.listen(PORT, () => {
  console.info(`incremenTal server listening on port ${PORT}`)
})
