import type { GameMode, Goal, MatchWinner, PlayerAction, PlayerState } from './types.js'

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

/** Sent by client to pause the current match. */
export interface PauseMessage {
  type: 'PAUSE'
}

/** Sent by client to resume the current match after a pause. */
export interface UnpauseMessage {
  type: 'UNPAUSE'
}

/** Sent by client while in queue or room to request a bot opponent. */
export interface BotRequestMessage {
  type: 'BOT_REQUEST'
}

/** Sent by client on end screen to request a rematch with the same opponent. */
export interface RematchMessage {
  type: 'REMATCH'
  /** Player's display name. */
  name: string
  /** Match ID from the just-finished match (pairs only the same two players). */
  matchId: string
  /** Mode from the just-finished match. */
  mode: GameMode
  /** Goal from the just-finished match. */
  goal: Goal
}

export type ClientMessage =
  | ActionBatchMessage
  | QuickMatchMessage
  | RoomCreateMessage
  | RoomJoinMessage
  | RoomUpdateMessage
  | QuitMessage
  | PauseMessage
  | UnpauseMessage
  | BotRequestMessage
  | RematchMessage

// ─── Server → Client ────────────────────────────────────────────────

/**
 * A single opponent purchase, surfaced in the espionage feed (`accessEnemyData:
 * purchases`). Detail is gated by tier: the base `purchases` grant reveals only
 * that *something* was bought and when (`t`), so `kind`/`id` are omitted to keep
 * the opponent's tree hidden in devtools. Deeper espionage tiers (planned
 * `e-p-u` / `e-p-g`) add `kind` and `id`; the client resolves `id` → name /
 * description from the mode flavor (the server never sends display strings).
 */
export interface PurchaseEvent {
  /** Round-elapsed game seconds when the purchase happened (mirrors `meta.gameSec`). */
  t: number
  /** What was bought — present only for tiers that reveal purchase kind. */
  kind?: 'upgrade' | 'generator'
  /** Abstract upgrade/generator id — present only for tiers that reveal detail. */
  id?: string
}

/**
 * A redacted projection of the opponent's state — only the intel the receiving
 * player has unlocked. Unlike `PlayerState`, the opponent's upgrades, generators,
 * and meta are never sent (so they can't be read in devtools); each broadcast
 * carries only the values the viewer's `accessEnemyData` upgrades grant.
 */
export interface OpponentView {
  /**
   * The opponent's score. Public for timed / target-score goals (the win
   * condition, shown live); omitted for `buy-upgrade`, where score is neither
   * the win condition nor displayed.
   */
  score?: number
  /** Opponent stockpiles, keyed by resource — only keys the viewer has unlocked. */
  resources: Record<string, number>
  /** Opponent per-second production, keyed by resource — only unlocked keys. */
  rates: Record<string, number>
  /** Opponent's peak clicks-per-second; present only if the viewer unlocked CPS intel. */
  peakCps?: number
  /**
   * Opponent purchases observed since the *previous* update — a delta, not the
   * full log (oldest first). Present only if the viewer unlocked purchase intel
   * (`accessEnemyData: purchases`) and at least one new purchase occurred; each
   * event is sent exactly once and the client accumulates them into its own
   * feed. Purchases made before the unlock are never sent — never retroactive.
   */
  purchases?: PurchaseEvent[]
}

/** Periodic authoritative state snapshot. */
export interface StateUpdateMessage {
  type: 'STATE_UPDATE'
  /** Server tick counter (monotonically increasing). */
  tick: number
  /** Highest client ACTION_BATCH seq the server has processed. */
  ackSeq: number
  /** The receiving player's own state. */
  player: PlayerState
  /** A redacted view of the opponent — only the intel the viewer has unlocked. */
  opponent: OpponentView
  /** Seconds remaining in the round. */
  timeLeft: number
  /** Whether the server has paused the current match. */
  paused: boolean
}

/** Sent when a match begins (after matchmaking). */
export interface RoundStartMessage {
  type: 'ROUND_START'
  matchId: string
  /** Game configuration for this round. */
  config: {
    mode: GameMode
    goal: Goal
  }
  /** Opponent's display name (may be empty). */
  opponentName: string
  /** Whether the opponent is a bot (pause is only allowed in bot matches). */
  vsBot: boolean
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
  /**
   * Final scores. `opponent` is omitted for `buy-upgrade` goals, where the
   * opponent's score is irrelevant to the result and never revealed.
   */
  finalScores: { player: number; opponent?: number }
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
