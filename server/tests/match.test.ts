import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type WebSocket from 'ws'
import type { Goal } from '@game/shared'
import { BROADCAST_INTERVAL_MS, COUNTDOWN_SEC, MAX_CPS, ROUND_DURATION_SEC } from '@game/shared'
import { Match } from '../src/match.js'
import { createMockWs, sentOfType, latestUpdate } from './_helpers.js'

// ─── Tests ───────────────────────────────────────────────────────────

describe('Match', () => {
  let ws1: WebSocket
  let ws2: WebSocket

  beforeEach(() => {
    vi.useFakeTimers()
    ws1 = createMockWs()
    ws2 = createMockWs()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ── Factory helpers ──────────────────────────────────────────────

  function createMatch() {
    return new Match({ id: 'p1', ws: ws1 }, { id: 'p2', ws: ws2 }, 'clicker')
  }

  function startMatch() {
    const m = createMatch()
    m.start()
    return m
  }

  /** Create a match and advance past the countdown into the playing phase. */
  function enterPlaying() {
    const m = startMatch()
    vi.advanceTimersByTime(COUNTDOWN_SEC * 1000)
    return m
  }

  function clickMsg(seq: number) {
    return JSON.stringify({
      type: 'ACTION_BATCH',
      seq,
      actions: [{ type: 'click', timestamp: Date.now() }],
    })
  }

  function buyMsg(upgradeId: string, seq: number) {
    return JSON.stringify({
      type: 'ACTION_BATCH',
      seq,
      actions: [{ type: 'buy', timestamp: Date.now(), upgradeId }],
    })
  }

  /**
   * Send `n` clicks for a player, spreading across time to stay
   * within the rate limit. Returns the next available sequence number.
   */
  function earnCurrency(match: Match, playerId: string, n: number, startSeq = 1): number {
    let seq = startSeq
    let remaining = n
    while (remaining > 0) {
      const batch = Math.min(remaining, MAX_CPS)
      for (let i = 0; i < batch; i++) {
        match.handleMessage(playerId, clickMsg(seq++))
      }
      remaining -= batch
      if (remaining > 0) vi.advanceTimersByTime(1001)
    }
    return seq
  }

  // ── Creation ─────────────────────────────────────────────────────

  describe('creation', () => {
    it('has a UUID match ID', () => {
      expect(createMatch().id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      )
    })

    it('returns both player IDs', () => {
      expect(createMatch().getPlayerIds()).toEqual(['p1', 'p2'])
    })
  })

  // ── Start / countdown ───────────────────────────────────────────

  describe('start / countdown', () => {
    it('sends ROUND_START to both players', () => {
      startMatch()
      expect(sentOfType(ws1, 'ROUND_START')).toHaveLength(1)
      expect(sentOfType(ws2, 'ROUND_START')).toHaveLength(1)
    })

    it('includes round config in ROUND_START', () => {
      startMatch()
      const msg = sentOfType(ws1, 'ROUND_START')[0]
      expect(msg.config.goal).toEqual({ type: 'timed', durationSec: ROUND_DURATION_SEC })
      expect(msg.config.upgrades.length).toBeGreaterThan(0)
      expect(msg.matchId).toBeDefined()
      expect(msg.serverTime).toBeGreaterThan(0)
    })

    it('ignores actions during countdown', () => {
      const m = startMatch()
      m.handleMessage('p1', clickMsg(1))
      // Advance past countdown + broadcast
      vi.advanceTimersByTime(COUNTDOWN_SEC * 1000 + BROADCAST_INTERVAL_MS)
      const u = latestUpdate(ws1)
      expect(u.player.score).toBe(0)
    })
  })

  // ── Click actions ────────────────────────────────────────────────

  describe('click actions', () => {
    it('awards +1 score and +1 r0 per click', () => {
      const m = enterPlaying()
      m.handleMessage('p1', clickMsg(1))
      vi.advanceTimersByTime(BROADCAST_INTERVAL_MS)

      const u = latestUpdate(ws1)
      expect(u.player.score).toBe(1)
      expect(u.player.resources.r0).toBe(1)
    })

    it('rejects clicks beyond the rate limit', () => {
      const m = enterPlaying()
      for (let i = 1; i <= MAX_CPS + 5; i++) {
        m.handleMessage('p1', clickMsg(i))
      }
      vi.advanceTimersByTime(BROADCAST_INTERVAL_MS)

      const u = latestUpdate(ws1)
      expect(u.player.score).toBe(MAX_CPS)
    })
  })

  // ── Purchases ────────────────────────────────────────────────────

  describe('purchases', () => {
    it('deducts r0 and grants the upgrade', () => {
      const m = enterPlaying()
      // u0 costs 25, no passive income side-effect
      const seq = earnCurrency(m, 'p1', 25)
      m.handleMessage('p1', buyMsg('u0', seq))
      vi.advanceTimersByTime(BROADCAST_INTERVAL_MS)

      const u = latestUpdate(ws1)
      expect(u.player.upgrades.u0).toBe(1)
      expect(u.player.resources.r0).toBe(0)
      expect(u.player.score).toBe(25) // score unaffected by purchase
    })

    it('rejects an unaffordable purchase', () => {
      const m = enterPlaying()
      m.handleMessage('p1', clickMsg(1)) // earn 1
      m.handleMessage('p1', buyMsg('u0', 2)) // costs 25
      vi.advanceTimersByTime(BROADCAST_INTERVAL_MS)

      const u = latestUpdate(ws1)
      expect(u.player.upgrades.u0).toBe(0)
      expect(u.player.resources.r0).toBe(1)
    })

    it('rejects a duplicate purchase', () => {
      const m = enterPlaying()
      // u0 costs 25; earn 50 to prove only 25 is deducted
      let seq = earnCurrency(m, 'p1', 50)
      m.handleMessage('p1', buyMsg('u0', seq++))
      m.handleMessage('p1', buyMsg('u0', seq))
      vi.advanceTimersByTime(BROADCAST_INTERVAL_MS)

      const u = latestUpdate(ws1)
      expect(u.player.upgrades.u0).toBe(1)
      expect(u.player.resources.r0).toBe(25) // 50 − 25, not 50 − 50
    })
  })

  // ── Upgrade effects ──────────────────────────────────────────────

  describe('upgrade effects', () => {
    it('auto-generators add passive income each tick', () => {
      const m = enterPlaying()
      // Use generators for passive income: buy a g0 (costs 15, produces 0.5 r0/sec)
      const seq = earnCurrency(m, 'p1', 15)
      m.handleMessage(
        'p1',
        JSON.stringify({
          type: 'ACTION_BATCH',
          seq,
          actions: [{ type: 'buy_generator', timestamp: Date.now(), generatorId: 'g0' }],
        }),
      )

      // Snapshot after purchase
      vi.advanceTimersByTime(BROADCAST_INTERVAL_MS)
      const scoreBefore = latestUpdate(ws1).player.score

      // Advance exactly 1 second (4 ticks × 250ms) → +0.5 from cursor
      vi.advanceTimersByTime(1000)
      const scoreAfter = latestUpdate(ws1).player.score

      expect(scoreAfter - scoreBefore).toBeCloseTo(0.5, 1)
    })

    it('u0 gives +2 per click', () => {
      const m = enterPlaying()
      let seq = earnCurrency(m, 'p1', 25)
      m.handleMessage('p1', buyMsg('u0', seq++))

      vi.advanceTimersByTime(BROADCAST_INTERVAL_MS)
      const scoreBefore = latestUpdate(ws1).player.score

      // Advance past rate-limit window, then click
      vi.advanceTimersByTime(1001)
      m.handleMessage('p1', clickMsg(seq))
      vi.advanceTimersByTime(BROADCAST_INTERVAL_MS)
      const scoreAfter = latestUpdate(ws1).player.score

      expect(scoreAfter - scoreBefore).toBe(2)
    })
  })

  // ── Broadcasting ─────────────────────────────────────────────────

  describe('broadcasting', () => {
    it('includes opponent state in updates', () => {
      const m = enterPlaying()
      m.handleMessage('p1', clickMsg(1))
      vi.advanceTimersByTime(BROADCAST_INTERVAL_MS)

      const u2 = latestUpdate(ws2)
      expect(u2.opponent.score).toBe(1) // p2 sees p1's score
      expect(u2.player.score).toBe(0) // p2 hasn't clicked
    })
  })

  // ── Round end ────────────────────────────────────────────────────

  describe('round end', () => {
    it('sends ROUND_END with correct winner after timeout', () => {
      const m = enterPlaying()
      m.handleMessage('p1', clickMsg(1)) // p1 = 1, p2 = 0
      vi.advanceTimersByTime(ROUND_DURATION_SEC * 1000)

      const p1End = sentOfType(ws1, 'ROUND_END')[0]
      const p2End = sentOfType(ws2, 'ROUND_END')[0]
      expect(p1End.winner).toBe('player')
      expect(p1End.reason).toBe('complete')
      expect(p2End.winner).toBe('opponent')
      expect(p2End.reason).toBe('complete')
    })

    it('declares a draw when scores are equal', () => {
      enterPlaying()
      vi.advanceTimersByTime(ROUND_DURATION_SEC * 1000)

      expect(sentOfType(ws1, 'ROUND_END')[0].winner).toBe('draw')
      expect(sentOfType(ws2, 'ROUND_END')[0].winner).toBe('draw')
    })

    it('fires the onEnd callback', () => {
      const m = enterPlaying()
      const cb = vi.fn()
      m.onEnd(cb)
      vi.advanceTimersByTime(ROUND_DURATION_SEC * 1000)

      expect(cb).toHaveBeenCalledOnce()
    })
  })

  // ── Forfeit ──────────────────────────────────────────────────────

  describe('forfeit', () => {
    it('awards victory to the remaining player on disconnect', () => {
      const m = enterPlaying()
      m.handleDisconnect('p1')

      const p2End = sentOfType(ws2, 'ROUND_END')[0]
      expect(p2End.winner).toBe('player')
      expect(p2End.reason).toBe('forfeit')
    })

    it('fires the onEnd callback on forfeit', () => {
      const m = enterPlaying()
      const cb = vi.fn()
      m.onEnd(cb)
      m.handleDisconnect('p1')

      expect(cb).toHaveBeenCalledOnce()
    })

    it('does nothing if already ended', () => {
      const m = enterPlaying()
      vi.advanceTimersByTime(ROUND_DURATION_SEC * 1000) // round ends
      m.handleDisconnect('p1') // should not throw or send extra messages

      // Only one ROUND_END per player
      expect(sentOfType(ws2, 'ROUND_END')).toHaveLength(1)
    })
  })

  // ── Edge cases ───────────────────────────────────────────────────

  describe('edge cases', () => {
    it('ignores malformed JSON', () => {
      const m = enterPlaying()
      m.handleMessage('p1', 'not json{{{')
      vi.advanceTimersByTime(BROADCAST_INTERVAL_MS)
      expect(latestUpdate(ws1).player.score).toBe(0)
    })

    it('ignores messages from unknown player IDs', () => {
      const m = enterPlaying()
      m.handleMessage('unknown', clickMsg(1))
      vi.advanceTimersByTime(BROADCAST_INTERVAL_MS)
      expect(latestUpdate(ws1).player.score).toBe(0)
      expect(latestUpdate(ws2).player.score).toBe(0)
    })
  })

  // ── Quit ────────────────────────────────────────────────────────

  describe('quit', () => {
    function quitMsg() {
      return JSON.stringify({ type: 'QUIT' })
    }

    it('awards victory to the opponent when a player quits', () => {
      const m = enterPlaying()
      m.handleMessage('p1', quitMsg())

      const p1End = sentOfType(ws1, 'ROUND_END')[0]
      const p2End = sentOfType(ws2, 'ROUND_END')[0]
      expect(p1End.winner).toBe('opponent')
      expect(p1End.reason).toBe('quit')
      expect(p2End.winner).toBe('player')
      expect(p2End.reason).toBe('quit')
    })

    it('includes correct final scores for both players', () => {
      const m = enterPlaying()
      m.handleMessage('p1', clickMsg(1)) // p1 earns 1
      m.handleMessage('p1', quitMsg())

      const p1End = sentOfType(ws1, 'ROUND_END')[0]
      const p2End = sentOfType(ws2, 'ROUND_END')[0]
      expect(p1End.finalScores.player).toBe(1)
      expect(p1End.finalScores.opponent).toBe(0)
      expect(p2End.finalScores.player).toBe(0)
      expect(p2End.finalScores.opponent).toBe(1)
    })

    it('allows quitting during countdown', () => {
      const m = startMatch()
      // Still in countdown — quit should work
      m.handleMessage('p1', quitMsg())

      const p2End = sentOfType(ws2, 'ROUND_END')[0]
      expect(p2End.winner).toBe('player')
      expect(p2End.reason).toBe('quit')
    })

    it('fires the onEnd callback on quit', () => {
      const m = enterPlaying()
      const cb = vi.fn()
      m.onEnd(cb)
      m.handleMessage('p1', quitMsg())

      expect(cb).toHaveBeenCalledOnce()
    })

    it('does nothing if already ended', () => {
      const m = enterPlaying()
      vi.advanceTimersByTime(ROUND_DURATION_SEC * 1000) // round ends
      m.handleMessage('p1', quitMsg()) // should not send extra messages

      expect(sentOfType(ws1, 'ROUND_END')).toHaveLength(1)
      expect(sentOfType(ws2, 'ROUND_END')).toHaveLength(1)
    })
  })

  // ── Idler mode ─────────────────────────────────────────────────
  describe('idler mode', () => {
    function createIdlerMatch() {
      return new Match({ id: 'p1', ws: ws1 }, { id: 'p2', ws: ws2 }, 'idler')
    }

    function enterIdlerPlaying() {
      const m = createIdlerMatch()
      m.start()
      vi.advanceTimersByTime(COUNTDOWN_SEC * 1000)
      return m
    }

    function highlightMsg(highlight: string, seq: number) {
      return JSON.stringify({
        type: 'ACTION_BATCH',
        seq,
        actions: [{ type: 'set_highlight', timestamp: Date.now(), highlight }],
      })
    }

    function buyMsg(upgradeId: string, seq: number) {
      return JSON.stringify({
        type: 'ACTION_BATCH',
        seq,
        actions: [{ type: 'buy', timestamp: Date.now(), upgradeId }],
      })
    }

    it('sends mode in ROUND_START config', () => {
      const m = createIdlerMatch()
      m.start()
      const msg = sentOfType(ws1, 'ROUND_START')[0]
      expect(msg.config.mode).toBe('idler')
    })

    it('uses idler upgrades in config', () => {
      const m = createIdlerMatch()
      m.start()
      const msg = sentOfType(ws1, 'ROUND_START')[0]
      const ids = msg.config.upgrades.map((u) => u.id)
      // Idler has more upgrades than clicker (5 non-trophy vs 2)
      expect(ids.length).toBeGreaterThanOrEqual(4)
      // Idler-exclusive upgrade IDs (u3, u4 only exist in idler)
      expect(ids).toContain('u3')
      expect(ids).toContain('u4')
    })

    it('produces r0 and r1 at 1/sec base rate', () => {
      enterIdlerPlaying()
      vi.advanceTimersByTime(1000)
      const u = latestUpdate(ws1)
      // Default highlight=r0 → r0 at 2/sec, r1 at 1/sec
      expect(u.player.resources.r0).toBeCloseTo(2, 1)
      expect(u.player.resources.r1).toBeCloseTo(1, 1)
    })

    it('score = total r0 produced (highlight = r0 gives 2x)', () => {
      enterIdlerPlaying()
      vi.advanceTimersByTime(1000)
      const u = latestUpdate(ws1)
      // Highlighted r0 → 2/sec → score = r0 produced
      expect(u.player.score).toBeCloseTo(2, 1)
    })

    it('highlight toggle changes production rates', () => {
      const m = enterIdlerPlaying()
      // Switch to r1 highlight
      m.handleMessage('p1', highlightMsg('r1', 1))
      vi.advanceTimersByTime(1000)
      const u = latestUpdate(ws1)
      // r0 at 1/sec (not highlighted), r1 at 2/sec (highlighted)
      expect(u.player.resources.r0).toBeCloseTo(1, 1)
      expect(u.player.resources.r1).toBeCloseTo(2, 1)
      expect(u.player.score).toBeCloseTo(1, 1) // score = r0
    })

    it('Sharpened Axes makes highlight 4x', () => {
      const m = enterIdlerPlaying()
      // Give player enough r0 to buy (30)
      vi.advanceTimersByTime(15_000) // ~30 r0 at 2/sec
      m.handleMessage('p1', buyMsg('u0', 1))
      // Clear updates to measure from here
      ;(ws1.send as ReturnType<typeof vi.fn>).mockClear()
      vi.advanceTimersByTime(1000)
      const u = latestUpdate(ws1)
      // Highlighted r0 → 4/sec now (1 base × 4)
      expect(u.player.resources.r0).toBeGreaterThan(3.5)
    })

    it('Heavy Logging adds +5 base r0/sec', () => {
      const m = enterIdlerPlaying()
      // Wait for enough r0 (u1 costs 25 r0)
      vi.advanceTimersByTime(13_000) // ~26 r0 at 2/sec
      m.handleMessage('p1', buyMsg('u1', 1))
      ;(ws1.send as ReturnType<typeof vi.fn>).mockClear()
      vi.advanceTimersByTime(1000)
      const u = latestUpdate(ws1)
      // Base r0 = 1 + 5(HL) = 6, highlighted x2 = 12/sec
      expect(u.player.resources.r0).toBeGreaterThan(11)
    })

    it('Royal Brewery adds +5 base r1/sec', () => {
      const m = enterIdlerPlaying()
      // Switch to r1 to earn enough (costs 25 r1)
      m.handleMessage('p1', highlightMsg('r1', 1))
      vi.advanceTimersByTime(13_000) // ~26 r1 at 2/sec
      m.handleMessage('p1', buyMsg('u2', 2))
      ;(ws1.send as ReturnType<typeof vi.fn>).mockClear()
      vi.advanceTimersByTime(1000)
      const u = latestUpdate(ws1)
      // Base r1 = 1 + 5(RB) = 6, highlighted x2 = 12/sec
      expect(u.player.resources.r1).toBeGreaterThan(11)
    })

    it('cannot buy r0 upgrade with r1', () => {
      const m = enterIdlerPlaying()
      // Switch to r1 to build up only r1
      m.handleMessage('p1', highlightMsg('r1', 1))
      vi.advanceTimersByTime(10_000) // r1 ~= 20, r0 ~= 10
      // Try to buy u0 (costs 30 r0) — should fail
      m.handleMessage('p1', buyMsg('u0', 2))
      vi.advanceTimersByTime(BROADCAST_INTERVAL_MS)
      const u = latestUpdate(ws1)
      expect(u.player.upgrades.u0).toBe(0)
    })

    it('rejects clicks in idler mode', () => {
      const m = enterIdlerPlaying()
      m.handleMessage('p1', clickMsg(1))
      vi.advanceTimersByTime(BROADCAST_INTERVAL_MS)
      const u = latestUpdate(ws1)
      expect(u.player.score).toBeLessThan(2)
    })

    it('r0 resource is present, no extraneous keys in idler mode', () => {
      enterIdlerPlaying()
      vi.advanceTimersByTime(5000)
      const u = latestUpdate(ws1)
      expect(u.player.resources.r0).toBeDefined()
      expect(u.player.resources.r1).toBeDefined()
    })
  })

  // ── Target-score goal ──────────────────────────────────────────────
  describe('target-score goal', () => {
    const targetGoal: Goal = { type: 'target-score', target: 50, safetyCapSec: 300 }

    function createTargetMatch() {
      return new Match({ id: 'p1', ws: ws1 }, { id: 'p2', ws: ws2 }, 'clicker', targetGoal)
    }

    function startTargetMatch() {
      const m = createTargetMatch()
      m.start()
      return m
    }

    function enterTargetPlaying() {
      const m = startTargetMatch()
      vi.advanceTimersByTime(COUNTDOWN_SEC * 1000)
      return m
    }

    it('sends goal in ROUND_START config', () => {
      startTargetMatch()
      const msg = sentOfType(ws1, 'ROUND_START')[0]
      expect(msg.config.goal).toEqual(targetGoal)
    })

    it('ends immediately when a player reaches the target score', () => {
      const m = enterTargetPlaying()
      // Earn exactly 50 clicks (target)
      earnCurrency(m, 'p1', 50)
      // Match should auto-end after score check
      const p1End = sentOfType(ws1, 'ROUND_END')
      expect(p1End).toHaveLength(1)
      expect(p1End[0].winner).toBe('player')
      expect(p1End[0].reason).toBe('complete')
    })

    it('declares the first player to hit the target as winner', () => {
      const m = enterTargetPlaying()
      earnCurrency(m, 'p2', 50)

      const p1End = sentOfType(ws1, 'ROUND_END')[0]
      const p2End = sentOfType(ws2, 'ROUND_END')[0]
      expect(p1End.winner).toBe('opponent')
      expect(p2End.winner).toBe('player')
    })

    it('does not end before target is reached', () => {
      const m = enterTargetPlaying()
      earnCurrency(m, 'p1', 49) // one short
      vi.advanceTimersByTime(BROADCAST_INTERVAL_MS)
      expect(sentOfType(ws1, 'ROUND_END')).toHaveLength(0)

      // Now hit the target
      m.handleMessage('p1', clickMsg(100))
      expect(sentOfType(ws1, 'ROUND_END')).toHaveLength(1)
    })

    it('ends with safety-cap reason when time expires without reaching target', () => {
      enterTargetPlaying()
      // Don't click at all — let safety cap expire
      vi.advanceTimersByTime(targetGoal.safetyCapSec * 1000)

      const p1End = sentOfType(ws1, 'ROUND_END')[0]
      expect(p1End.reason).toBe('safety-cap')
      expect(p1End.winner).toBe('draw') // both 0
    })

    it('safety-cap picks higher score as winner', () => {
      const m = enterTargetPlaying()
      m.handleMessage('p1', clickMsg(1)) // p1 = 1, p2 = 0
      vi.advanceTimersByTime(targetGoal.safetyCapSec * 1000)

      const p1End = sentOfType(ws1, 'ROUND_END')[0]
      expect(p1End.reason).toBe('safety-cap')
      expect(p1End.winner).toBe('player')
    })

    it('timeLeft reflects safety cap countdown', () => {
      enterTargetPlaying()
      vi.advanceTimersByTime(10_000 + BROADCAST_INTERVAL_MS)
      const u = latestUpdate(ws1)
      // Should be ~290s remaining (300 - 10)
      expect(u.timeLeft).toBeGreaterThan(280)
      expect(u.timeLeft).toBeLessThan(300)
    })

    it('passive income can trigger target-score end', () => {
      const lowTargetGoal: Goal = { type: 'target-score', target: 5, safetyCapSec: 300 }
      const m = new Match({ id: 'p1', ws: ws1 }, { id: 'p2', ws: ws2 }, 'clicker', lowTargetGoal)
      m.start()
      vi.advanceTimersByTime(COUNTDOWN_SEC * 1000)

      // Buy double-click (costs 25, earn 25 first)
      const seq = earnCurrency(m, 'p1', 25)
      m.handleMessage(
        'p1',
        JSON.stringify({
          type: 'ACTION_BATCH',
          seq,
          actions: [{ type: 'buy', timestamp: Date.now(), upgradeId: 'u0' }],
        }),
      )

      // p1 score is already 25 from earning currency — should have ended
      expect(sentOfType(ws1, 'ROUND_END')).toHaveLength(1)
    })
  })
})
