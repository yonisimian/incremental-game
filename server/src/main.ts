import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import WebSocket, { WebSocketServer } from 'ws'
import {
  HEARTBEAT_INTERVAL_MS,
  ROOM_TTL_MS,
  SERVER_STATUS_INTERVAL_MS,
  RANDOM_GOAL,
  getModeDefinition,
  getAvailableModes,
  isAvailableMode,
  resolveGoal,
  sanitizeGoalChoice,
} from '@game/shared'
import type {
  ClientMessage,
  GameMode,
  GoalChoice,
  ServerMessage,
  ServerStatusMessage,
} from '@game/shared'
import {
  addToQuickQueue,
  removeFromQuickQueue,
  getQueuedPlayer,
  createRoom,
  joinRoom,
  leaveRoom,
  updateRoomSettings,
  startRoom,
  reopenRoom,
  removeFromAll,
  getRoomCount,
  getRoomByPlayerId,
} from './matchmaking.js'
import type { Room, RoomSnapshot } from './matchmaking.js'
import { Match } from './match.js'
import { createBot } from './bot.js'
import { loadTreeFiles } from './trees.js'
import { GAME_TIME_SCALE, realTimeDelay } from './runtime-config.js'

const PORT = Number(process.env.PORT) || 10000
const HOST = process.env.HOST

// ─── Mode trees (server-authoritative) ───────────────────────────────
//
// The canonical tree files are the single source of truth, owned by the shared
// package and edited via the dev-page tree editor. Every file in its `trees/`
// folder is a mode (see `trees.ts`): the server validates + registers each one
// and caches the raw bytes to serve verbatim. Clients fetch the mode list from
// `/trees.json` and each tree from `/trees/:mode.json`, so both ends agree on
// the exact trees (multiplayer integrity).
const rawTrees = loadTreeFiles()
const modeList = JSON.stringify([...rawTrees.keys()])

// ─── HTTP Server (health check + tree files) ────────────────────────

