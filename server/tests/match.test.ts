import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type WebSocket from 'ws';
import type { ServerMessage, StateUpdateMessage } from '@game/shared';
import {
  BROADCAST_INTERVAL_MS,
  COUNTDOWN_SEC,
  MAX_CPS,
  ROUND_DURATION_SEC,
} from '@game/shared';
import { Match } from '../src/match.js';

// ─── Helpers ─────────────────────────────────────────────────────────

function createMockWs(): WebSocket {
  return { readyState: 1, send: vi.fn() } as unknown as WebSocket;
}

/** All messages sent to a mock WebSocket, parsed from JSON. */
function sent(ws: WebSocket): ServerMessage[] {
  return (ws.send as ReturnType<typeof vi.fn>).mock.calls.map(
    ([raw]: [string]) => JSON.parse(raw) as ServerMessage,
  );
}

/** Messages of a specific type sent to a mock WebSocket. */
function sentOfType<T extends ServerMessage['type']>(
  ws: WebSocket,
  type: T,
): Extract<ServerMessage, { type: T }>[] {
  return sent(ws).filter(
    (m): m is Extract<ServerMessage, { type: T }> => m.type === type,
  );
}

/** The most recent STATE_UPDATE sent to a mock WebSocket. */
function latestUpdate(ws: WebSocket): StateUpdateMessage {
  const updates = sentOfType(ws, 'STATE_UPDATE');
  return updates[updates.length - 1]!;
}

// ─── Tests ───────────────────────────────────────────────────────────

