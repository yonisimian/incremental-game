import type {
  GameMode,
  PlayerState,
  RoundEndMessage,
  RoundStartMessage,
  ServerMessage,
  StateUpdateMessage,
  UpgradeDefinition,
  UpgradeId,
} from '@game/shared';
import { INITIAL_PLAYER_STATE, COUNTDOWN_SEC } from '@game/shared';
import { getSeq, queueAction, resetSeq, sendModeSelect, sendQuit } from './network.js';

// ─── Types ───────────────────────────────────────────────────────────

export type Screen =
  | 'lobby'      // connected, choosing game mode
  | 'waiting'    // in queue, looking for opponent
  | 'countdown'  // matched, counting down 3-2-1
  | 'playing'    // active round
  | 'ended';     // round finished, showing results

export interface GameState {
  screen: Screen;
  /** Selected game mode. */
  mode: GameMode | null;
  /** Local player state (optimistic). */
  player: PlayerState;
  /** Opponent state (from server). */
  opponent: PlayerState;
  /** Seconds remaining this round. */
  timeLeft: number;
  /** Current match ID. */
  matchId: string | null;
  /** Upgrade definitions for this round. */
  upgrades: readonly UpgradeDefinition[];
  /** Countdown value (3, 2, 1, GO). */
  countdown: number;
  /** End-of-round data. */
  endData: RoundEndMessage | null;
}

/** Pending actions whose seq > ackSeq (for optimistic reconciliation). */
interface PendingBatch {
  seq: number;
  clicks: number;
  purchases: UpgradeId[];
}

export type StateChangeHandler = (state: Readonly<GameState>) => void;

// ─── State ───────────────────────────────────────────────────────────

const state: GameState = {
  screen: 'lobby',
  mode: null,
  player: clonePlayerState(INITIAL_PLAYER_STATE),
  opponent: clonePlayerState(INITIAL_PLAYER_STATE),
  timeLeft: 0,
  matchId: null,
  upgrades: [],
  countdown: COUNTDOWN_SEC,
  endData: null,
};

const pendingBatches: PendingBatch[] = [];
let onChange: StateChangeHandler = () => {};
let countdownTimer: ReturnType<typeof setInterval> | null = null;

// ─── Public API ──────────────────────────────────────────────────────

/** Subscribe to state changes. */
export function setStateChangeHandler(handler: StateChangeHandler): void {
  onChange = handler;
}

/** Get the current game state (read-only snapshot). */
export function getState(): Readonly<GameState> {
  return state;
}

/** Handle an incoming server message. Called by network.ts. */
export function handleServerMessage(msg: ServerMessage): void {
  switch (msg.type) {
    case 'ROUND_START':
      handleRoundStart(msg);
      break;
    case 'STATE_UPDATE':
      handleStateUpdate(msg);
      break;
    case 'ROUND_END':
      handleRoundEnd(msg);
      break;
  }
}

/** Select a game mode and enter matchmaking. */
export function selectMode(mode: GameMode): void {
  if (state.screen !== 'lobby') return;
  if (!sendModeSelect(mode)) return; // not connected — stay on lobby
  state.mode = mode;
  state.screen = 'waiting';
  notify();
}

/** Record a click action (optimistic). Clicker mode only. */
export function doClick(): void {
  if (state.screen !== 'playing') return;
  if (state.mode !== 'clicker') return;

  // Optimistic local update
  const income = computeClickIncome(state.player);
  state.player.score += income;
  state.player.currency += income;

  // Queue for server
  queueAction({ type: 'click', timestamp: Date.now() });
  trackPendingClick();
  notify();
}

/** Attempt to purchase an upgrade (optimistic). */
export function doBuy(upgradeId: UpgradeId): void {
  if (state.screen !== 'playing') return;

  const def = state.upgrades.find((u) => u.id === upgradeId);
  if (!def) return;
  if (state.player.upgrades[upgradeId]) return;
  if (state.player.currency < def.cost) return;

  // Optimistic local update
  state.player.currency -= def.cost;
  state.player.upgrades[upgradeId] = true;

  // Queue for server
  queueAction({ type: 'buy', timestamp: Date.now(), upgradeId });
  trackPendingPurchase(upgradeId);
  notify();
}

/** Voluntarily quit the current match and return to lobby. */
export function quitMatch(): void {
  if (state.screen !== 'playing' && state.screen !== 'countdown') return;
  sendQuit();
  resetForMatch();
}