const httpServer = createServer((req, res) => {
  // Serve the mode list and the canonical tree files (server-authoritative).
  if (req.url === '/trees.json') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache',
    })
    res.end(modeList)
    return
  }
  const treeMatch = /^\/trees\/([a-z0-9-]+)\.json$/u.exec(req.url ?? '/')
  if (treeMatch) {
    const raw = rawTrees.get(treeMatch[1])
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
  goal: GoalChoice
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

/** Look up a rematch-queue entry by player ID (for bot-request). */
function getRematchEntry(playerId: string): RematchEntry | undefined {
  for (const entry of rematchQueue.values()) {
    if (entry.id === playerId) return entry
  }
  return undefined
}

/**
 * The room each room-started match came from, keyed by match id. A rematch
 * of such a match reopens the room instead of starting straight away. Kept
 * for one room TTL after the match ends, then forgotten.
 */
const roomSnapshots = new Map<string, RoomSnapshot>()

/** Both players asked for a rematch of a room match: seat them back in it. */
function reopenRoomForRematch(pair: [RematchEntry, RematchEntry], snapshot: RoomSnapshot): void {
  const creator = pair[1].id === snapshot.creatorId ? pair[1] : pair[0]
  const joiner = creator === pair[0] ? pair[1] : pair[0]
  const result = reopenRoom(
    { id: creator.id, ws: creator.ws, name: creator.name },
    { id: joiner.id, ws: joiner.ws, name: joiner.name },
    snapshot,
    onRoomExpire,
  )
  if (!result.ok) {
    broadcast([creator, joiner], { type: 'ROOM_ERROR', reason: result.reason })
    return
  }
  const { room } = result
  const settings = { mode: room.mode, goal: room.goal }
  const players = room.players.map((p) => p.name)
  send(creator.ws, { type: 'ROOM_CREATED', code: room.code, settings, players })
  send(joiner.ws, { type: 'ROOM_JOINED', code: room.code, settings, players })
}

/** Roll random settings for quick-match. */
function rollRandomSettings(): { mode: GameMode; goal: GoalChoice } {
  const modes = getAvailableModes()
  const mode = modes[Math.floor(Math.random() * modes.length)]
  return { mode, goal: resolveGoal(mode, RANDOM_GOAL) }
}

/** Callback when a room's TTL expires — notify remaining players. */
function onRoomExpire(room: Room): void {
  broadcast(room.players, { type: 'ROOM_CLOSED', reason: 'expired' })
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
      removeFromRematchQueue(data.id)
      notifyPlayerLeft(removeFromAll(data.id))
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
      if (!isAvailableMode(msg.mode)) return
      if (!msg.matchId || typeof msg.matchId !== 'string') return
      // Only the type and tunable survive from the payload; everything else is ours.
      const goal = sanitizeGoalChoice(msg.mode, msg.goal)
      if (!goal) return

      const name = sanitizeName(msg.name)
      const mode = msg.mode
      const pair = addToRematchQueue(msg.matchId, { id: data.id, ws, name, mode, goal })
      if (!pair) return
      // A room match goes back to its room for the host to start again; a
      // quick match replays its settings straight away.
      const snapshot = roomSnapshots.get(msg.matchId)
      if (snapshot) {
        roomSnapshots.delete(msg.matchId)
        reopenRoomForRematch(pair, snapshot)
        return
      }
      startMatch(
        new Match(
          { id: pair[0].id, ws: pair[0].ws, name: pair[0].name },
          { id: pair[1].id, ws: pair[1].ws, name: pair[1].name },
          pair[0].mode,
          pair[0].goal,
        ),
      )
      return
    }

    // ── ROOM_CREATE ──────────────────────────────────────────────
    if (msg.type === 'ROOM_CREATE') {
      if (getQueuedPlayer(data.id)) return // already in queue
      if (getRoomByPlayerId(data.id)) return // already in a room

      const name = sanitizeName(msg.name)
      const result = createRoom({ id: data.id, ws, name }, onRoomExpire)
      if (!result.ok) {
        send(ws, { type: 'ROOM_ERROR', reason: result.reason })
        return
      }
      send(ws, {
        type: 'ROOM_CREATED',
        code: result.room.code,
        settings: { mode: result.room.mode, goal: result.room.goal },
        players: result.room.players.map((p) => p.name),
      })
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
        send(ws, { type: 'ROOM_ERROR', reason: result.reason })
        return
      }

      // Confirm join to the joiner; the creator starts the match from here.
      send(ws, {
        type: 'ROOM_JOINED',
        code: result.room.code,
        settings: { mode: result.room.mode, goal: result.room.goal },
        players: result.room.players.map((p) => p.name),
      })
      broadcast(
        result.room.players.filter((p) => p.id !== data.id),
        { type: 'ROOM_PLAYER_JOINED', name },
      )
      return
    }

    // ── ROOM_START ───────────────────────────────────────────────
    if (msg.type === 'ROOM_START') {
      const result = startRoom(data.id)
      if (!result.ok) return
      const { room } = result
      // Creator = player 1, whoever joined = player 2.
      const creator = room.players.find((p) => p.id === room.creatorId)!
      const joiner = room.players.find((p) => p.id !== creator.id)!
      startMatch(
        new Match(
          { id: creator.id, ws: creator.ws!, name: creator.name },
          { id: joiner.id, ws: joiner.ws!, name: joiner.name },
          room.mode,
          room.goal,
        ),
        { code: room.code, creatorId: creator.id, mode: room.mode, goal: room.goal },
      )
      return
    }

    // ── ROOM_UPDATE ──────────────────────────────────────────────
    if (msg.type === 'ROOM_UPDATE') {
      const result = updateRoomSettings(data.id, {
        mode: isAvailableMode(msg.mode) ? msg.mode : undefined,
        goal: msg.goal,
      })
      if (!result.ok) return

      const room = getRoomByPlayerId(data.id)
      if (room) broadcast(room.players, { type: 'ROOM_UPDATED', settings: result.settings })
      return
    }

    // ── BOT_REQUEST ──────────────────────────────────────────────
    if (msg.type === 'BOT_REQUEST') {
      // Try quick-match queue first
      const queueEntry = getQueuedPlayer(data.id)
      if (queueEntry) {
        removeFromQuickQueue(data.id)
        const { mode, goal } = rollRandomSettings()
        startBotMatch({ id: data.id, ws, name: queueEntry.name }, mode, goal)
        return
      }

      // Try rematch queue (player clicked "play against a bot" after a rematch)
      const rematchEntry = getRematchEntry(data.id)
      if (rematchEntry) {
        removeFromRematchQueue(data.id)
        const { mode, goal, name } = rematchEntry
        startBotMatch({ id: data.id, ws, name }, mode, goal)
        return
      }

      // Try room (only if creator and alone)
      const room = getRoomByPlayerId(data.id)
      if (room?.creatorId === data.id && room.players.length === 1) {
        const { mode, goal } = room
        const name = room.players[0].name
        leaveRoom(data.id) // destroys the now-empty room
        startBotMatch({ id: data.id, ws, name }, mode, goal)
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
      notifyPlayerLeft(removeFromAll(data.id))
    }
    wsData.delete(ws)
  })
})