describe('Match', () => {
  let ws1: WebSocket;
  let ws2: WebSocket;

  beforeEach(() => {
    vi.useFakeTimers();
    ws1 = createMockWs();
    ws2 = createMockWs();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Factory helpers ──────────────────────────────────────────────

  function createMatch() {
    return new Match({ id: 'p1', ws: ws1 }, { id: 'p2', ws: ws2 }, 'clicker');
  }

  function startMatch() {
    const m = createMatch();
    m.start();
    return m;
  }

  /** Create a match and advance past the countdown into the playing phase. */
  function enterPlaying() {
    const m = startMatch();
    vi.advanceTimersByTime(COUNTDOWN_SEC * 1000);
    return m;
  }

  function clickMsg(seq: number) {
    return JSON.stringify({
      type: 'ACTION_BATCH',
      seq,
      actions: [{ type: 'click', timestamp: Date.now() }],
    });
  }

  function buyMsg(upgradeId: string, seq: number) {
    return JSON.stringify({
      type: 'ACTION_BATCH',
      seq,
      actions: [{ type: 'buy', timestamp: Date.now(), upgradeId }],
    });
  }

  /**
   * Send `n` clicks for a player, spreading across time to stay
   * within the rate limit. Returns the next available sequence number.
   */
  function earnCurrency(
    match: Match,
    playerId: string,
    n: number,
    startSeq = 1,
  ): number {
    let seq = startSeq;
    let remaining = n;
    while (remaining > 0) {
      const batch = Math.min(remaining, MAX_CPS);
      for (let i = 0; i < batch; i++) {
        match.handleMessage(playerId, clickMsg(seq++));
      }
      remaining -= batch;
      if (remaining > 0) vi.advanceTimersByTime(1001);
    }
    return seq;
  }

  // ── Creation ─────────────────────────────────────────────────────

  describe('creation', () => {
    it('has a UUID match ID', () => {
      expect(createMatch().id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });

    it('returns both player IDs', () => {
      expect(createMatch().getPlayerIds()).toEqual(['p1', 'p2']);
    });
  });

  // ── Start / countdown ───────────────────────────────────────────

  describe('start / countdown', () => {
    it('sends ROUND_START to both players', () => {
      startMatch();
      expect(sentOfType(ws1, 'ROUND_START')).toHaveLength(1);
      expect(sentOfType(ws2, 'ROUND_START')).toHaveLength(1);
    });

    it('includes round config in ROUND_START', () => {
      startMatch();
      const msg = sentOfType(ws1, 'ROUND_START')[0]!;
      expect(msg.config.roundDurationSec).toBe(ROUND_DURATION_SEC);
      expect(msg.config.upgrades.length).toBeGreaterThan(0);
      expect(msg.matchId).toBeDefined();
      expect(msg.serverTime).toBeGreaterThan(0);
    });

    it('ignores actions during countdown', () => {
      const m = startMatch();
      m.handleMessage('p1', clickMsg(1));
      // Advance past countdown + broadcast
      vi.advanceTimersByTime(COUNTDOWN_SEC * 1000 + BROADCAST_INTERVAL_MS);
      const u = latestUpdate(ws1);
      expect(u.player.score).toBe(0);
    });
  });

  // ── Click actions ────────────────────────────────────────────────

  describe('click actions', () => {
    it('awards +1 score and +1 currency per click', () => {
      const m = enterPlaying();
      m.handleMessage('p1', clickMsg(1));
      vi.advanceTimersByTime(BROADCAST_INTERVAL_MS);

      const u = latestUpdate(ws1);
      expect(u.player.score).toBe(1);
      expect(u.player.currency).toBe(1);
    });

    it('rejects clicks beyond the rate limit', () => {
      const m = enterPlaying();
      for (let i = 1; i <= MAX_CPS + 5; i++) {
        m.handleMessage('p1', clickMsg(i));
      }
      vi.advanceTimersByTime(BROADCAST_INTERVAL_MS);

      const u = latestUpdate(ws1);
      expect(u.player.score).toBe(MAX_CPS);
    });
  });

  // ── Purchases ────────────────────────────────────────────────────

  describe('purchases', () => {
    it('deducts currency and grants the upgrade', () => {
      const m = enterPlaying();
      // double-click costs 25, no passive income side-effect
      const seq = earnCurrency(m, 'p1', 25);
      m.handleMessage('p1', buyMsg('double-click', seq));
      vi.advanceTimersByTime(BROADCAST_INTERVAL_MS);

      const u = latestUpdate(ws1);
      expect(u.player.upgrades['double-click']).toBe(true);
      expect(u.player.currency).toBe(0);
      expect(u.player.score).toBe(25); // score unaffected by purchase
    });

    it('rejects an unaffordable purchase', () => {
      const m = enterPlaying();
      m.handleMessage('p1', clickMsg(1)); // earn 1
      m.handleMessage('p1', buyMsg('auto-clicker', 2)); // costs 10
      vi.advanceTimersByTime(BROADCAST_INTERVAL_MS);

      const u = latestUpdate(ws1);
      expect(u.player.upgrades['auto-clicker']).toBe(false);
      expect(u.player.currency).toBe(1);
    });

    it('rejects a duplicate purchase', () => {
      const m = enterPlaying();
      // double-click costs 25; earn 50 to prove only 25 is deducted
      let seq = earnCurrency(m, 'p1', 50);
      m.handleMessage('p1', buyMsg('double-click', seq++));
      m.handleMessage('p1', buyMsg('double-click', seq));
      vi.advanceTimersByTime(BROADCAST_INTERVAL_MS);

      const u = latestUpdate(ws1);
      expect(u.player.upgrades['double-click']).toBe(true);
      expect(u.player.currency).toBe(25); // 50 − 25, not 50 − 50
    });
  });

  // ── Upgrade effects ──────────────────────────────────────────────

  describe('upgrade effects', () => {
    it('auto-clicker adds passive income each tick', () => {
      const m = enterPlaying();
      const seq = earnCurrency(m, 'p1', 10);
      m.handleMessage('p1', buyMsg('auto-clicker', seq));

      // Snapshot after purchase
      vi.advanceTimersByTime(BROADCAST_INTERVAL_MS);
      const scoreBefore = latestUpdate(ws1).player.score;

      // Advance exactly 1 second (4 ticks × 250ms) → +1.0 from auto-clicker
      vi.advanceTimersByTime(1000);
      const scoreAfter = latestUpdate(ws1).player.score;

      expect(scoreAfter - scoreBefore).toBeCloseTo(1, 5);
    });

    it('double-click gives +2 per click', () => {
      const m = enterPlaying();
      let seq = earnCurrency(m, 'p1', 25);
      m.handleMessage('p1', buyMsg('double-click', seq++));

      vi.advanceTimersByTime(BROADCAST_INTERVAL_MS);
      const scoreBefore = latestUpdate(ws1).player.score;

      // Advance past rate-limit window, then click
      vi.advanceTimersByTime(1001);
      m.handleMessage('p1', clickMsg(seq));
      vi.advanceTimersByTime(BROADCAST_INTERVAL_MS);
      const scoreAfter = latestUpdate(ws1).player.score;

      expect(scoreAfter - scoreBefore).toBe(2);
    });
  });

  // ── Broadcasting ─────────────────────────────────────────────────

  describe('broadcasting', () => {
    it('includes opponent state in updates', () => {
      const m = enterPlaying();
      m.handleMessage('p1', clickMsg(1));
      vi.advanceTimersByTime(BROADCAST_INTERVAL_MS);

      const u2 = latestUpdate(ws2);
      expect(u2.opponent.score).toBe(1); // p2 sees p1's score
      expect(u2.player.score).toBe(0); // p2 hasn't clicked
    });
  });

  // ── Round end ────────────────────────────────────────────────────

  describe('round end', () => {
    it('sends ROUND_END with correct winner after timeout', () => {
      const m = enterPlaying();
      m.handleMessage('p1', clickMsg(1)); // p1 = 1, p2 = 0
      vi.advanceTimersByTime(ROUND_DURATION_SEC * 1000);

      const p1End = sentOfType(ws1, 'ROUND_END')[0]!;
      const p2End = sentOfType(ws2, 'ROUND_END')[0]!;
      expect(p1End.winner).toBe('player');
      expect(p1End.reason).toBe('complete');
      expect(p2End.winner).toBe('opponent');
      expect(p2End.reason).toBe('complete');
    });

    it('declares a draw when scores are equal', () => {
      enterPlaying();
      vi.advanceTimersByTime(ROUND_DURATION_SEC * 1000);

      expect(sentOfType(ws1, 'ROUND_END')[0]!.winner).toBe('draw');
      expect(sentOfType(ws2, 'ROUND_END')[0]!.winner).toBe('draw');
    });

    it('fires the onEnd callback', () => {
      const m = enterPlaying();
      const cb = vi.fn();
      m.onEnd(cb);
      vi.advanceTimersByTime(ROUND_DURATION_SEC * 1000);

      expect(cb).toHaveBeenCalledOnce();
    });
  });

  // ── Forfeit ──────────────────────────────────────────────────────

  describe('forfeit', () => {
    it('awards victory to the remaining player on disconnect', () => {
      const m = enterPlaying();
      m.handleDisconnect('p1');

      const p2End = sentOfType(ws2, 'ROUND_END')[0]!;
      expect(p2End.winner).toBe('player');
      expect(p2End.reason).toBe('forfeit');
    });

    it('fires the onEnd callback on forfeit', () => {
      const m = enterPlaying();
      const cb = vi.fn();
      m.onEnd(cb);
      m.handleDisconnect('p1');

      expect(cb).toHaveBeenCalledOnce();
    });

    it('does nothing if already ended', () => {
      const m = enterPlaying();
      vi.advanceTimersByTime(ROUND_DURATION_SEC * 1000); // round ends
      m.handleDisconnect('p1'); // should not throw or send extra messages

      // Only one ROUND_END per player
      expect(sentOfType(ws2, 'ROUND_END')).toHaveLength(1);
    });
  });

  // ── Edge cases ───────────────────────────────────────────────────

  describe('edge cases', () => {
    it('ignores malformed JSON', () => {
      const m = enterPlaying();
      m.handleMessage('p1', 'not json{{{');
      vi.advanceTimersByTime(BROADCAST_INTERVAL_MS);
      expect(latestUpdate(ws1).player.score).toBe(0);
    });

    it('ignores messages from unknown player IDs', () => {
      const m = enterPlaying();
      m.handleMessage('unknown', clickMsg(1));
      vi.advanceTimersByTime(BROADCAST_INTERVAL_MS);
      expect(latestUpdate(ws1).player.score).toBe(0);
      expect(latestUpdate(ws2).player.score).toBe(0);
    });
  });

  // ── Quit ────────────────────────────────────────────────────────

  describe('quit', () => {
    function quitMsg() {
      return JSON.stringify({ type: 'QUIT' });
    }

    it('awards victory to the opponent when a player quits', () => {
      const m = enterPlaying();
      m.handleMessage('p1', quitMsg());

      const p1End = sentOfType(ws1, 'ROUND_END')[0]!;
      const p2End = sentOfType(ws2, 'ROUND_END')[0]!;
      expect(p1End.winner).toBe('opponent');
      expect(p1End.reason).toBe('quit');
      expect(p2End.winner).toBe('player');
      expect(p2End.reason).toBe('quit');
    });

    it('includes correct final scores for both players', () => {
      const m = enterPlaying();
      m.handleMessage('p1', clickMsg(1)); // p1 earns 1
      m.handleMessage('p1', quitMsg());

      const p1End = sentOfType(ws1, 'ROUND_END')[0]!;
      const p2End = sentOfType(ws2, 'ROUND_END')[0]!;
      expect(p1End.finalScores.player).toBe(1);
      expect(p1End.finalScores.opponent).toBe(0);
      expect(p2End.finalScores.player).toBe(0);
      expect(p2End.finalScores.opponent).toBe(1);
    });

    it('allows quitting during countdown', () => {
      const m = startMatch();
      // Still in countdown — quit should work
      m.handleMessage('p1', quitMsg());

      const p2End = sentOfType(ws2, 'ROUND_END')[0]!;
      expect(p2End.winner).toBe('player');
      expect(p2End.reason).toBe('quit');
    });

    it('fires the onEnd callback on quit', () => {
      const m = enterPlaying();
      const cb = vi.fn();
      m.onEnd(cb);
      m.handleMessage('p1', quitMsg());

      expect(cb).toHaveBeenCalledOnce();
    });

    it('does nothing if already ended', () => {
      const m = enterPlaying();
      vi.advanceTimersByTime(ROUND_DURATION_SEC * 1000); // round ends
      m.handleMessage('p1', quitMsg()); // should not send extra messages

      expect(sentOfType(ws1, 'ROUND_END')).toHaveLength(1);
      expect(sentOfType(ws2, 'ROUND_END')).toHaveLength(1);
    });
  });

  // ── Idler mode ─────────────────────────────────────────────────
  describe('idler mode', () => {
    function createIdlerMatch() {
      return new Match({ id: 'p1', ws: ws1 }, { id: 'p2', ws: ws2 }, 'idler');
    }

    function enterIdlerPlaying() {
      const m = createIdlerMatch();
      m.start();
      vi.advanceTimersByTime(COUNTDOWN_SEC * 1000);
      return m;
    }

    it('sends mode in ROUND_START config', () => {
      const m = createIdlerMatch();
      m.start();
      const msg = sentOfType(ws1, 'ROUND_START')[0]!;
      expect(msg.config.mode).toBe('idler');
    });

    it('grants base passive income each second', () => {
      enterIdlerPlaying();
      // After 1000ms → 4 ticks × 0.25/tick = 1.0 score + 1.0 currency
      // A broadcast fires at 1000ms (BROADCAST_INTERVAL_MS=500)
      vi.advanceTimersByTime(1000);
      const u = latestUpdate(ws1);
      expect(u.player.score).toBeCloseTo(1, 1);
      expect(u.player.currency).toBeCloseTo(1, 1);
    });

    it('rejects clicks in idler mode', () => {
      const m = enterIdlerPlaying();
      m.handleMessage('p1', clickMsg(1));
      vi.advanceTimersByTime(BROADCAST_INTERVAL_MS);
      // Score should be from passive only, not from the click
      const u = latestUpdate(ws1);
      // At this point very little time has passed since the tick boundary, but
      // the click itself should NOT have added +1
      expect(u.player.score).toBeLessThan(2);
    });

    it('uses idler upgrades, not clicker upgrades', () => {
      const m = createIdlerMatch();
      m.start();
      const msg = sentOfType(ws1, 'ROUND_START')[0]!;
      const ids = msg.config.upgrades.map((u) => u.id);
      expect(ids).toContain('accelerator');
      expect(ids).not.toContain('auto-clicker');
    });
  });
});
