import type WebSocket from 'ws'
import type { GameMode, GoalChoice, RoomSettings } from '@game/shared'
import {
  MAX_ROOMS,
  RANDOM_GOAL,
  ROOM_TTL_MS,
  getModeDefinition,
  getDefaultGoal,
  customizeGoal,
  DEFAULT_MODE,
  isAvailableGoalChoice,
  isAvailableMode,
} from '@game/shared'
import { realTimeDelay } from './runtime-config.js'

// ─── Types ───────────────────────────────────────────────────────────

interface QueuedPlayer {
  id: string
  ws: WebSocket | null
  name: string
}

export interface Room {
  code: string
  creatorId: string
  players: QueuedPlayer[]
  mode: GameMode
  goal: GoalChoice
  createdAt: number
  ttlTimer: ReturnType<typeof setTimeout> | null
  /** Callback invoked when the TTL timer fires. Set at creation time. */
  onExpire: (room: Room) => void
}

// ─── Quick-Match Queue ───────────────────────────────────────────────

const quickQueue: QueuedPlayer[] = []

/** Add a player to the quick-match queue. Returns a pair if two are present. */
export function addToQuickQueue(player: QueuedPlayer): [QueuedPlayer, QueuedPlayer] | null {
  quickQueue.push(player)
  if (quickQueue.length >= 2) {
    const p1 = quickQueue.shift()!
    const p2 = quickQueue.shift()!
    return [p1, p2]
  }
  return null
}

/** Remove a player from the quick-match queue. */
export function removeFromQuickQueue(playerId: string): void {
  const idx = quickQueue.findIndex((p) => p.id === playerId)
  if (idx !== -1) quickQueue.splice(idx, 1)
}

/** Look up a queued player by ID (for bot-request). */
export function getQueuedPlayer(playerId: string): QueuedPlayer | undefined {
  return quickQueue.find((p) => p.id === playerId)
}

// ─── Rooms ───────────────────────────────────────────────────────────

const rooms = new Map<string, Room>()
const playerRooms = new Map<string, string>()

/** Generate a 6-char room code (no I/O/0/1 for readability). */
function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code: string
  do {
    code = ''
    for (let i = 0; i < 6; i++) {
      code += chars[Math.floor(Math.random() * chars.length)]
    }
  } while (rooms.has(code))
  return code
}

/** Destroy a room, clearing its TTL timer. */
function destroyRoom(code: string): void {
  const room = rooms.get(code)
  if (!room) return
  if (room.ttlTimer) clearTimeout(room.ttlTimer)
  for (const p of room.players) {
    playerRooms.delete(p.id)
  }
  rooms.delete(code)
  console.info(`[room] destroyed ${code}`)
}

/** Start (or restart) the TTL timer for a non-full room. */
function startTtlTimer(room: Room): void {
  if (room.ttlTimer) clearTimeout(room.ttlTimer)
  room.ttlTimer = setTimeout(() => {
    room.onExpire(room)
    destroyRoom(room.code)
  }, realTimeDelay(ROOM_TTL_MS))
}

/** Cancel the TTL timer (e.g., room became full). */
function cancelTtlTimer(room: Room): void {
  if (room.ttlTimer) {
    clearTimeout(room.ttlTimer)
    room.ttlTimer = null
  }
}

type CreateRoomResult =
  { ok: true; room: Room } | { ok: false; reason: 'room_limit' | 'already_in_room' }

/**
 * Create a new room. The creator becomes the first player.
 * Default settings: idler + buy-upgrade.
 */
export function createRoom(player: QueuedPlayer, onExpire: (room: Room) => void): CreateRoomResult {
  if (playerRooms.has(player.id)) return { ok: false, reason: 'already_in_room' }
  if (rooms.size >= MAX_ROOMS) return { ok: false, reason: 'room_limit' }

  const code = generateRoomCode()
  const defaultGoal = getDefaultGoal(DEFAULT_MODE)

  const room: Room = {
    code,
    creatorId: player.id,
    players: [player],
    mode: DEFAULT_MODE,
    goal: defaultGoal,
    createdAt: Date.now(),
    ttlTimer: null,
    onExpire,
  }

  rooms.set(code, room)
  playerRooms.set(player.id, code)
  startTtlTimer(room)
  console.info(`[room] created ${code} by ${player.id}`)
  return { ok: true, room }
}

type JoinRoomResult =
  { ok: true; room: Room } | { ok: false; reason: 'full' | 'not_found' | 'already_in_room' }

/**
 * Join an existing room by code. A full room stays in the map, waiting for
 * its creator to start the match (`startRoom`).
 */
