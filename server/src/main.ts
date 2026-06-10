import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import WebSocket, { WebSocketServer } from 'ws'
import {
  HEARTBEAT_INTERVAL_MS,
  SERVER_STATUS_INTERVAL_MS,
  getAvailableUpgrades,
  getModeDefinition,
  loadTree,
  AVAILABLE_MODES,
} from '@game/shared'
import type { ClientMessage, GameMode, Goal, ServerStatusMessage } from '@game/shared'
import {
  addToQuickQueue,
  removeFromQuickQueue,
  getQueuedPlayer,
  createRoom,
  joinRoom,
  leaveRoom,
  updateRoomSettings,
  removeFromAll,
  getRoomCount,
  getRoomByPlayerId,
} from './matchmaking.js'
import type { Room } from './matchmaking.js'
import { Match } from './match.js'
import { createBot } from './bot.js'

const PORT = Number(process.env.PORT) || 10000

// ─── Mode trees (server-authoritative) ───────────────────────────────
//
// The server owns the canonical tree files (D13/D17): it reads each one from
// disk at startup, validates + registers it as a runtime mode, and caches the
// raw bytes to serve verbatim. Clients fetch the same bytes from `/trees/:mode`,
// so both ends agree on the exact tree (multiplayer integrity). The path is
// resolved relative to this module, so it works from both `src` (dev) and
// `dist` (prod) — `../trees/` is a sibling of each.
const treesDir = fileURLToPath(new URL('../trees/', import.meta.url))
const rawTrees = new Map<GameMode, string>()
for (const mode of AVAILABLE_MODES) {
  const raw = readFileSync(`${treesDir}${mode}.json`, 'utf8')
  loadTree(JSON.parse(raw) as unknown)
  rawTrees.set(mode, raw)
}

// ─── Helper: valid modes ─────────────────────────────────────────────

function isValidMode(mode: unknown): mode is GameMode {
  return typeof mode === 'string' && (AVAILABLE_MODES as readonly string[]).includes(mode)
}

/** Check that a goal matches one of the mode's defined goals (by type). */
function isValidGoal(mode: GameMode, goal: unknown): goal is Goal {
  if (!goal || typeof goal !== 'object' || !('type' in goal)) return false
  const modeDef = getModeDefinition(mode)
  return modeDef.goals.some((g) => g.type === (goal as { type: string }).type)
}

// ─── HTTP Server (health check + tree files) ────────────────────────

const httpServer = createServer((req, res) => {
  // Serve the canonical tree files (server-authoritative; D17).
  const treeMatch = /^\/trees\/([a-z0-9-]+)\.json$/u.exec(req.url ?? '/')
  if (treeMatch) {
    const raw = rawTrees.get(treeMatch[1] as GameMode)
    if (raw === undefined) {
      res.writeHead(404, { 'Access-Control-Allow-Origin': '*' })
      res.end('not found')
      return
    }
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache',
    })
    res.end(raw)
    return
  }

  // Health check (cold-start probe).
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

/** Sanitize a display name from untrusted input. */
function sanitizeName(raw: unknown): string {
  return typeof raw === 'string'
    ? raw
        .trim()
        .replace(/\p{Cc}/gu, '')
        .slice(0, 16)
    : ''
}

// ─── Rematch Queue ───────────────────────────────────────────────────

interface RematchEntry {
  id: string
  ws: WebSocket
  name: string
  mode: GameMode
  goal: Goal
}

/** Rematch queue keyed by matchId — only the two original opponents can pair. */
const rematchQueue = new Map<string, RematchEntry>()

function addToRematchQueue(
  matchId: string,
  entry: RematchEntry,
): [RematchEntry, RematchEntry] | null {
  const waiting = rematchQueue.get(matchId)
  if (waiting && waiting.id !== entry.id) {
    rematchQueue.delete(matchId)
    return [waiting, entry]
  }
  rematchQueue.set(matchId, entry)
  return null
}

function removeFromRematchQueue(playerId: string): void {
  for (const [key, entry] of rematchQueue) {
    if (entry.id === playerId) {
      rematchQueue.delete(key)
      return
    }
  }
}

/** Roll random settings for quick-match. */
function rollRandomSettings(): { mode: GameMode; goal: Goal } {
  const mode = AVAILABLE_MODES[Math.floor(Math.random() * AVAILABLE_MODES.length)]
  const modeDef = getModeDefinition(mode)
  const goal = modeDef.goals[Math.floor(Math.random() * modeDef.goals.length)]
  return { mode, goal }
}