/** Reset for a fresh match (e.g., rematch). */
export function resetForMatch(): void {
  state.screen = 'lobby';
  state.mode = null;
  state.player = clonePlayerState(INITIAL_PLAYER_STATE);
  state.opponent = clonePlayerState(INITIAL_PLAYER_STATE);
  state.timeLeft = 0;
  state.matchId = null;
  state.upgrades = [];
  state.countdown = COUNTDOWN_SEC;
  state.endData = null;
  pendingBatches.length = 0;
  resetSeq();
  stopCountdown();
  notify();
}

// ─── Private: message handlers ───────────────────────────────────────

function handleRoundStart(msg: RoundStartMessage): void {
  state.screen = 'countdown';
  state.matchId = msg.matchId;
  state.mode = msg.config.mode;
  state.upgrades = msg.config.upgrades;
  state.player = clonePlayerState(INITIAL_PLAYER_STATE);
  state.opponent = clonePlayerState(INITIAL_PLAYER_STATE);
  state.timeLeft = msg.config.roundDurationSec;
  state.countdown = COUNTDOWN_SEC;
  state.endData = null;
  pendingBatches.length = 0;
  resetSeq();
  notify();

  startCountdown();
}

function handleStateUpdate(msg: StateUpdateMessage): void {
  // Server state is authoritative — reconcile with pending optimistic actions
  state.opponent = msg.opponent;
  state.timeLeft = msg.timeLeft;

  // Prune acknowledged batches
  while (pendingBatches.length > 0 && pendingBatches[0]!.seq <= msg.ackSeq) {
    pendingBatches.shift();
  }

  // Start from server state, then re-apply pending optimistic actions
  const reconciled = clonePlayerState(msg.player);
  for (const batch of pendingBatches) {
    for (let i = 0; i < batch.clicks; i++) {
      const income = computeClickIncome(reconciled);
      reconciled.score += income;
      reconciled.currency += income;
    }
    for (const uid of batch.purchases) {
      const def = state.upgrades.find((u) => u.id === uid);
      if (def && !reconciled.upgrades[uid] && reconciled.currency >= def.cost) {
        reconciled.currency -= def.cost;
        reconciled.upgrades[uid] = true;
      }
    }
  }

  state.player = reconciled;
  notify();
}

function handleRoundEnd(msg: RoundEndMessage): void {
  // If WE are the quitter (reason=quit, winner=opponent), we already
  // transitioned to lobby in quitMatch(). Just ignore this message.
  if (msg.reason === 'quit' && msg.winner === 'opponent') return;

  state.screen = 'ended';
  state.endData = msg;
  state.player.score = msg.finalScores.player;
  state.opponent.score = msg.finalScores.opponent;
  pendingBatches.length = 0;
  stopCountdown();
  notify();
}

// ─── Private: optimistic tracking ────────────────────────────────────

function trackPendingClick(): void {
  const currentSeq = getSeq() + 1; // next batch will have seq+1
  let batch = pendingBatches.find((b) => b.seq === currentSeq);
  if (!batch) {
    batch = { seq: currentSeq, clicks: 0, purchases: [] };
    pendingBatches.push(batch);
  }
  batch.clicks++;
}

function trackPendingPurchase(upgradeId: UpgradeId): void {
  const currentSeq = getSeq() + 1;
  let batch = pendingBatches.find((b) => b.seq === currentSeq);
  if (!batch) {
    batch = { seq: currentSeq, clicks: 0, purchases: [] };
    pendingBatches.push(batch);
  }
  batch.purchases.push(upgradeId);
}

// ─── Private: countdown ──────────────────────────────────────────────

function startCountdown(): void {
  stopCountdown();
  countdownTimer = setInterval(() => {
    state.countdown--;
    if (state.countdown <= 0) {
      state.screen = 'playing';
      stopCountdown();
    }
    notify();
  }, 1000);
}

function stopCountdown(): void {
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
}

// ─── Private: helpers ────────────────────────────────────────────────

function computeClickIncome(player: PlayerState): number {
  let income = player.upgrades['double-click'] ? 2 : 1;
  if (player.upgrades['multiplier']) income *= 2;
  return income;
}

function clonePlayerState(s: Readonly<PlayerState>): PlayerState {
  return {
    score: s.score,
    currency: s.currency,
    upgrades: { ...s.upgrades },
  };
}

function notify(): void {
  onChange(state);
}
