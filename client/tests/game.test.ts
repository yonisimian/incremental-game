import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  RoundEndMessage,
  RoundStartMessage,
  StateUpdateMessage,
} from '@game/shared';
import { COUNTDOWN_SEC, INITIAL_PLAYER_STATE, CLICKER_UPGRADES } from '@game/shared';

// ─── Module-level mocks ──────────────────────────────────────────────

// Mock network.ts — game.ts imports getSeq, queueAction, resetSeq, sendModeSelect from it.
vi.mock('../src/network.js', () => {
  let seq = 0;
  return {
    getSeq: vi.fn(() => seq),
    queueAction: vi.fn(),
    resetSeq: vi.fn(() => { seq = 0; }),
    sendModeSelect: vi.fn(() => true),
    sendQuit: vi.fn(),
  };
});

// ─── Helpers ─────────────────────────────────────────────────────────

type GameModule = typeof import('../src/game.js');

async function loadGame(): Promise<GameModule> {
  vi.resetModules();
  return await import('../src/game.js');
}

function makeRoundStart(overrides: Partial<RoundStartMessage> = {}): RoundStartMessage {
  return {
    type: 'ROUND_START',
    matchId: 'test-match',
    config: { mode: 'clicker', roundDurationSec: 60, upgrades: [...CLICKER_UPGRADES] },
    serverTime: Date.now(),
    ...overrides,
  };
}

const defaultUpgrades = {
  'auto-clicker': false,
  'double-click': false,
  'multiplier': false,
  'accelerator': false,
  'double-income': false,
} as const;

function makeStateUpdate(overrides: Partial<StateUpdateMessage> = {}): StateUpdateMessage {
  return {
    type: 'STATE_UPDATE',
    tick: 1,
    ackSeq: 0,
    player: { score: 0, currency: 0, upgrades: { ...defaultUpgrades } },
    opponent: { score: 0, currency: 0, upgrades: { ...defaultUpgrades } },
    timeLeft: 55,
    ...overrides,
  };
}

function makeRoundEnd(overrides: Partial<RoundEndMessage> = {}): RoundEndMessage {
  return {
    type: 'ROUND_END',
    winner: 'player',
    reason: 'complete',
    finalScores: { player: 42, opponent: 10 },
    stats: { totalClicks: 30, peakCps: 8, upgradesPurchased: [] },
    ...overrides,
  };
}

/** Advance into the 'playing' state by sending ROUND_START + ticking through countdown. */
function enterPlaying(game: GameModule): void {
  game.handleServerMessage(makeRoundStart());
  vi.advanceTimersByTime(COUNTDOWN_SEC * 1000);
}

// ─── Tests ───────────────────────────────────────────────────────────