/** Callback when a room's TTL expires — notify remaining players. */
function onRoomExpire(room: Room): void {
  for (const p of room.players) {
    if (p.ws?.readyState === WebSocket.OPEN) {
      p.ws.send(JSON.stringify({ type: 'ROOM_CLOSED', reason: 'expired' }))
    }
  }
}

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

    let msg: ClientMessage
    try {
      msg = JSON.parse(text) as ClientMessage
    } catch {
      return
    }

    // ── QUIT ─────────────────────────────────────────────────────
    if (msg.type === 'QUIT') {
      removeFromQuickQueue(data.id)
      removeFromRematchQueue(data.id)
      const result = leaveRoom(data.id)
      if (result && !result.destroyed) {
        // Notify the remaining player
        for (const p of result.room.players) {
          if (p.ws?.readyState === WebSocket.OPEN) {
            p.ws.send(
              JSON.stringify({
                type: 'ROOM_PLAYER_LEFT',
                name: result.leaverName,
                promoted: result.promoted,
              }),
            )
          }
        }
      }
      return
    }

    // ── QUICK_MATCH ──────────────────────────────────────────────
    if (msg.type === 'QUICK_MATCH') {
      if (getQueuedPlayer(data.id)) return // already in queue
      if (getRoomByPlayerId(data.id)) return // already in a room

      const name = sanitizeName(msg.name)
      const pair = addToQuickQueue({ id: data.id, ws, name })
      if (pair) {
        const { mode, goal } = rollRandomSettings()
        const match = new Match(
          { id: pair[0].id, ws: pair[0].ws!, name: pair[0].name },
          { id: pair[1].id, ws: pair[1].ws!, name: pair[1].name },
          mode,
          goal,
        )
        startMatch(match)
      }
      return
    }

    // ── REMATCH ──────────────────────────────────────────────────
    if (msg.type === 'REMATCH') {
      if (getQueuedPlayer(data.id)) return // already in queue
      if (getRoomByPlayerId(data.id)) return // already in a room
      if (!isValidMode(msg.mode)) return
      if (!isValidGoal(msg.mode, msg.goal)) return
      if (!msg.matchId || typeof msg.matchId !== 'string') return

      const name = sanitizeName(msg.name)
      const mode = msg.mode
      const goal = msg.goal
      const pair = addToRematchQueue(msg.matchId, { id: data.id, ws, name, mode, goal })
      if (pair) {
        const match = new Match(
          { id: pair[0].id, ws: pair[0].ws, name: pair[0].name },
          { id: pair[1].id, ws: pair[1].ws, name: pair[1].name },
          pair[0].mode,
          pair[0].goal,
        )
        startMatch(match)
      }
      return
    }

    // ── ROOM_CREATE ──────────────────────────────────────────────
    if (msg.type === 'ROOM_CREATE') {
      if (getQueuedPlayer(data.id)) return // already in queue
      if (getRoomByPlayerId(data.id)) return // already in a room

      const name = sanitizeName(msg.name)
      const result = createRoom({ id: data.id, ws, name }, onRoomExpire)
      if (!result.ok) {
        ws.send(JSON.stringify({ type: 'ROOM_ERROR', reason: result.reason }))
        return
      }
      ws.send(
        JSON.stringify({
          type: 'ROOM_CREATED',
          code: result.room.code,
          settings: { mode: result.room.mode, goal: result.room.goal },
          players: result.room.players.map((p) => p.name),
        }),
      )
      return
    }

    // ── ROOM_JOIN ────────────────────────────────────────────────
    if (msg.type === 'ROOM_JOIN') {
      if (getQueuedPlayer(data.id)) return // already in queue
      if (getRoomByPlayerId(data.id)) return // already in a room

      const name = sanitizeName(msg.name)
      const code = typeof msg.code === 'string' ? msg.code.toUpperCase().trim() : ''
      if (!code) return

      const result = joinRoom({ id: data.id, ws, name }, code)
      if (!result.ok) {
        ws.send(JSON.stringify({ type: 'ROOM_ERROR', reason: result.reason }))
        return
      }

      if (result.matchReady) {
        // Room is full — start match (creator = player 1)
        const p1 = result.room.players[0]
        const p2 = result.room.players[1]
        const match = new Match(
          { id: p1.id, ws: p1.ws!, name: p1.name },
          { id: p2.id, ws: p2.ws!, name: p2.name },
          result.room.mode,
          result.room.goal,
        )
        startMatch(match)
      } else {
        // Confirm join to the joiner
        ws.send(
          JSON.stringify({
            type: 'ROOM_JOINED',
            code: result.room.code,
            settings: { mode: result.room.mode, goal: result.room.goal },
            players: result.room.players.map((p) => p.name),
          }),
        )
        // Notify existing players that someone joined
        for (const p of result.room.players) {
          if (p.id !== data.id && p.ws?.readyState === WebSocket.OPEN) {
            p.ws.send(
              JSON.stringify({
                type: 'ROOM_PLAYER_JOINED',
                name,
              }),
            )
          }
        }
      }
      return
    }

    // ── ROOM_UPDATE ──────────────────────────────────────────────
    if (msg.type === 'ROOM_UPDATE') {
      const result = updateRoomSettings(data.id, {
        mode: isValidMode(msg.mode) ? msg.mode : undefined,
        goal: msg.goal,
      })
      if (!result.ok) return

      // Broadcast updated settings to all room members
      const room = getRoomByPlayerId(data.id)
      if (room) {
        for (const p of room.players) {
          if (p.ws?.readyState === WebSocket.OPEN) {
            p.ws.send(
              JSON.stringify({
                type: 'ROOM_UPDATED',
                settings: result.settings,
              }),
            )
          }
        }
      }
      return
    }

    // ── BOT_REQUEST ──────────────────────────────────────────────
    if (msg.type === 'BOT_REQUEST') {
      // Try quick-match queue first
      const queueEntry = getQueuedPlayer(data.id)
      if (queueEntry) {
        removeFromQuickQueue(data.id)
        const { mode, goal } = rollRandomSettings()
        const botId = `bot-${randomUUID()}`
        const modeDef = getModeDefinition(mode)
        const availableUpgrades = getAvailableUpgrades(modeDef, goal)
        const bot = createBot(mode, modeDef, availableUpgrades)
        const match = new Match(
          { id: data.id, ws, name: queueEntry.name },
          { id: botId, ws: null, name: 'Bot' },
          mode,
          goal,
          bot,
        )
        startMatch(match)
        return
      }

      // Try room (only if creator and alone)
      const room = getRoomByPlayerId(data.id)
      if (room?.creatorId === data.id && room.players.length === 1) {
        const playerName = room.players[0].name
        const { mode, goal } = room

        // Destroy the room first
        leaveRoom(data.id)

        const botId = `bot-${randomUUID()}`
        const modeDef = getModeDefinition(mode)
        const availableUpgrades = getAvailableUpgrades(modeDef, goal)
        const bot = createBot(mode, modeDef, availableUpgrades)
        const match = new Match(
          { id: data.id, ws, name: playerName },
          { id: botId, ws: null, name: 'Bot' },
          mode,
          goal,
          bot,
        )
        startMatch(match)
      }
    }
  })

  // Handle disconnect
  ws.on('close', () => {
    console.info(`[disconnect] ${data.id}`)
    removeFromRematchQueue(data.id)
    const m = playerMatches.get(data.id)
    if (m) {
      m.handleDisconnect(data.id)
    } else {
      const result = removeFromAll(data.id)
      if (result && !result.destroyed) {
        // Notify the remaining player
        for (const p of result.room.players) {
          if (p.ws?.readyState === WebSocket.OPEN) {
            p.ws.send(
              JSON.stringify({
                type: 'ROOM_PLAYER_LEFT',
                name: result.leaverName,
                promoted: result.promoted,
              }),
            )
          }
        }
      }
    }
    wsData.delete(ws)
  })
})

