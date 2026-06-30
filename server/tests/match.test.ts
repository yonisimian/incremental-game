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

const BUY_UPGRADE_GOAL: Goal = {
  type: 'buy-upgrade',
  label: '🏆 Race to Buy',
  safetyCapSec: 600,
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

  function clickMsg(seq: number, resource?: string) {
    return JSON.stringify({
      type: 'ACTION_BATCH',
      seq,
      actions: [{ type: 'click', timestamp: Date.now(), resource }],
    })
  }

  function buyMsg(upgradeId: string, seq: number) {
    return JSON.stringify({
      type: 'ACTION_BATCH',
      seq,
      actions: [{ type: 'buy', timestamp: Date.now(), upgradeId }],
    })
  }

  function buyGenMsg(generatorId: string, seq: number) {
    return JSON.stringify({
      type: 'ACTION_BATCH',
      seq,
      actions: [{ type: 'buy_generator', timestamp: Date.now(), generatorId }],
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
   * we grant the player the highlight unlock (sh-unlock → ×2 on the score resource r0)
   * so it out-produces the other over time. Resources are granted via the test
   * seam so the purchase is affordable immediately; advance time afterwards for
   * the lead to materialize.
   */
  function giveLead(match: Match, playerId: 'p1' | 'p2') {
    match.grantResourcesForTest(playerId, { r0: 5 }) // sh-unlock is free; grant is harmless
    match.handleMessage(playerId, buyMsg('sh-unlock', 1))
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
      expect(msg.matchId).toBeDefined()
      expect(msg.serverTime).toBeGreaterThan(0)
    })

    it('ignores actions during countdown', () => {
      const m = startMatch()
      m.grantResourcesForTest('p1', { r0: 100 }) // afford sh-unlock, isolating the phase gate
      m.handleMessage('p1', buyMsg('sh-unlock', 1)) // sent during countdown — must be ignored
      vi.advanceTimersByTime(COUNTDOWN_SEC * 1000 + BROADCAST_INTERVAL_MS)
      const u = latestUpdate(ws1)
      expect(u.player.upgrades['sh-unlock']).toBe(0)
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

    it('does not jump when the system wall clock steps forward', () => {
      // Regression: the round timer is anchored to the monotonic clock, so a
      // system wall-clock step (NTP correction, VM/host time-sync) must not make
      // the countdown leap. Deriving `timeLeft` from `Date.now()` used to
      // subtract the whole step in a single tick (observed ~3s jumps in dev).
      enterPlaying()
      vi.advanceTimersByTime(BROADCAST_INTERVAL_MS)
      const before = latestUpdate(ws1).timeLeft

      // Step the wall clock forward 3s WITHOUT advancing monotonic time.
      vi.setSystemTime(Date.now() + 3000)

      // One more broadcast interval of real (monotonic) time elapses.
      vi.advanceTimersByTime(BROADCAST_INTERVAL_MS)
      const after = latestUpdate(ws1).timeLeft

      // Only the ~0.5s of real time should be deducted, not the 3s wall-clock step.
      const drop = before - after
      expect(drop).toBeGreaterThan(0)
      expect(drop).toBeLessThan(1)
      expect(drop).toBeCloseTo(BROADCAST_INTERVAL_MS / 1000, 1)
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

    it("omits the opponent's upgrades, generators, and meta from the wire", () => {
      enterPlaying()
      vi.advanceTimersByTime(BROADCAST_INTERVAL_MS)

      const opp = latestUpdate(ws1).opponent
      // The raw opponent state is never shipped — only score (+ unlocked intel).
      expect('upgrades' in opp).toBe(false)
      expect('generators' in opp).toBe(false)
      expect('meta' in opp).toBe(false)
      // No espionage unlocked → no resource/rate intel.
      expect(opp.resources).toEqual({})
      expect(opp.rates).toEqual({})
    })

    it('reveals an opponent resource only to a viewer who unlocked it', () => {
      const m = enterPlaying()
      m.grantResourcesForTest('p2', { r0: 42 }) // opponent stockpile to spy on
      // e-se-mr is free, unprereq'd, and grants `accessEnemyData: r0`.
      m.handleMessage('p1', buyMsg('e-se-mr', 1))
      vi.advanceTimersByTime(BROADCAST_INTERVAL_MS)

      // p1 unlocked r0 → its view of p2 carries p2's actual r0 stockpile.
      expect(latestUpdate(ws1).opponent.resources.r0).toBeCloseTo(
        latestUpdate(ws2).player.resources.r0,
        5,
      )
      // p2 unlocked nothing → no intel on p1.
      expect(latestUpdate(ws2).opponent.resources).toEqual({})
    })

    it('reveals opponent peak CPS only to a viewer who unlocked `e-se-cps`', () => {
      const m = enterPlaying()
      // p2 unlocks clicks (sc-unlock, no prereq) then clicks → non-zero peak CPS.
      m.grantResourcesForTest('p2', { r0: 50 })
      m.handleMessage('p2', buyMsg('sc-unlock', 1))
      m.handleMessage('p2', clickMsg(2))
      // Walk the (free) espionage chain to e-se-cps: e-se-mr → e-se-mr-ps → e-se-cps.
      m.handleMessage('p1', buyMsg('e-se-mr', 1))
      m.handleMessage('p1', buyMsg('e-se-mr-ps', 2))
      m.handleMessage('p1', buyMsg('e-se-cps', 3))
      vi.advanceTimersByTime(BROADCAST_INTERVAL_MS)

      // p1 unlocked CPS intel → sees p2's peak CPS (≥1 after the click).
      expect(latestUpdate(ws1).opponent.peakCps).toBeGreaterThanOrEqual(1)
      // p2 unlocked nothing → peak CPS is withheld entirely.
      expect(latestUpdate(ws2).opponent.peakCps).toBeUndefined()
    })

    it('forwards a new opponent purchase (timestamp only) once to a viewer who unlocked `e-se-p`', () => {
      const m = enterPlaying()
      // p1 unlocks the purchase feed (free chain: e-se-mr → e-se-mr-ps → e-se-p).
      m.handleMessage('p1', buyMsg('e-se-mr', 1))
      m.handleMessage('p1', buyMsg('e-se-mr-ps', 2))
      m.handleMessage('p1', buyMsg('e-se-p', 3))
      // First broadcast after unlock seeds the watermark to p2's current head —
      // nothing is emitted (the feed is a delta, not the full log).
      vi.advanceTimersByTime(BROADCAST_INTERVAL_MS)
      expect(latestUpdate(ws1).opponent.purchases).toBeUndefined()

      // p2 now buys → next broadcast forwards exactly that one event.
      m.handleMessage('p2', buyMsg('e-se-mr', 1))
      vi.advanceTimersByTime(BROADCAST_INTERVAL_MS)

      const purchases = latestUpdate(ws1).opponent.purchases
      expect(purchases).toBeDefined()
      expect(purchases!.length).toBe(1)
      // Base tier reveals only the timestamp — kind/id stay hidden so the
      // opponent's tree can't be read in devtools.
      const first = purchases![0]
      expect(typeof first.t).toBe('number')
      expect(first.kind).toBeUndefined()
      expect(first.id).toBeUndefined()

      // Each event is sent exactly once: a later broadcast with no new purchase
      // carries no feed delta.
      vi.advanceTimersByTime(BROADCAST_INTERVAL_MS)
      expect(latestUpdate(ws1).opponent.purchases).toBeUndefined()

      // p2 unlocked nothing → no purchase intel on p1 (despite p1's buys).
      expect(latestUpdate(ws2).opponent.purchases).toBeUndefined()
    })

    it('does not retroactively reveal purchases made before the feed was unlocked', () => {
      const m = enterPlaying()
      // p2 buys before p1 has any intel, and the event lands in p2's log.
      m.handleMessage('p2', buyMsg('e-se-mr', 1))
      vi.advanceTimersByTime(BROADCAST_INTERVAL_MS)

      // p1 unlocks the purchase feed (e-se-mr → e-se-mr-ps → e-se-p).
      m.handleMessage('p1', buyMsg('e-se-mr', 1))
      m.handleMessage('p1', buyMsg('e-se-mr-ps', 2))
      m.handleMessage('p1', buyMsg('e-se-p', 3))
      // First broadcast after unlock seeds the watermark past p2's earlier buy —
      // it is never forwarded.
      vi.advanceTimersByTime(BROADCAST_INTERVAL_MS)
      expect(latestUpdate(ws1).opponent.purchases).toBeUndefined()

      // p2 buys again, now after p1's unlock → only this one is forwarded.
      m.handleMessage('p2', buyMsg('e-se-mr-ps', 2))
      vi.advanceTimersByTime(BROADCAST_INTERVAL_MS)
      const purchases = latestUpdate(ws1).opponent.purchases ?? []
      expect(purchases.length).toBe(1)
    })

    it('reveals purchase kind (but not the id) to a viewer who unlocked `e-p-ug`', () => {
      const m = enterPlaying()
      // p1 walks the chain through e-p-ug: e-se-mr → e-se-mr-ps → e-se-p → e-p-ug.
      m.handleMessage('p1', buyMsg('e-se-mr', 1))
      m.handleMessage('p1', buyMsg('e-se-mr-ps', 2))
      m.handleMessage('p1', buyMsg('e-se-p', 3))
      m.handleMessage('p1', buyMsg('e-p-ug', 4))
      vi.advanceTimersByTime(BROADCAST_INTERVAL_MS) // seed the feed watermark

      // p2 buys an upgrade → kind is revealed, the specific id is not.
      m.handleMessage('p2', buyMsg('e-se-mr', 1))
      vi.advanceTimersByTime(BROADCAST_INTERVAL_MS)
      const event = latestUpdate(ws1).opponent.purchases![0]
      expect(event.kind).toBe('upgrade')
      expect(event.id).toBeUndefined()
    })

    it('reveals the specific upgrade id to a viewer who unlocked `e-p-u`', () => {
      const m = enterPlaying()
      m.handleMessage('p1', buyMsg('e-se-mr', 1))
      m.handleMessage('p1', buyMsg('e-se-mr-ps', 2))
      m.handleMessage('p1', buyMsg('e-se-p', 3))
      m.handleMessage('p1', buyMsg('e-p-ug', 4))
      m.handleMessage('p1', buyMsg('e-p-u', 5))
      vi.advanceTimersByTime(BROADCAST_INTERVAL_MS) // seed

      m.handleMessage('p2', buyMsg('e-se-mr', 1))
      vi.advanceTimersByTime(BROADCAST_INTERVAL_MS)
      const event = latestUpdate(ws1).opponent.purchases![0]
      expect(event.kind).toBe('upgrade')
      expect(event.id).toBe('e-se-mr')
    })

    it('reveals generator ids only with `e-p-g`, keeping upgrade ids hidden', () => {
      const m = enterPlaying()
      // p1 takes the generator branch: …→ e-p-ug → e-p-g (but NOT e-p-u).
      m.handleMessage('p1', buyMsg('e-se-mr', 1))
      m.handleMessage('p1', buyMsg('e-se-mr-ps', 2))
      m.handleMessage('p1', buyMsg('e-se-p', 3))
      m.handleMessage('p1', buyMsg('e-p-ug', 4))
      m.handleMessage('p1', buyMsg('e-p-g', 5))
      // p2 unlocks the generators (free `g1-g2` unlocks g0) and is funded before
      // the feed is seeded, so this setup buy isn't part of the delta.
      m.handleMessage('p2', buyMsg('g1-g2', 1))
      m.grantResourcesForTest('p2', { r1: 100 }) // afford g0 (baseCost 10 r1)
      vi.advanceTimersByTime(BROADCAST_INTERVAL_MS) // seed

      // p2 buys a generator and an upgrade.
      m.handleMessage('p2', buyGenMsg('g0', 2))
      m.handleMessage('p2', buyMsg('e-se-mr', 3))
      vi.advanceTimersByTime(BROADCAST_INTERVAL_MS)

      const purchases = latestUpdate(ws1).opponent.purchases ?? []
      const gen = purchases.find((p) => p.kind === 'generator')
      const upg = purchases.find((p) => p.kind === 'upgrade')
      // Generator id is revealed (e-p-g); upgrade id stays hidden (no e-p-u),
      // though its kind is still known via e-p-ug.
      expect(gen?.id).toBe('g0')
      expect(upg).toBeDefined()
      expect(upg!.id).toBeUndefined()
    })
  })

  // ── Race-to-buy score hiding ─────────────────────────────────────

  describe('race-to-buy score hiding', () => {
    function enterPlayingWithGoal(goal: Goal) {
      const m = new Match({ id: 'p1', ws: ws1 }, { id: 'p2', ws: ws2 }, 'idler', goal)
      m.start()
      vi.advanceTimersByTime(COUNTDOWN_SEC * 1000)
      return m
    }

    it('omits opponent score from STATE_UPDATE for buy-upgrade goals', () => {
      enterPlayingWithGoal(BUY_UPGRADE_GOAL)
      vi.advanceTimersByTime(BROADCAST_INTERVAL_MS)
      expect(latestUpdate(ws1).opponent.score).toBeUndefined()
      expect(latestUpdate(ws2).opponent.score).toBeUndefined()
    })

    it('still sends opponent score for timed goals', () => {
      enterPlayingWithGoal(TIMED_GOAL)
      vi.advanceTimersByTime(BROADCAST_INTERVAL_MS)
      expect(latestUpdate(ws1).opponent.score).toBeDefined()
    })

    it('omits opponent score from ROUND_END for buy-upgrade goals', () => {
      const m = enterPlayingWithGoal(BUY_UPGRADE_GOAL)
      m.handleMessage('p1', JSON.stringify({ type: 'QUIT' }))
      // Both the quitter and the remaining player get a ROUND_END.
      for (const ws of [ws1, ws2]) {
        const end = sentOfType(ws, 'ROUND_END').at(-1)!
        expect(end.finalScores.player).toBeDefined()
        expect(end.finalScores.opponent).toBeUndefined()
      }
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
      expect(latestUpdate(ws1).player.upgrades['sh-unlock']).toBe(0)
    })

    it('ignores messages from unknown player IDs', () => {
      const m = enterPlaying()
      m.handleMessage('unknown', buyMsg('sh-unlock', 1))
      vi.advanceTimersByTime(BROADCAST_INTERVAL_MS)
      expect(latestUpdate(ws1).player.upgrades['sh-unlock']).toBe(0)
      expect(latestUpdate(ws2).player.upgrades['sh-unlock']).toBe(0)
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
      expect(p1End.finalScores.player).toBeGreaterThan(p1End.finalScores.opponent!)
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

    /** Enter idler and buy the highlight-unlock upgrade (sh-unlock) so highlight tests work. */
    function enterIdlerWithHighlight() {
      const m = enterIdlerPlaying()
      // Accumulate 5 r0 at base 1/sec (no highlight yet), then buy 'sh-unlock'
      vi.advanceTimersByTime(5000)
      m.handleMessage('p1', buyMsg('sh-unlock', 1))
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

    it('produces r0 and r1 at 1/sec base rate (no highlight)', () => {
      enterIdlerPlaying()
      // Players start with seed funds, so assert on the per-second delta rather
      // than absolute balances. Without highlight unlock: both at base 1/sec.
      vi.advanceTimersByTime(BROADCAST_INTERVAL_MS)
      const before = latestUpdate(ws1)
      ;(ws1.send as ReturnType<typeof vi.fn>).mockClear()
      vi.advanceTimersByTime(1000)
      const after = latestUpdate(ws1)
      expect(after.player.resources.r0 - before.player.resources.r0).toBeCloseTo(1, 1)
      expect(after.player.resources.r1 - before.player.resources.r1).toBeCloseTo(1, 1)
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
      // Drain the seed r0 (~55) by buying sc-unlock (50 r0), then build up only
      // r1 by highlighting it. The player ends with ample r1 but little r0.
      m.handleMessage('p1', buyMsg('sc-unlock', 2))
      m.handleMessage('p1', highlightMsg('r1', 3))
      vi.advanceTimersByTime(10_000) // r1 climbs (~45), r0 stays low (~15)
      // sc-af-cp costs 25 r0 — unaffordable from r0 despite plentiful r1
      m.handleMessage('p1', buyMsg('sc-af-cp', 4))
      vi.advanceTimersByTime(BROADCAST_INTERVAL_MS)
      const u = latestUpdate(ws1)
      expect(u.player.upgrades['sc-af-cp']).toBe(0)
    })

    it('rejects clicks in idler mode', () => {
      const m = enterIdlerPlaying()
      m.handleMessage('p1', clickMsg(1))
      vi.advanceTimersByTime(BROADCAST_INTERVAL_MS)
      const u = latestUpdate(ws1)
      expect(u.player.score).toBeLessThan(2)
    })

    it('credits a clicked non-score resource without adding to score', () => {
      const m = enterIdlerPlaying()
      vi.advanceTimersByTime(50_000) // accumulate ~50 r0
      m.handleMessage('p1', buyMsg('sc-unlock', 1)) // clickIncome now +1
      vi.advanceTimersByTime(BROADCAST_INTERVAL_MS)

      // Baseline: r0 and r1 share the same passive rate (1/sec, no highlight),
      // so over any interval their deltas match — unless a click lands.
      const before = latestUpdate(ws1)
      m.handleMessage('p1', clickMsg(2, 'r1')) // click credits r1, not score
      vi.advanceTimersByTime(BROADCAST_INTERVAL_MS)
      const after = latestUpdate(ws1)

      const scoreDelta = after.player.score - before.player.score
      const r1Delta = after.player.resources.r1 - before.player.resources.r1
      // r1 got the shared passive plus exactly one click (income 1); score got
      // only the passive (clicking r1 must not touch the score resource).
      expect(r1Delta - scoreDelta).toBeCloseTo(1)
    })

    it('credits the score resource on click (adds to score)', () => {
      const m = enterIdlerPlaying()
      vi.advanceTimersByTime(50_000) // accumulate ~50 r0
      m.handleMessage('p1', buyMsg('sc-unlock', 1)) // clickIncome now +1
      vi.advanceTimersByTime(BROADCAST_INTERVAL_MS)

      const before = latestUpdate(ws1)
      m.handleMessage('p1', clickMsg(2, 'r0')) // r0 is the score resource
      vi.advanceTimersByTime(BROADCAST_INTERVAL_MS)
      const after = latestUpdate(ws1)

      const scoreDelta = after.player.score - before.player.score
      const r1Delta = after.player.resources.r1 - before.player.resources.r1
      // Clicking the score resource adds the click income on top of the shared
      // passive, so score outgrows the untouched r1 by exactly one click.
      expect(scoreDelta - r1Delta).toBeCloseTo(1)
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

    it('buying the trophy ends the match with the buyer as winner', () => {
      const m = enterBuyPlaying()
      // goal (Royal Throne) costs 30000 — grant via the test seam (unreachable via passive income)
      m.grantResourcesForTest('p1', { r0: 30_000 })
      m.handleMessage('p1', buyMsg('goal', 1))

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
      m.handleMessage('p2', buyMsg('goal', 1))

      const p1End = sentOfType(ws1, 'ROUND_END')[0]
      const p2End = sentOfType(ws2, 'ROUND_END')[0]
      expect(p1End.winner).toBe('opponent')
      expect(p2End.winner).toBe('player')
    })

    it('buying a non-trophy upgrade does not end the match', () => {
      const m = enterBuyPlaying()
      m.grantResourcesForTest('p1', { r0: 5 })
      m.handleMessage('p1', buyMsg('sh-unlock', 1)) // sh-unlock = Unlock Highlight, not a trophy

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

    it('reports each player their own score but hides the opponent at safety cap', () => {
      const m = enterBuyPlaying()
      giveLead(m, 'p1') // p1 builds a score lead
      vi.advanceTimersByTime(buyGoal.safetyCapSec * 1000)

      const p1End = sentOfType(ws1, 'ROUND_END')[0]
      const p2End = sentOfType(ws2, 'ROUND_END')[0]
      // Opponent score is never revealed in race-to-buy.
      expect(p1End.finalScores.opponent).toBeUndefined()
      expect(p2End.finalScores.opponent).toBeUndefined()
      // Each player still gets their own score, and p1 led.
      expect(p1End.finalScores.player).toBeGreaterThan(p2End.finalScores.player)
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
            { type: 'buy', timestamp: Date.now(), upgradeId: 'goal' },
            { type: 'buy', timestamp: Date.now(), upgradeId: 'sh-unlock' },
          ],
        }),
      )

      // Only one ROUND_END — the action after the trophy buy is not processed
      expect(sentOfType(ws1, 'ROUND_END')).toHaveLength(1)
    })
  })
})