export function joinRoom(player: QueuedPlayer, code: string): JoinRoomResult {
  if (playerRooms.has(player.id)) return { ok: false, reason: 'already_in_room' }
  const normalized = code.toUpperCase()
  const room = rooms.get(normalized)
  if (!room) return { ok: false, reason: 'not_found' }
  if (room.players.length >= 2) return { ok: false, reason: 'full' }

  room.players.push(player)
  playerRooms.set(player.id, normalized)

  // The clock restarts on a join so a full room whose host never presses
  // Start still expires, but only after a full TTL from the join.
  startTtlTimer(room)
  console.info(`[room] ${normalized} now has ${room.players.length} player(s)`)
  return { ok: true, room }
}

type StartRoomResult =
  { ok: true; room: Room } | { ok: false; reason: 'not_in_room' | 'not_creator' | 'not_full' }

/**
 * Start a full room's match. Only the creator may call this. The room is
 * atomically removed from the map so a late leave or join can't touch a room
 * whose match is already under way.
 */
export function startRoom(playerId: string): StartRoomResult {
  const code = playerRooms.get(playerId)
  const room = code === undefined ? undefined : rooms.get(code)
  if (code === undefined || !room) return { ok: false, reason: 'not_in_room' }
  if (room.creatorId !== playerId) return { ok: false, reason: 'not_creator' }
  if (room.players.length < 2) return { ok: false, reason: 'not_full' }

  cancelTtlTimer(room)
  for (const p of room.players) playerRooms.delete(p.id)
  rooms.delete(code)
  console.info(`[room] ${code} started by its creator`)
  return { ok: true, room }
}

type UpdateResult = { ok: true; settings: RoomSettings } | { ok: false }

/**
 * Update room settings. Only the creator may call this.
 * Validates mode/goal. If mode changes and the current goal pick isn't
 * available in the new mode, resets goal to the new mode's default.
 */
export function updateRoomSettings(
  playerId: string,
  update: { mode?: GameMode; goal?: GoalChoice },
): UpdateResult {
  const code = playerRooms.get(playerId)
  if (!code) return { ok: false }
  const room = rooms.get(code)
  if (!room) return { ok: false }
  if (room.creatorId !== playerId) return { ok: false }

  // Validate mode
  if (update.mode !== undefined) {
    if (!isAvailableMode(update.mode)) return { ok: false }
    room.mode = update.mode
    // Check if the current goal pick is still valid for the new mode
    if (!isAvailableGoalChoice(room.mode, room.goal)) {
      room.goal = getDefaultGoal(room.mode)
    }
  }

  // Validate goal — unknown types (and `random` with nothing to roll) are
  // silently ignored. The label and safety cap always come from our own data.
  if (update.goal !== undefined && isAvailableGoalChoice(room.mode, update.goal)) {
    const requested = update.goal
    if (requested.type === 'random') {
      room.goal = RANDOM_GOAL
    } else {
      const predefined = getModeDefinition(room.mode).goals.find((g) => g.type === requested.type)
      if (predefined) room.goal = customizeGoal(predefined, requested)
    }
  }

  return { ok: true, settings: { mode: room.mode, goal: room.goal } }
}

type LeaveRoomResult =
  | { destroyed: true }
  | { destroyed: false; room: Room; promoted: boolean; leaverName: string }
  | null // player wasn't in a room

/**
 * Remove a player from their room.
 * If the room is now empty, destroy it.
 * If another player remains, promote them to creator if needed.
 */
export function leaveRoom(playerId: string): LeaveRoomResult {
  const code = playerRooms.get(playerId)
  if (!code) return null
  const room = rooms.get(code)
  if (!room) {
    playerRooms.delete(playerId)
    return null
  }

  const leaverName = room.players.find((p) => p.id === playerId)?.name ?? 'Player'
  room.players = room.players.filter((p) => p.id !== playerId)
  playerRooms.delete(playerId)

  if (room.players.length === 0) {
    destroyRoom(code)
    return { destroyed: true }
  }

  // Promote remaining player to creator if the leaver was the creator
  const promoted = room.creatorId === playerId
  if (promoted) {
    room.creatorId = room.players[0].id
  }

  // Room is now non-full — restart TTL timer
  startTtlTimer(room)

  return { destroyed: false, room, promoted, leaverName }
}

/**
 * Remove a player from all tracking (queue + rooms).
 * Called on disconnect.
 */
export function removeFromAll(playerId: string): LeaveRoomResult {
  removeFromQuickQueue(playerId)
  return leaveRoom(playerId)
}

/** Get the number of active rooms. */
export function getRoomCount(): number {
  return rooms.size
}

/** Look up a room by player ID. */
export function getRoomByPlayerId(playerId: string): Room | undefined {
  const code = playerRooms.get(playerId)
  if (!code) return undefined
  return rooms.get(code)
}