// ─── Helpers ─────────────────────────────────────────────────────────

function send(ws: WebSocket | null, msg: ServerMessage): void {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
}

function broadcast(players: readonly { ws: WebSocket | null }[], msg: ServerMessage): void {
  for (const p of players) send(p.ws, msg)
}

/** Tell whoever is left in a room that a player left it. */
function notifyPlayerLeft(result: ReturnType<typeof leaveRoom>): void {
  if (!result || result.destroyed) return
  broadcast(result.room.players, {
    type: 'ROOM_PLAYER_LEFT',
    name: result.leaverName,
    promoted: result.promoted,
  })
}

function startBotMatch(
  human: { id: string; ws: WebSocket; name: string },
  mode: GameMode,
  goal: GoalChoice,
): void {
  const modeDef = getModeDefinition(mode)
  const botPlayer = { id: `bot-${randomUUID()}`, ws: null, name: 'Bot' }
  // The match resolves a `random` pick, so the bot is built from the goal it rolled.
  startMatch(
    new Match(human, botPlayer, mode, goal, (upgrades) => createBot(mode, modeDef, upgrades)),
  )
}

/**
 * Register a match, wire up cleanup, and start it. `fromRoom` is the room a
 * room match was started from, remembered so a rematch can reopen it.
 */
function startMatch(match: Match, fromRoom?: RoomSnapshot): void {
  for (const pid of match.getPlayerIds()) {
    playerMatches.set(pid, match)
  }
  if (fromRoom) roomSnapshots.set(match.id, fromRoom)
  match.onEnd(() => {
    for (const pid of match.getPlayerIds()) {
      playerMatches.delete(pid)
    }
    if (fromRoom) {
      setTimeout(() => roomSnapshots.delete(match.id), realTimeDelay(ROOM_TTL_MS)).unref()
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
}, realTimeDelay(HEARTBEAT_INTERVAL_MS))

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
}, realTimeDelay(SERVER_STATUS_INTERVAL_MS))

wss.on('close', () => {
  clearInterval(heartbeat)
  clearInterval(statusBroadcast)
})

// ─── Start ───────────────────────────────────────────────────────────

httpServer.listen(PORT, HOST, () => {
  console.info(
    `incremenTal server listening on ${HOST ?? 'all interfaces'}:${PORT}${
      GAME_TIME_SCALE === 1 ? '' : ` (game time ×${GAME_TIME_SCALE})`
    }`,
  )
})
