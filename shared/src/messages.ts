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

/** Sent by client to select a game mode and goal (enters matchmaking). */
export interface ModeSelectMessage {
  type: 'MODE_SELECT'
  mode: GameMode
  goal: Goal
}

/** Sent by client to voluntarily quit the current match. */
export interface QuitMessage {
  type: 'QUIT'
}

/** Sent by client while in queue to request a bot opponent instead. */
export interface BotRequestMessage {
  type: 'BOT_REQUEST'
}

export type ClientMessage = ActionBatchMessage | ModeSelectMessage | QuitMessage | BotRequestMessage

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

export type ServerMessage = StateUpdateMessage | RoundStartMessage | RoundEndMessage