describe('game.ts', () => {
  let game: GameModule;

  beforeEach(async () => {
    vi.useFakeTimers();
    game = await loadGame();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Initial state ────────────────────────────────────────────────

  describe('initial state', () => {
    it('starts on the lobby screen', () => {
      expect(game.getState().screen).toBe('lobby');
    });

    it('has zeroed player state', () => {
      const s = game.getState();
      expect(s.player.score).toBe(0);
      expect(s.player.currency).toBe(0);
    });
  });

  // ── selectMode → waiting ─────────────────────────────────────────

  describe('selectMode', () => {
    it('transitions from lobby to waiting', () => {
      game.selectMode('clicker');
      expect(game.getState().screen).toBe('waiting');
      expect(game.getState().mode).toBe('clicker');
    });

    it('is a no-op outside lobby', () => {
      game.selectMode('clicker');
      game.selectMode('idler'); // already on waiting screen
      expect(game.getState().mode).toBe('clicker');
    });
  });

  // ── ROUND_START → countdown ──────────────────────────────────────

  describe('ROUND_START', () => {
    it('transitions to countdown screen', () => {
      game.handleServerMessage(makeRoundStart());
      expect(game.getState().screen).toBe('countdown');
    });

    it('stores matchId and upgrade definitions', () => {
      game.handleServerMessage(makeRoundStart({ matchId: 'm-123' }));
      const s = game.getState();
      expect(s.matchId).toBe('m-123');
      expect(s.upgrades.length).toBe(CLICKER_UPGRADES.length);
    });

    it('counts down from COUNTDOWN_SEC to playing', () => {
      game.handleServerMessage(makeRoundStart());
      expect(game.getState().countdown).toBe(COUNTDOWN_SEC);

      for (let i = COUNTDOWN_SEC - 1; i >= 1; i--) {
        vi.advanceTimersByTime(1000);
        expect(game.getState().countdown).toBe(i);
        expect(game.getState().screen).toBe('countdown');
      }

      vi.advanceTimersByTime(1000);
      expect(game.getState().screen).toBe('playing');
    });
  });

  // ── Clicks (optimistic) ──────────────────────────────────────────

  describe('doClick', () => {
    it('increments score and currency by 1', () => {
      enterPlaying(game);
      game.doClick();

      const s = game.getState();
      expect(s.player.score).toBe(1);
      expect(s.player.currency).toBe(1);
    });

    it('accumulates multiple clicks', () => {
      enterPlaying(game);
      game.doClick();
      game.doClick();
      game.doClick();

      expect(game.getState().player.score).toBe(3);
    });

    it('is a no-op outside playing screen', () => {
      // Still on 'lobby'
      game.doClick();
      expect(game.getState().player.score).toBe(0);
    });

    it('is a no-op in idler mode', () => {
      game.handleServerMessage(makeRoundStart({
        config: { mode: 'idler', roundDurationSec: 60, upgrades: [] },
      }));
      vi.advanceTimersByTime(COUNTDOWN_SEC * 1000);
      expect(game.getState().screen).toBe('playing');

      game.doClick();
      expect(game.getState().player.score).toBe(0);
    });

    it('notifies the state change handler', () => {
      enterPlaying(game);
      const spy = vi.fn();
      game.setStateChangeHandler(spy);
      spy.mockClear();

      game.doClick();
      expect(spy).toHaveBeenCalledOnce();
    });
  });

  // ── Purchases (optimistic) ───────────────────────────────────────

  describe('doBuy', () => {
    it('deducts currency and grants upgrade', () => {
      enterPlaying(game);
      // auto-clicker costs 10 — earn enough
      for (let i = 0; i < 10; i++) game.doClick();

      game.doBuy('auto-clicker');
      const s = game.getState();
      expect(s.player.upgrades['auto-clicker']).toBe(true);
      expect(s.player.currency).toBe(0);
      expect(s.player.score).toBe(10); // score unchanged by purchase
    });

    it('rejects if not enough currency', () => {
      enterPlaying(game);
      game.doClick(); // 1 currency

      game.doBuy('auto-clicker'); // costs 10
      expect(game.getState().player.upgrades['auto-clicker']).toBe(false);
      expect(game.getState().player.currency).toBe(1);
    });

    it('rejects a duplicate purchase', () => {
      enterPlaying(game);
      for (let i = 0; i < 20; i++) game.doClick();

      game.doBuy('auto-clicker'); // costs 10
      game.doBuy('auto-clicker'); // duplicate
      expect(game.getState().player.currency).toBe(10); // 20 − 10, not 20 − 20
    });

    it('is a no-op outside playing screen', () => {
      game.doBuy('auto-clicker');
      expect(game.getState().player.upgrades['auto-clicker']).toBe(false);
    });
  });

  // ── Upgrade effects on click income ──────────────────────────────

  describe('upgrade effects on clicks', () => {
    it('double-click gives +2 per click', () => {
      enterPlaying(game);
      for (let i = 0; i < 25; i++) game.doClick();
      game.doBuy('double-click'); // costs 25

      const before = game.getState().player.score;
      game.doClick();
      expect(game.getState().player.score - before).toBe(2);
    });

    it('multiplier doubles click income', () => {
      enterPlaying(game);
      for (let i = 0; i < 100; i++) game.doClick();
      game.doBuy('multiplier'); // costs 100

      const before = game.getState().player.score;
      game.doClick();
      expect(game.getState().player.score - before).toBe(2); // 1 * 2
    });

    it('double-click + multiplier gives +4 per click', () => {
      enterPlaying(game);
      // earn 125 currency (25 + 100)
      for (let i = 0; i < 125; i++) game.doClick();
      game.doBuy('double-click');
      game.doBuy('multiplier');

      const before = game.getState().player.score;
      game.doClick();
      expect(game.getState().player.score - before).toBe(4); // 2 * 2
    });
  });

  // ── STATE_UPDATE reconciliation ──────────────────────────────────

  describe('STATE_UPDATE', () => {
    it('adopts server state when no pending actions', () => {
      enterPlaying(game);
      game.handleServerMessage(makeStateUpdate({
        ackSeq: 0,
        player: { score: 5, currency: 5, upgrades: { ...defaultUpgrades } },
        opponent: { score: 3, currency: 3, upgrades: { ...defaultUpgrades } },
        timeLeft: 50,
      }));

      const s = game.getState();
      expect(s.player.score).toBe(5);
      expect(s.opponent.score).toBe(3);
      expect(s.timeLeft).toBe(50);
    });

    it('replays unacked clicks on top of server state', () => {
      enterPlaying(game);
      // 3 optimistic clicks → score=3, currency=3
      game.doClick();
      game.doClick();
      game.doClick();

      // Server acks 0 of them (ackSeq=0), server sees score=0
      game.handleServerMessage(makeStateUpdate({
        ackSeq: 0,
        player: { score: 0, currency: 0, upgrades: { ...defaultUpgrades } },
      }));

      // Reconciled: server(0) + 3 pending clicks = 3
      expect(game.getState().player.score).toBe(3);
    });

    it('drops acknowledged batches', () => {
      enterPlaying(game);
      game.doClick();
      game.doClick();

      // Server acks all pending batches and reports score=2
      game.handleServerMessage(makeStateUpdate({
        ackSeq: 999, // acks everything
        player: { score: 2, currency: 2, upgrades: { ...defaultUpgrades } },
      }));

      // No pending → adopts server state exactly
      expect(game.getState().player.score).toBe(2);
    });
  });

  // ── ROUND_END ────────────────────────────────────────────────────

  describe('ROUND_END', () => {
    it('transitions to ended screen', () => {
      enterPlaying(game);
      game.handleServerMessage(makeRoundEnd());
      expect(game.getState().screen).toBe('ended');
    });

    it('stores end data', () => {
      enterPlaying(game);
      game.handleServerMessage(makeRoundEnd({ winner: 'opponent' }));
      expect(game.getState().endData!.winner).toBe('opponent');
    });

    it('sets final scores from server', () => {
      enterPlaying(game);
      game.handleServerMessage(makeRoundEnd({
        finalScores: { player: 100, opponent: 50 },
      }));
      expect(game.getState().player.score).toBe(100);
      expect(game.getState().opponent.score).toBe(50);
    });
  });

  // ── resetForMatch ────────────────────────────────────────────────

  describe('resetForMatch', () => {
    it('resets to lobby screen with clean state', () => {
      enterPlaying(game);
      game.doClick();
      game.resetForMatch();

      const s = game.getState();
      expect(s.screen).toBe('lobby');
      expect(s.mode).toBeNull();
      expect(s.player.score).toBe(0);
      expect(s.player.currency).toBe(0);
      expect(s.matchId).toBeNull();
      expect(s.endData).toBeNull();
      expect(s.countdown).toBe(COUNTDOWN_SEC);
    });
  });

  // ── cancelQueue ────────────────────────────────────────────────────

  describe('cancelQueue', () => {
    it('transitions from waiting to lobby', async () => {
      game.selectMode('clicker');
      expect(game.getState().screen).toBe('waiting');
      game.cancelQueue();
      expect(game.getState().screen).toBe('lobby');
      const { sendQuit } = await import('../src/network.js');
      expect(vi.mocked(sendQuit)).toHaveBeenCalledOnce();
    });

    it('is a no-op on lobby screen', () => {
      game.cancelQueue();
      expect(game.getState().screen).toBe('lobby');
    });

    it('is a no-op on playing screen', () => {
      enterPlaying(game);
      game.cancelQueue();
      expect(game.getState().screen).toBe('playing');
    });
  });

  // ── quitMatch ──────────────────────────────────────────────────────

  describe('quitMatch', () => {
    it('transitions to lobby from playing', async () => {
      enterPlaying(game);
      const { sendQuit } = await import('../src/network.js');
      vi.mocked(sendQuit).mockClear();
      game.quitMatch();
      expect(game.getState().screen).toBe('lobby');
      expect(vi.mocked(sendQuit)).toHaveBeenCalledOnce();
    });

    it('transitions to lobby from countdown', () => {
      game.handleServerMessage(makeRoundStart());
      expect(game.getState().screen).toBe('countdown');
      game.quitMatch();
      expect(game.getState().screen).toBe('lobby');
    });

    it('is a no-op on lobby screen', () => {
      game.quitMatch();
      expect(game.getState().screen).toBe('lobby');
    });
  });

  // ── ROUND_END reason handling ──────────────────────────────────────

  describe('ROUND_END reason', () => {
    it('ignores quit message when user is the quitter', () => {
      enterPlaying(game);
      // Simulate: we quit, server tells us we lost
      game.handleServerMessage(makeRoundEnd({ reason: 'quit', winner: 'opponent' }));
      // Should be ignored since quitMatch() already moved us to lobby
      // Here we test that handleRoundEnd doesn't move to ended screen
      // (in real flow, quitMatch resets to lobby before this arrives)
      expect(game.getState().screen).toBe('playing'); // not ended
    });

    it('shows ended screen when opponent quits', () => {
      enterPlaying(game);
      game.handleServerMessage(makeRoundEnd({ reason: 'quit', winner: 'player' }));
      expect(game.getState().screen).toBe('ended');
      expect(game.getState().endData!.reason).toBe('quit');
    });

    it('shows ended screen on forfeit', () => {
      enterPlaying(game);
      game.handleServerMessage(makeRoundEnd({ reason: 'forfeit', winner: 'player' }));
      expect(game.getState().screen).toBe('ended');
      expect(game.getState().endData!.reason).toBe('forfeit');
    });
  });
});
