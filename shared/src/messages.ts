import type {
  MatchWinner,
  PlayerAction,
  PlayerState,
  UpgradeDefinition,
  UpgradeId,
} from './types.js';

// ─── Client → Server ────────────────────────────────────────────────

/** Batched player actions sent from client to server. */
export interface ActionBatchMessage {
  type: 'ACTION_BATCH';
  /** Monotonically increasing sequence number per client. */
  seq: number;
  actions: PlayerAction[];
}

export type ClientMessage = ActionBatchMessage;

// ─── Server → Client ────────────────────────────────────────────────

/** Periodic authoritative state snapshot. */
export interface StateUpdateMessage {
  type: 'STATE_UPDATE';
  /** Server tick counter (monotonically increasing). */
  tick: number;
  /** Highest client ACTION_BATCH seq the server has processed. */
  ackSeq: number;
  /** The receiving player's own state. */
  player: PlayerState;
  /** The opponent's state (full visibility). */
  opponent: PlayerState;
  /** Seconds remaining in the round. */
  timeLeft: number;
}

/** Sent when a match begins (after matchmaking). */
export interface RoundStartMessage {
  type: 'ROUND_START';
  matchId: string;
  /** Game configuration for this round. */
  config: {
    roundDurationSec: number;
    upgrades: readonly UpgradeDefinition[];
  };
  /** Server timestamp (ms) for clock synchronization. */
  serverTime: number;
}

/** Sent when the round timer expires. */
export interface RoundEndMessage {
  type: 'ROUND_END';
  winner: MatchWinner;
  finalScores: { player: number; opponent: number };
  stats: {
    totalClicks: number;
    peakCps: number;
    upgradesPurchased: UpgradeId[];
  };
}

export type ServerMessage =
  | StateUpdateMessage
  | RoundStartMessage
  | RoundEndMessage;