// ─── Helpers ─────────────────────────────────────────────────────────

/** Register a match, wire up cleanup, and start it. */
function startMatch(match: Match): void {
  for (const pid of match.getPlayerIds()) {
    playerMatches.set(pid, match)
  }
  match.onEnd(() => {
    for (const pid of match.getPlayerIds()) {
      playerMatches.delete(pid)
    }
  })
  match.start()
}

// ─── Heartbeat ───────────────────────────────────────────────────────

const heartbeat = setInterval(() => {
  for (const [ws, pdata] of [...wsData]) {
    if (!pdata.isAlive) {
      ws.terminate()
      continue
    }
    pdata.isAlive = false
    ws.ping()
  }
}, HEARTBEAT_INTERVAL_MS)

// ─── Server Status Broadcast ─────────────────────────────────────────

const statusBroadcast = setInterval(() => {
  const msg: ServerStatusMessage = {
    type: 'SERVER_STATUS',
    activeRooms: getRoomCount(),
  }
  const payload = JSON.stringify(msg)
  for (const [client] of wsData) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload)
    }
  }
}, SERVER_STATUS_INTERVAL_MS)

wss.on('close', () => {
  clearInterval(heartbeat)
  clearInterval(statusBroadcast)
})

// ─── Start ───────────────────────────────────────────────────────────

httpServer.listen(PORT, () => {
  console.info(`incremenTal server listening on port ${PORT}`)
})
