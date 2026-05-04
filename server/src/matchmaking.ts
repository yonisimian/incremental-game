import type WebSocket from 'ws'
import type { GameMode, Goal, RoomSettings } from '@game/shared'
import {
  MAX_ROOMS,
  ROOM_TTL_MS,
  getModeDefinition,
  getDefaultGoal,
  AVAILABLE_MODES,
} from '@game/shared'

// ─── Types ───────────────────────────────────────────────────────────

export interface QueuedPlayer {
  id: string
  ws: WebSocket | null
  name: string
}

export interface Room {
  code: string
  creatorId: string
  players: QueuedPlayer[]
  mode: GameMode
  goal: Goal
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
  }, ROOM_TTL_MS)
}

/** Cancel the TTL timer (e.g., room became full). */
function cancelTtlTimer(room: Room): void {
  if (room.ttlTimer) {
    clearTimeout(room.ttlTimer)
    room.ttlTimer = null
  }
}

export type CreateRoomResult =
  | { ok: true; room: Room }
  | { ok: false; reason: 'room_limit' | 'already_in_room' }

/**
 * Create a new room. The creator becomes the first player.
 * Default settings: clicker + timed.
 */
export function createRoom(player: QueuedPlayer, onExpire: (room: Room) => void): CreateRoomResult {
  if (playerRooms.has(player.id)) return { ok: false, reason: 'already_in_room' }
  if (rooms.size >= MAX_ROOMS) return { ok: false, reason: 'room_limit' }

  const code = generateRoomCode()
  const defaultMode: GameMode = 'clicker'
  const defaultGoal = getDefaultGoal(defaultMode)

  const room: Room = {
    code,
    creatorId: player.id,
    players: [player],
    mode: defaultMode,
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

export type JoinRoomResult =
  | { ok: true; room: Room; matchReady: boolean }
  | { ok: false; reason: 'full' | 'not_found' | 'already_in_room' }

/**
 * Join an existing room by code. If the room becomes full, it is
 * atomically removed from the map and `matchReady: true` is returned.
 */
export function joinRoom(player: QueuedPlayer, code: string): JoinRoomResult {
  if (playerRooms.has(player.id)) return { ok: false, reason: 'already_in_room' }
  const normalized = code.toUpperCase()
  const room = rooms.get(normalized)
  if (!room) return { ok: false, reason: 'not_found' }
  if (room.players.length >= 2) return { ok: false, reason: 'full' }

  room.players.push(player)
  playerRooms.set(player.id, normalized)

  if (room.players.length >= 2) {
    // Room is full — atomically remove from map before match starts.
    cancelTtlTimer(room)
    for (const p of room.players) playerRooms.delete(p.id)
    rooms.delete(normalized)
    console.info(`[room] ${normalized} full — starting match`)
    return { ok: true, room, matchReady: true }
  }

  // Room still needs another player — cancel old timer & restart.
  // (Timer was running; now a player joined but room isn't full yet — shouldn't
  //  happen with max 2, but guard for future >2 rooms.)
  return { ok: true, room, matchReady: false }
}

export type UpdateResult = { ok: true; settings: RoomSettings } | { ok: false }

/**
 * Update room settings. Only the creator may call this.
 * Validates mode/goal. If mode changes and the current goal type isn't
 * available in the new mode, resets goal to the new mode's default.
 */
export function updateRoomSettings(
  playerId: string,
  update: { mode?: GameMode; goal?: Goal },
): UpdateResult {
  const code = playerRooms.get(playerId)
  if (!code) return { ok: false }
  const room = rooms.get(code)
  if (!room) return { ok: false }
  if (room.creatorId !== playerId) return { ok: false }

  // Validate mode
  if (update.mode !== undefined) {
    if (!AVAILABLE_MODES.includes(update.mode)) return { ok: false }
    room.mode = update.mode
    // Check if current goal is still valid for the new mode
    const modeDef = getModeDefinition(room.mode)
    const goalStillValid = modeDef.goals.some((g) => g.type === room.goal.type)
    if (!goalStillValid) {
      room.goal = getDefaultGoal(room.mode)
    }
  }

  // Validate goal
  if (update.goal !== undefined) {
    const modeDef = getModeDefinition(room.mode)
    const predefined = modeDef.goals.find((g) => g.type === update.goal!.type)
    if (predefined) {
      room.goal = predefined
    }
    // Silently ignore invalid goals
  }

  return { ok: true, settings: { mode: room.mode, goal: room.goal } }
}

export type LeaveRoomResult =
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
