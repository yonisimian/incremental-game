import { randomUUID } from 'node:crypto';
import WebSocket = require('ws');
import {
  BROADCAST_INTERVAL_MS,
  COUNTDOWN_SEC,
  INITIAL_PLAYER_STATE,
  MODE_CONFIGS,
  ROUND_DURATION_SEC,
  TICK_INTERVAL_MS,
} from '@game/shared';
import type {
  ClientMessage,
  GameMode,
  MatchWinner,
  ModeConfig,
  PlayerAction,
  ServerMessage,
  UpgradeDefinition,
  UpgradeId,
} from '@game/shared';
import { isValidClick, isValidPurchase } from './validation.js';

// ─── Types ───────────────────────────────────────────────────────────

interface MatchPlayer {
  readonly id: string;
  ws: WebSocket | null;
  state: {
    score: number;
    currency: number;
    upgrades: Record<UpgradeId, boolean>;
  };
  ackSeq: number;
  recentClickTimestamps: number[];
  stats: {
    totalClicks: number;
    peakCps: number;
    upgradesPurchased: UpgradeId[];
  };
}

type MatchPhase = 'countdown' | 'playing' | 'ended';

// ─── Match ───────────────────────────────────────────────────────────

export class Match {
  readonly id: string;
  readonly mode: GameMode;
  private readonly modeConfig: ModeConfig;
  private readonly upgradeMap: ReadonlyMap<UpgradeId, UpgradeDefinition>;
  private readonly players: [MatchPlayer, MatchPlayer];
  private phase: MatchPhase = 'countdown';
  private tick = 0;
  private timeLeftSec = ROUND_DURATION_SEC;

  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private broadcastTimer: ReturnType<typeof setInterval> | null = null;
  private roundTimer: ReturnType<typeof setTimeout> | null = null;
  private onEndCallback: (() => void) | null = null;

  constructor(
    p1: { id: string; ws: WebSocket },
    p2: { id: string; ws: WebSocket },
    mode: GameMode,
  ) {
    this.id = randomUUID();
    this.mode = mode;
    this.modeConfig = MODE_CONFIGS[mode];
    this.upgradeMap = new Map(this.modeConfig.upgrades.map((u) => [u.id, u]));
    this.players = [this.initPlayer(p1), this.initPlayer(p2)];
  }

  /** Register a callback invoked when the match ends. */
  onEnd(cb: () => void): void {
    this.onEndCallback = cb;
  }

  /** Get both player IDs. */
  getPlayerIds(): [string, string] {
    return [this.players[0].id, this.players[1].id];
  }

  /** Send ROUND_START to both, then begin the game loop after countdown. */
  start(): void {
    const config = {
      mode: this.mode,
      roundDurationSec: ROUND_DURATION_SEC,
      upgrades: [...this.modeConfig.upgrades],
    };

    for (const player of this.players) {
      this.send(player, {
        type: 'ROUND_START',
        matchId: this.id,
        config,
        serverTime: Date.now(),
      });
    }

    setTimeout(() => {
      if (this.phase === 'ended') return; // disconnected during countdown
      this.phase = 'playing';
      this.beginGameLoop();
    }, COUNTDOWN_SEC * 1000);
  }

