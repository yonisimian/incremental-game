import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type WebSocket from 'ws'
import type { Goal } from '@game/shared'
import { BROADCAST_INTERVAL_MS, COUNTDOWN_SEC, ROUND_DURATION_SEC } from '@game/shared'
import { Match } from '../src/match.js'
import { createMockWs, sentOfType, latestUpdate } from './_helpers.js'

// ─── Tests ───────────────────────────────────────────────────────────

const TIMED_GOAL: Goal = {
  type: 'timed',
  label: '⏱ Timed',
  durationSec: ROUND_DURATION_SEC,
}

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
    return new Match({ id: 'p1', ws: ws1 }, { id: 'p2', ws: ws2 }, 'idler', TIMED_GOAL)
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

  /** Create a bot match (pause is bot-only) and advance into the playing phase. */
  function enterPlayingVsBot() {
    const m = new Match({ id: 'p1', ws: ws1 }, { id: 'bot', ws: null }, 'idler', TIMED_GOAL, {
      decide: () => [],
    })
    m.start()
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

  function pauseMsg() {
    return JSON.stringify({ type: 'PAUSE' })
  }

  function unpauseMsg() {
    return JSON.stringify({ type: 'UNPAUSE' })
  }

  /**
   * Give a player a scoring lead. Both players earn symmetric passive income, so
   * we grant the player the highlight unlock (uh → ×2 on the score resource r0)
   * so it out-produces the other over time. Resources are granted via the test
   * seam so the purchase is affordable immediately; advance time afterwards for
   * the lead to materialize.
   */
  function giveLead(match: Match, playerId: 'p1' | 'p2') {
    match.grantResourcesForTest(playerId, { r0: 5 }) // afford uh (cost 5)
    match.handleMessage(playerId, buyMsg('uh', 1))
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
      expect(msg.config.goal).toEqual({
        type: 'timed',
        label: '⏱ Timed',
        durationSec: ROUND_DURATION_SEC,
      })
      expect(msg.config.upgrades.length).toBeGreaterThan(0)
      expect(msg.matchId).toBeDefined()
      expect(msg.serverTime).toBeGreaterThan(0)
    })

    it('ignores actions during countdown', () => {
      const m = startMatch()
      m.grantResourcesForTest('p1', { r0: 100 }) // afford uh, isolating the phase gate
      m.handleMessage('p1', buyMsg('uh', 1)) // sent during countdown — must be ignored
      vi.advanceTimersByTime(COUNTDOWN_SEC * 1000 + BROADCAST_INTERVAL_MS)
      const u = latestUpdate(ws1)
      expect(u.player.upgrades.uh).toBe(0)
    })

    it('pauses and resumes the round timer', () => {
      const m = enterPlayingVsBot()
      m.handleMessage('p1', pauseMsg())
      const pausedUpdate = latestUpdate(ws1)
      expect(pausedUpdate.paused).toBe(true)

      const pausedTimeLeft = pausedUpdate.timeLeft
      vi.advanceTimersByTime(BROADCAST_INTERVAL_MS * 2)
      expect(latestUpdate(ws1).timeLeft).toBe(pausedTimeLeft)

      m.handleMessage('p1', unpauseMsg())
      expect(latestUpdate(ws1).paused).toBe(false)
      vi.advanceTimersByTime(BROADCAST_INTERVAL_MS * 2)
      expect(latestUpdate(ws1).timeLeft).toBeLessThan(pausedTimeLeft)
    })

    it('ignores player actions while paused', () => {
      const m = enterPlayingVsBot()
      m.handleMessage('p1', pauseMsg())
      const pausedScore = latestUpdate(ws1).player.score
      m.handleMessage('p1', clickMsg(1))
      vi.advanceTimersByTime(BROADCAST_INTERVAL_MS)
      expect(latestUpdate(ws1).player.score).toBe(pausedScore)
    })

    it('ignores pause requests in a non-bot (PvP) match', () => {
      const m = enterPlaying()
      m.handleMessage('p1', pauseMsg())
      vi.advanceTimersByTime(BROADCAST_INTERVAL_MS)
      expect(latestUpdate(ws1).paused).toBe(false)
    })
  })

  // ── Broadcasting ─────────────────────────────────────────────────

  describe('broadcasting', () => {
    it('includes opponent state in updates', () => {
      const m = enterPlaying()
      giveLead(m, 'p1') // p1 out-produces p2 so the two views are distinguishable
      vi.advanceTimersByTime(2000)

      const u1 = latestUpdate(ws1)
      const u2 = latestUpdate(ws2)
      // p2's view of its opponent mirrors p1's own score, and p1 leads
      expect(u2.opponent.score).toBeCloseTo(u1.player.score, 5)
      expect(u2.opponent.score).toBeGreaterThan(u2.player.score)
    })
  })

  // ── Round end ────────────────────────────────────────────────────

  describe('round end', () => {
    it('sends ROUND_END with correct winner after timeout', () => {
      const m = enterPlaying()
      giveLead(m, 'p1') // p1 out-produces p2 over the round
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
      m.grantResourcesForTest('p1', { r0: 100 })
      m.handleMessage('p1', 'not json{{{')
      vi.advanceTimersByTime(BROADCAST_INTERVAL_MS)
      // Message dropped: no upgrade purchased, no crash
      expect(latestUpdate(ws1).player.upgrades.uh).toBe(0)
    })

    it('ignores messages from unknown player IDs', () => {
      const m = enterPlaying()
      m.handleMessage('unknown', buyMsg('uh', 1))
      vi.advanceTimersByTime(BROADCAST_INTERVAL_MS)
      expect(latestUpdate(ws1).player.upgrades.uh).toBe(0)
      expect(latestUpdate(ws2).player.upgrades.uh).toBe(0)
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
      giveLead(m, 'p1') // p1 builds a score lead
      vi.advanceTimersByTime(2000)
      m.handleMessage('p1', quitMsg())

      const p1End = sentOfType(ws1, 'ROUND_END')[0]
      const p2End = sentOfType(ws2, 'ROUND_END')[0]
      // Scores mirror across the two players' views, with p1 ahead
      expect(p1End.finalScores.player).toBeGreaterThan(p1End.finalScores.opponent)
      expect(p1End.finalScores.player).toBe(p2End.finalScores.opponent)
      expect(p1End.finalScores.opponent).toBe(p2End.finalScores.player)
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

    /** Enter idler and buy the highlight-unlock upgrade (uh) so highlight tests work. */
    function enterIdlerWithHighlight() {
      const m = enterIdlerPlaying()
      // Accumulate 5 r0 at base 1/sec (no highlight yet), then buy 'uh'
      vi.advanceTimersByTime(5000)
      m.handleMessage('p1', buyMsg('uh', 1))
      ;(ws1.send as ReturnType<typeof vi.fn>).mockClear()
      ;(ws2.send as ReturnType<typeof vi.fn>).mockClear()
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
      // Idler stub tree: unlock-highlight, a production upgrade, and the trophy
      // (default idler goal is buy-upgrade, so the trophy is included).
      expect(ids).toContain('uh')
      expect(ids).toContain('u1')
      expect(ids).toContain('u5')
    })

    it('produces r0 and r1 at 1/sec base rate (no highlight)', () => {
      enterIdlerPlaying()
      vi.advanceTimersByTime(1000)
      const u = latestUpdate(ws1)
      // Without highlight unlock: both at base 1/sec
      expect(u.player.resources.r0).toBeCloseTo(1, 1)
      expect(u.player.resources.r1).toBeCloseTo(1, 1)
    })

    it('highlight doubles production after unlock', () => {
      enterIdlerWithHighlight()
      // Get a baseline by advancing one broadcast interval
      vi.advanceTimersByTime(BROADCAST_INTERVAL_MS)
      const before = latestUpdate(ws1)
      ;(ws1.send as ReturnType<typeof vi.fn>).mockClear()
      vi.advanceTimersByTime(1000)
      const after = latestUpdate(ws1)
      // Default highlight=r0 → r0 gains ~2/sec, r1 gains ~1/sec
      const r0Delta = after.player.resources.r0 - before.player.resources.r0
      const r1Delta = after.player.resources.r1 - before.player.resources.r1
      expect(r0Delta).toBeCloseTo(2, 0)
      expect(r1Delta).toBeCloseTo(1, 0)
    })

    it('score = total r0 produced (highlight = r0 gives 2x)', () => {
      enterIdlerWithHighlight()
      vi.advanceTimersByTime(1000)
      const u = latestUpdate(ws1)
      // Highlighted r0 → 2/sec → score = r0 produced
      expect(u.player.score).toBeGreaterThan(1.5)
    })

    it('highlight toggle changes production rates', () => {
      const m = enterIdlerWithHighlight()
      // Switch to r1 highlight
      m.handleMessage('p1', highlightMsg('r1', 2))
      // Snapshot state after switch
      vi.advanceTimersByTime(BROADCAST_INTERVAL_MS)
      const before = latestUpdate(ws1)
      ;(ws1.send as ReturnType<typeof vi.fn>).mockClear()
      vi.advanceTimersByTime(1000)
      const after = latestUpdate(ws1)
      // r0 at 1/sec (not highlighted), r1 at 2/sec (highlighted)
      const r0Delta = after.player.resources.r0 - before.player.resources.r0
      const r1Delta = after.player.resources.r1 - before.player.resources.r1
      expect(r0Delta).toBeCloseTo(1, 0)
      expect(r1Delta).toBeCloseTo(2, 0)
    })

    it('Heavy Logging adds +5 base r0/sec', () => {
      const m = enterIdlerWithHighlight()
      // Wait for enough r0 (u1 costs 25 r0) at 2/sec (highlighted)
      vi.advanceTimersByTime(13_000) // ~26 r0
      m.handleMessage('p1', buyMsg('u1', 2))
      ;(ws1.send as ReturnType<typeof vi.fn>).mockClear()
      vi.advanceTimersByTime(1000)
      const u = latestUpdate(ws1)
      // Base r0 = 1 + 5(HL) = 6, highlighted x2 = 12/sec
      expect(u.player.resources.r0).toBeGreaterThan(11)
    })

    it('cannot buy r0 upgrade with r1', () => {
      const m = enterIdlerWithHighlight()
      // Switch to r1 to build up only r1
      m.handleMessage('p1', highlightMsg('r1', 2))
      vi.advanceTimersByTime(10_000) // r1 ~= 20, r0 ~= 10
      // Try to buy u1 (costs 25 r0) — should fail since player doesn't have enough r0
      m.handleMessage('p1', buyMsg('u1', 3))
      vi.advanceTimersByTime(BROADCAST_INTERVAL_MS)
      const u = latestUpdate(ws1)
      expect(u.player.upgrades.u1).toBe(0)
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
    const targetGoal: Goal = {
      type: 'target-score',
      label: '🎯 Race to Score',
      target: 50,
      safetyCapSec: 300,
    }

    function createTargetMatch() {
      return new Match({ id: 'p1', ws: ws1 }, { id: 'p2', ws: ws2 }, 'idler', targetGoal)
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

    // A target far above any passive income within the safety cap, so the
    // safety-cap path can be exercised without the target being reached first.
    const highTargetGoal: Goal = {
      type: 'target-score',
      label: '🎯 Race to Score',
      target: 100_000,
      safetyCapSec: 300,
    }

    function enterHighTargetPlaying() {
      const m = new Match({ id: 'p1', ws: ws1 }, { id: 'p2', ws: ws2 }, 'idler', highTargetGoal)
      m.start()
      vi.advanceTimersByTime(COUNTDOWN_SEC * 1000)
      return m
    }

    it('sends goal in ROUND_START config', () => {
      startTargetMatch()
      const msg = sentOfType(ws1, 'ROUND_START')[0]
      expect(msg.config.goal).toEqual(targetGoal)
    })

    it('ends when a player reaches the target score', () => {
      const m = enterTargetPlaying()
      giveLead(m, 'p1') // p1 produces 2/sec, p2 1/sec
      vi.advanceTimersByTime(26_000) // p1 crosses 50 before p2
      const p1End = sentOfType(ws1, 'ROUND_END')
      expect(p1End).toHaveLength(1)
      expect(p1End[0].winner).toBe('player')
      expect(p1End[0].reason).toBe('complete')
    })

    it('declares the first player to hit the target as winner', () => {
      const m = enterTargetPlaying()
      giveLead(m, 'p2') // p2 produces 2/sec, p1 1/sec
      vi.advanceTimersByTime(26_000) // p2 crosses 50 before p1

      const p1End = sentOfType(ws1, 'ROUND_END')[0]
      const p2End = sentOfType(ws2, 'ROUND_END')[0]
      expect(p1End.winner).toBe('opponent')
      expect(p2End.winner).toBe('player')
    })

    it('does not end before target is reached', () => {
      const m = enterTargetPlaying()
      giveLead(m, 'p1') // p1 produces 2/sec
      vi.advanceTimersByTime(24_000) // p1 ~48, still under target 50
      expect(sentOfType(ws1, 'ROUND_END')).toHaveLength(0)

      // Cross the target
      vi.advanceTimersByTime(2_000)
      expect(sentOfType(ws1, 'ROUND_END')).toHaveLength(1)
    })

    it('ends with safety-cap reason when time expires without reaching target', () => {
      enterHighTargetPlaying() // target unreachable via passive income
      vi.advanceTimersByTime(highTargetGoal.safetyCapSec * 1000)

      const p1End = sentOfType(ws1, 'ROUND_END')[0]
      expect(p1End.reason).toBe('safety-cap')
      expect(p1End.winner).toBe('draw') // symmetric passive income
    })

    it('safety-cap picks higher score as winner', () => {
      const m = enterHighTargetPlaying() // target unreachable via passive income
      giveLead(m, 'p1') // p1 out-produces p2
      vi.advanceTimersByTime(highTargetGoal.safetyCapSec * 1000)

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
  })

  // ── Buy-upgrade (trophy) goal ──────────────────────────────────────
  describe('buy-upgrade goal', () => {
    const buyGoal: Goal = {
      type: 'buy-upgrade',
      label: '🏆 Race to Buy',
      safetyCapSec: 600,
    }

    function createBuyMatch() {
      return new Match({ id: 'p1', ws: ws1 }, { id: 'p2', ws: ws2 }, 'idler', buyGoal)
    }

    function enterBuyPlaying() {
      const m = createBuyMatch()
      m.start()
      vi.advanceTimersByTime(COUNTDOWN_SEC * 1000)
      return m
    }

    it('sends buy-upgrade goal in ROUND_START config', () => {
      const m = createBuyMatch()
      m.start()
      const msg = sentOfType(ws1, 'ROUND_START')[0]
      expect(msg.config.goal).toEqual(buyGoal)
    })

    it('includes the trophy upgrade when goal is buy-upgrade', () => {
      const m = createBuyMatch()
      m.start()
      const msg = sentOfType(ws1, 'ROUND_START')[0]
      const ids = msg.config.upgrades.map((u) => u.id)
      expect(ids).toContain('u5') // Royal Throne
    })

    it('excludes the trophy upgrade for non-buy-upgrade goals', () => {
      const m = new Match({ id: 'p1', ws: ws1 }, { id: 'p2', ws: ws2 }, 'idler', TIMED_GOAL)
      m.start()
      const msg = sentOfType(ws1, 'ROUND_START')[0]
      const ids = msg.config.upgrades.map((u) => u.id)
      expect(ids).not.toContain('u5')
    })

    it('buying the trophy ends the match with the buyer as winner', () => {
      const m = enterBuyPlaying()
      // u5 (Royal Throne) costs 30000 — grant via the test seam (unreachable via passive income)
      m.grantResourcesForTest('p1', { r0: 30_000 })
      m.handleMessage('p1', buyMsg('u5', 1))

      const p1End = sentOfType(ws1, 'ROUND_END')[0]
      const p2End = sentOfType(ws2, 'ROUND_END')[0]
      expect(p1End.winner).toBe('player')
      expect(p1End.reason).toBe('complete')
      expect(p2End.winner).toBe('opponent')
      expect(p2End.reason).toBe('complete')
    })

    it('player 2 buying the trophy makes player 2 the winner', () => {
      const m = enterBuyPlaying()
      m.grantResourcesForTest('p2', { r0: 30_000 })
      m.handleMessage('p2', buyMsg('u5', 1))

      const p1End = sentOfType(ws1, 'ROUND_END')[0]
      const p2End = sentOfType(ws2, 'ROUND_END')[0]
      expect(p1End.winner).toBe('opponent')
      expect(p2End.winner).toBe('player')
    })

    it('buying a non-trophy upgrade does not end the match', () => {
      const m = enterBuyPlaying()
      m.grantResourcesForTest('p1', { r0: 5 })
      m.handleMessage('p1', buyMsg('uh', 1)) // uh = Unlock Highlight, not a trophy

      expect(sentOfType(ws1, 'ROUND_END')).toHaveLength(0)
    })

    it('safety-cap expires with score-based winner when nobody buys trophy', () => {
      const m = enterBuyPlaying()
      giveLead(m, 'p1') // p1 out-produces p2; trophy unaffordable via passive income
      vi.advanceTimersByTime(buyGoal.safetyCapSec * 1000)

      const p1End = sentOfType(ws1, 'ROUND_END')[0]
      expect(p1End.reason).toBe('safety-cap')
      expect(p1End.winner).toBe('player')
    })

    it('safety-cap with equal scores is a draw', () => {
      enterBuyPlaying()
      vi.advanceTimersByTime(buyGoal.safetyCapSec * 1000)

      const p1End = sentOfType(ws1, 'ROUND_END')[0]
      expect(p1End.reason).toBe('safety-cap')
      expect(p1End.winner).toBe('draw')
    })

    it('reports mirrored final scores at safety cap', () => {
      const m = enterBuyPlaying()
      giveLead(m, 'p1') // p1 builds a score lead
      vi.advanceTimersByTime(buyGoal.safetyCapSec * 1000)

      const p1End = sentOfType(ws1, 'ROUND_END')[0]
      const p2End = sentOfType(ws2, 'ROUND_END')[0]
      expect(p1End.finalScores.player).toBeGreaterThan(p1End.finalScores.opponent)
      expect(p1End.finalScores.player).toBe(p2End.finalScores.opponent)
      expect(p1End.finalScores.opponent).toBe(p2End.finalScores.player)
    })

    it('no further actions are processed after trophy purchase', () => {
      const m = enterBuyPlaying()
      // Grant enough for the trophy plus another upgrade
      m.grantResourcesForTest('p1', { r0: 30_005 })
      // Send trophy buy and a second buy in the same batch
      m.handleMessage(
        'p1',
        JSON.stringify({
          type: 'ACTION_BATCH',
          seq: 1,
          actions: [
            { type: 'buy', timestamp: Date.now(), upgradeId: 'u5' },
            { type: 'buy', timestamp: Date.now(), upgradeId: 'uh' },
          ],
        }),
      )

      // Only one ROUND_END — the action after the trophy buy is not processed
      expect(sentOfType(ws1, 'ROUND_END')).toHaveLength(1)
    })
  })
})
