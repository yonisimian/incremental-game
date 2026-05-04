import type {
  GameMode,
  Goal,
  MatchWinner,
  PlayerAction,
  PlayerState,
  UpgradeDefinition,
} from './types.js'

// ─── Client → Server ────────────────────────────────────────────────

/** Batched player actions sent from client to server. */
export interface ActionBatchMessage {
  type: 'ACTION_BATCH'
  /** Monotonically increasing sequence number per client. */
  seq: number
  actions: PlayerAction[]
}

/** Sent by client to enter the quick-match queue. */
export interface QuickMatchMessage {
  type: 'QUICK_MATCH'
  /** Player's chosen display name (may be empty). */
  name: string
}

/** Sent by client to create a new room. */
export interface RoomCreateMessage {
  type: 'ROOM_CREATE'
  /** Player's chosen display name (may be empty). */
  name: string
}

/** Sent by client to join an existing room by code. */
export interface RoomJoinMessage {
  type: 'ROOM_JOIN'
  /** 6-character room code (case-insensitive). */
  code: string
  /** Player's chosen display name (may be empty). */
  name: string
}

/** Sent by the room creator to change settings. */
export interface RoomUpdateMessage {
  type: 'ROOM_UPDATE'
  mode?: GameMode
  goal?: Goal
}

/** Sent by client to voluntarily quit the current match, room, or queue. */
export interface QuitMessage {
  type: 'QUIT'
}

/** Sent by client while in queue or room to request a bot opponent. */
export interface BotRequestMessage {
  type: 'BOT_REQUEST'
}

export type ClientMessage =
  | ActionBatchMessage
  | QuickMatchMessage
  | RoomCreateMessage
  | RoomJoinMessage
  | RoomUpdateMessage
  | QuitMessage
  | BotRequestMessage

// ─── Server → Client ────────────────────────────────────────────────

/** Periodic authoritative state snapshot. */
export interface StateUpdateMessage {
  type: 'STATE_UPDATE'
  /** Server tick counter (monotonically increasing). */
  tick: number
  /** Highest client ACTION_BATCH seq the server has processed. */
  ackSeq: number
  /** The receiving player's own state. */
  player: PlayerState
  /** The opponent's state (full visibility). */
  opponent: PlayerState
  /** Seconds remaining in the round. */
  timeLeft: number
}

/** Sent when a match begins (after matchmaking). */
export interface RoundStartMessage {
  type: 'ROUND_START'
  matchId: string
  /** Game configuration for this round. */
  config: {
    mode: GameMode
    goal: Goal
    upgrades: readonly UpgradeDefinition[]
  }
  /** Opponent's display name (may be empty). */
  opponentName: string
  /** Server timestamp (ms) for clock synchronization. */
  serverTime: number
}

/** Why the round ended. */
export type RoundEndReason = 'complete' | 'safety-cap' | 'quit' | 'forfeit'

/** Sent when the round ends (timer expired, quit, or forfeit). */
export interface RoundEndMessage {
  type: 'ROUND_END'
  winner: MatchWinner
  reason: RoundEndReason
  finalScores: { player: number; opponent: number }
  stats: {
    totalClicks: number
    peakCps: number
    upgradesPurchased: string[]
  }
}

// ─── Room Messages (Server → Client) ────────────────────────────────

/** Room settings payload. */
export interface RoomSettings {
  mode: GameMode
  goal: Goal
}

/** Confirms room creation, provides the code and initial player list. */
export interface RoomCreatedMessage {
  type: 'ROOM_CREATED'
  code: string
  settings: RoomSettings
  /** Display names of players in the room. */
  players: string[]
}

/** Confirms join, provides current room state (players = display names). */
export interface RoomJoinedMessage {
  type: 'ROOM_JOINED'
  code: string
  settings: RoomSettings
  /** Display names of players in the room. */
  players: string[]
}

/** Broadcast updated settings to all room members. */
export interface RoomUpdatedMessage {
  type: 'ROOM_UPDATED'
  settings: RoomSettings
}

/** Notify room members that a player joined. */
export interface RoomPlayerJoinedMessage {
  type: 'ROOM_PLAYER_JOINED'
  name: string
}

/** Notify remaining player that the other left. */
export interface RoomPlayerLeftMessage {
  type: 'ROOM_PLAYER_LEFT'
  /** Display name of the player who left. */
  name: string
  /** True if the remaining player is now the room creator. */
  promoted: boolean
}

/** Room was destroyed (e.g., TTL expiry). Player is returned to lobby. */
export interface RoomClosedMessage {
  type: 'ROOM_CLOSED'
  reason: 'expired'
}

/** Error response for room/join/create operations. */
export type RoomErrorReason = 'full' | 'not_found' | 'already_in_room' | 'room_limit'

export interface RoomErrorMessage {
  type: 'ROOM_ERROR'
  reason: RoomErrorReason
}

/** Periodic server diagnostics (active rooms, etc.). */
export interface ServerStatusMessage {
  type: 'SERVER_STATUS'
  activeRooms: number
}

export type ServerMessage =
  | StateUpdateMessage
  | RoundStartMessage
  | RoundEndMessage
  | RoomCreatedMessage
  | RoomJoinedMessage
  | RoomUpdatedMessage
  | RoomPlayerJoinedMessage
  | RoomPlayerLeftMessage
  | RoomClosedMessage
  | RoomErrorMessage
  | ServerStatusMessage
