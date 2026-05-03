import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type WebSocket from 'ws'
import type { Goal } from '@game/shared'
import {
  BROADCAST_INTERVAL_MS,
  COUNTDOWN_SEC,
  ROUND_DURATION_SEC,
  getModeDefinition,
} from '@game/shared'
import { Match } from '../src/match.js'
import { ClickerBot, IdlerBot, createBot } from '../src/bot.js'
import type { BotStrategy } from '../src/bot.js'
import { createMockWs, sentOfType, latestUpdate } from './_helpers.js'

// ─── Tests ───────────────────────────────────────────────────────────

describe('Bot', () => {
  let ws1: WebSocket

  beforeEach(() => {
    vi.useFakeTimers()
    ws1 = createMockWs()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ── Bot Strategy Unit Tests ────────────────────────────────────

  describe('ClickerBot', () => {
    it('produces click actions each tick', () => {
      const bot = new ClickerBot([{ id: 'u0', cost: 10, modifiers: [] }], 'r0')
      const state = {
        score: 0,
        resources: { r0: 0 },
        upgrades: {
          u0: 0,
          u1: 0,
        },
        generators: {},
        meta: {},
      }
      const actions = bot.decide(state, 0.25)
      const clicks = actions.filter((a) => a.type === 'click')
      expect(clicks.length).toBeGreaterThan(0)
    })

    it('buys cheapest affordable upgrade', () => {
      const bot = new ClickerBot(
        [
          { id: 'u0', cost: 10, modifiers: [] },
          { id: 'u1', cost: 25, modifiers: [] },
        ],
        'r0',
      )
      const state = {
        score: 0,
        resources: { r0: 15 },
        upgrades: {
          u0: 0,
          u1: 0,
        },
        generators: {},
        meta: {},
      }
      const actions = bot.decide(state, 0.25)
      const buys = actions.filter((a) => a.type === 'buy')
      expect(buys).toHaveLength(1)
      expect(buys[0]).toEqual({ type: 'buy', upgradeId: 'u0' })
    })

    it('does not buy already-owned one-shot upgrades', () => {
      const bot = new ClickerBot([{ id: 'u0', cost: 10, modifiers: [] }], 'r0')
      const state = {
        score: 0,
        resources: { r0: 100 },
        upgrades: {
          u0: 1,
          u1: 0,
        },
        generators: {},
        meta: {},
      }
      const actions = bot.decide(state, 0.25)
      const buys = actions.filter((a) => a.type === 'buy')
      expect(buys).toHaveLength(0)
    })

    it('only clicks when all upgrades are already owned', () => {
      const bot = new ClickerBot(
        [
          { id: 'u0', cost: 10, modifiers: [] },
          { id: 'u1', cost: 25, modifiers: [] },
        ],
        'r0',
      )
      const state = {
        score: 0,
        resources: { r0: 999 },
        upgrades: {
          u0: 1,
          u1: 1,
        },
        generators: {},
        meta: {},
      }
      const actions = bot.decide(state, 0.25)
      expect(actions.every((a) => a.type === 'click')).toBe(true)
      expect(actions.length).toBeGreaterThan(0)
    })
  })

  describe('IdlerBot', () => {
    // Synthetic upgrades matching the bot's hardcoded plan: u0(r0), u1(r0), u2(r1)
    const idlerUpgrades = [
      {
        id: 'u0' as const,
        cost: 30,
        costCurrency: 'r0' as const,
        modifiers: [],
      },
      {
        id: 'u1' as const,
        cost: 25,
        costCurrency: 'r0' as const,
        modifiers: [],
      },
      {
        id: 'u2' as const,
        cost: 25,
        costCurrency: 'r1' as const,
        modifiers: [],
      },
    ]

    it('stays on r0 highlight first (for u0)', () => {
      const bot = new IdlerBot(idlerUpgrades)
      const state = {
        score: 0,
        resources: { r0: 0, r1: 0 },
        generators: {},
        meta: { highlight: 'r0' as const },
        upgrades: {
          u0: 0,
          u1: 0,
          u2: 0,
        },
      }
      const actions = bot.decide(state)
      // First plan step is u0 (costs r0), highlight should stay on r0
      const highlights = actions.filter((a) => a.type === 'set_highlight')
      expect(highlights).toHaveLength(0) // already on r0, no switch needed
    })

    it('buys u0 when r0 is sufficient', () => {
      const bot = new IdlerBot(idlerUpgrades)
      const state = {
        score: 0,
        resources: { r0: 0, r1: 0 },
        generators: {},
        meta: { highlight: 'r0' as const },
        upgrades: {
          u0: 0,
          u1: 0,
          u2: 0,
        },
      }
      // First call — not enough r0
      let actions = bot.decide(state)
      expect(actions.filter((a) => a.type === 'buy')).toHaveLength(0)

      // Now with enough r0
      state.resources.r0 = 30
      actions = bot.decide(state)
      expect(actions).toContainEqual({ type: 'buy', upgradeId: 'u0' })
    })

    it('returns empty actions after plan is exhausted', () => {
      const bot = new IdlerBot(idlerUpgrades)
      const state = {
        score: 0,
        resources: { r0: 200, r1: 200 },
        generators: {},
        meta: { highlight: 'r0' as const },
        upgrades: {
          u0: 0,
          u1: 0,
          u2: 0,
        },
      }

      // Buy through entire plan: u0, u1, u2 (3 steps)
      for (let i = 0; i < 3; i++) {
        bot.decide(state)
      }

      // Plan exhausted — should return empty
      const actions = bot.decide(state)
      expect(actions).toHaveLength(0)
    })
  })

  describe('createBot', () => {
    it('returns ClickerBot for clicker mode', () => {
      const bot = createBot('clicker', getModeDefinition('clicker'))
      expect(bot).toBeInstanceOf(ClickerBot)
    })

    it('returns IdlerBot for idler mode', () => {
      const bot = createBot('idler', getModeDefinition('idler'))
      expect(bot).toBeInstanceOf(IdlerBot)
    })
  })

  // ── Bot Match Integration Tests ────────────────────────────────

  describe('Match with bot', () => {
    function createBotMatch(mode: 'clicker' | 'idler' = 'clicker', bot?: BotStrategy, goal?: Goal) {
      const strategy = bot ?? createBot(mode, getModeDefinition(mode))
      return new Match({ id: 'human', ws: ws1 }, { id: 'bot-1', ws: null }, mode, goal, strategy)
    }

    it('sends ROUND_START only to the human player', () => {
      const m = createBotMatch()
      m.start()
      const starts = sentOfType(ws1, 'ROUND_START')
      expect(starts).toHaveLength(1)
    })

    it('bot earns score over time in clicker mode', () => {
      const m = createBotMatch()
      m.start()
      vi.advanceTimersByTime(COUNTDOWN_SEC * 1000) // enter playing

      // Advance a few ticks + a broadcast
      vi.advanceTimersByTime(BROADCAST_INTERVAL_MS * 4)

      const update = latestUpdate(ws1)
      expect(update).toBeDefined()
      // Bot should have earned some score from clicks
      expect(update.opponent.score).toBeGreaterThan(0)
    })

    it('bot earns score over time in idler mode', () => {
      const m = createBotMatch('idler')
      m.start()
      vi.advanceTimersByTime(COUNTDOWN_SEC * 1000)

      // Advance several seconds for passive income
      vi.advanceTimersByTime(5000)

      const update = latestUpdate(ws1)
      expect(update).toBeDefined()
      expect(update.opponent.score).toBeGreaterThan(0)
    })

    it('match ends normally with a bot (timed)', () => {
      const m = createBotMatch()
      m.start()
      vi.advanceTimersByTime(COUNTDOWN_SEC * 1000) // enter playing
      vi.advanceTimersByTime(ROUND_DURATION_SEC * 1000) // round ends

      const ends = sentOfType(ws1, 'ROUND_END')
      expect(ends).toHaveLength(1)
      expect(ends[0].reason).toBe('complete')
    })

    it('human can quit a bot match', () => {
      const m = createBotMatch()
      m.start()
      vi.advanceTimersByTime(COUNTDOWN_SEC * 1000)

      m.handleMessage('human', JSON.stringify({ type: 'QUIT' }))

      const ends = sentOfType(ws1, 'ROUND_END')
      expect(ends).toHaveLength(1)
      expect(ends[0].winner).toBe('opponent')
      expect(ends[0].reason).toBe('quit')
    })

    it('human disconnect forfeits the bot match', () => {
      const m = createBotMatch()
      const onEnd = vi.fn()
      m.onEnd(onEnd)
      m.start()
      vi.advanceTimersByTime(COUNTDOWN_SEC * 1000)

      m.handleDisconnect('human')

      // onEnd should have been called (cleanup)
      expect(onEnd).toHaveBeenCalledOnce()
    })

    it('getPlayerIds returns both human and bot IDs', () => {
      const m = createBotMatch()
      const [p1, p2] = m.getPlayerIds()
      expect(p1).toBe('human')
      expect(p2).toBe('bot-1')
    })

    it('bot match ends via target-score goal', () => {
      const target = 5
      const goal: Goal = { type: 'target-score', target, safetyCapSec: 300 }
      const m = createBotMatch('clicker', undefined, goal)
      m.start()
      vi.advanceTimersByTime(COUNTDOWN_SEC * 1000) // enter playing

      // The ClickerBot generates clicks each tick; advance enough for the bot
      // (or passive income) to reach the low target score.
      vi.advanceTimersByTime(BROADCAST_INTERVAL_MS * 20)

      const ends = sentOfType(ws1, 'ROUND_END')
      expect(ends).toHaveLength(1)
      expect(ends[0].reason).toBe('complete')
    })
  })
})