  /** Route an incoming WebSocket message to the correct handler. */
  handleMessage(playerId: string, raw: string): void {
    if (this.phase !== 'playing') return;

    const player = this.players.find((p) => p.id === playerId);
    if (!player) return;

    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw) as ClientMessage;
    } catch {
      return; // malformed JSON
    }

    if (msg.type === 'ACTION_BATCH') {
      this.processActions(player, msg.actions, msg.seq);
    }
  }

  /** Handle player disconnect.
   * TODO: implement 10s grace period per DESIGN.md — currently forfeits immediately.
   */
  handleDisconnect(playerId: string): void {
    if (this.phase === 'ended') return;

    const player = this.players.find((p) => p.id === playerId);
    if (player) player.ws = null;

    this.forfeit(playerId);
  }

  // ─── Private: setup ────────────────────────────────────────────────

  private initPlayer(p: { id: string; ws: WebSocket }): MatchPlayer {
    return {
      id: p.id,
      ws: p.ws,
      state: {
        score: INITIAL_PLAYER_STATE.score,
        currency: INITIAL_PLAYER_STATE.currency,
        upgrades: { ...INITIAL_PLAYER_STATE.upgrades },
      },
      ackSeq: 0,
      recentClickTimestamps: [],
      stats: { totalClicks: 0, peakCps: 0, upgradesPurchased: [] },
    };
  }

  // ─── Private: game loop ────────────────────────────────────────────

  private beginGameLoop(): void {
    const startTime = Date.now();

    // Tick: compute passive income + update timer
    this.tickTimer = setInterval(() => {
      this.tick++;
      const elapsedSec = (Date.now() - startTime) / 1000;
      this.timeLeftSec = Math.max(0, ROUND_DURATION_SEC - elapsedSec);

      for (const player of this.players) {
        this.applyPassiveIncome(player);
      }
    }, TICK_INTERVAL_MS);

    // Broadcast authoritative state to both clients
    this.broadcastTimer = setInterval(() => {
      this.broadcastState();
    }, BROADCAST_INTERVAL_MS);

    // End the round after the full duration
    this.roundTimer = setTimeout(() => {
      this.endRound();
    }, ROUND_DURATION_SEC * 1000);
  }

  // ─── Private: action processing ────────────────────────────────────

  private processActions(
    player: MatchPlayer,
    actions: PlayerAction[],
    seq: number,
  ): void {
    for (const action of actions) {
      if (action.type === 'click') {
        if (!this.modeConfig.clicksEnabled) continue;
        if (!isValidClick(player.recentClickTimestamps)) {
          continue;
        }
        this.applyClick(player);
      } else if (action.type === 'buy' && action.upgradeId) {
        if (!isValidPurchase(player.state, action.upgradeId, this.upgradeMap)) continue;
        this.applyPurchase(player, action.upgradeId);
      }
    }
    player.ackSeq = seq;
  }

  private applyPassiveIncome(player: MatchPlayer): void {
    // Base passive income (0 for clicker, 1/sec for idler)
    let income = this.modeConfig.basePassivePerSec * (TICK_INTERVAL_MS / 1000);

    // Clicker: auto-clicker adds +1/sec
    if (player.state.upgrades['auto-clicker']) {
      income += TICK_INTERVAL_MS / 1000;
    }

    // Idler: accelerator adds +1/sec
    if (player.state.upgrades['accelerator']) {
      income += TICK_INTERVAL_MS / 1000;
    }

    // Idler: double-income doubles all passive
    if (player.state.upgrades['double-income']) income *= 2;

    // Multiplier doubles everything (both modes)
    if (player.state.upgrades['multiplier']) income *= 2;

    if (income <= 0) return;

    player.state.currency += income;
    player.state.score += income;
  }

  private applyClick(player: MatchPlayer): void {
    let income = player.state.upgrades['double-click'] ? 2 : 1;
    if (player.state.upgrades['multiplier']) income *= 2;

    player.state.currency += income;
    player.state.score += income;
    player.stats.totalClicks++;

    // Update peak CPS (recentClickTimestamps already pruned by validation)
    player.stats.peakCps = Math.max(
      player.stats.peakCps,
      player.recentClickTimestamps.length,
    );
  }

  private applyPurchase(player: MatchPlayer, upgradeId: UpgradeId): void {
    const def = this.upgradeMap.get(upgradeId)!; // already validated
    player.state.currency -= def.cost;
    player.state.upgrades[upgradeId] = true;
    player.stats.upgradesPurchased.push(upgradeId);
  }

  // ─── Private: broadcasting ─────────────────────────────────────────

  private broadcastState(): void {
    const [p1, p2] = this.players;

    this.send(p1, {
      type: 'STATE_UPDATE',
      tick: this.tick,
      ackSeq: p1.ackSeq,
      player: p1.state,
      opponent: p2.state,
      timeLeft: this.timeLeftSec,
    });

    this.send(p2, {
      type: 'STATE_UPDATE',
      tick: this.tick,
      ackSeq: p2.ackSeq,
      player: p2.state,
      opponent: p1.state,
      timeLeft: this.timeLeftSec,
    });
  }

  // ─── Private: ending ───────────────────────────────────────────────

  private endRound(): void {
    if (this.phase === 'ended') return;
    this.phase = 'ended';
    this.clearTimers();

    const [p1, p2] = this.players;
    const tie = p1.state.score === p2.state.score;
    const p1Wins = p1.state.score > p2.state.score;
    const winnerForP1: MatchWinner = tie ? 'draw' : p1Wins ? 'player' : 'opponent';
    const winnerForP2: MatchWinner = tie ? 'draw' : p1Wins ? 'opponent' : 'player';

    this.send(p1, {
      type: 'ROUND_END',
      winner: winnerForP1,
      finalScores: { player: p1.state.score, opponent: p2.state.score },
      stats: p1.stats,
    });

    this.send(p2, {
      type: 'ROUND_END',
      winner: winnerForP2,
      finalScores: { player: p2.state.score, opponent: p1.state.score },
      stats: p2.stats,
    });

    this.onEndCallback?.();
  }

  private forfeit(playerId: string): void {
    if (this.phase === 'ended') return;
    this.phase = 'ended';
    this.clearTimers();

    const winnerIdx = this.players[0].id === playerId ? 1 : 0;
    const winner = this.players[winnerIdx]!;
    const loser = this.players[1 - winnerIdx]!;

    this.send(winner, {
      type: 'ROUND_END',
      winner: 'player',
      finalScores: { player: winner.state.score, opponent: loser.state.score },
      stats: winner.stats,
    });

    this.onEndCallback?.();
  }

  private clearTimers(): void {
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.broadcastTimer) clearInterval(this.broadcastTimer);
    if (this.roundTimer) clearTimeout(this.roundTimer);
    this.tickTimer = null;
    this.broadcastTimer = null;
    this.roundTimer = null;
  }

  // ─── Private: send ─────────────────────────────────────────────────

  private send(player: MatchPlayer, msg: ServerMessage): void {
    if (player.ws && player.ws.readyState === WebSocket.OPEN) {
      player.ws.send(JSON.stringify(msg));
    }
  }
}
