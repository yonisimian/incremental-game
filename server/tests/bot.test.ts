import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type WebSocket from 'ws'
import type { GameMode, Goal, UpgradeDefinition } from '@game/shared'
import { COUNTDOWN_SEC, ROUND_DURATION_SEC, getModeDefinition } from '@game/shared'
import { Match } from '../src/match.js'
import { IdlerBot, createBot } from '../src/bot.js'
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

  describe('IdlerBot', () => {
    // Synthetic upgrades. The bot's hardcoded base plan is be-af-mr(r0);
    // u0/u1/u2 are kept here only as trophy-chain prereqs for the buy-upgrade test.
    const idlerUpgrades: UpgradeDefinition[] = [
      {
        id: 'be-af-mr' as const,
        cost: { r0: 5 },
        purchaseLimit: 1,
      },
      {
        id: 'u0' as const,
        cost: { r0: 30 },
        purchaseLimit: 1,
      },
      {
        id: 'u1' as const,
        cost: { r0: 25 },
        purchaseLimit: 1,
      },
      {
        id: 'u2' as const,
        cost: { r1: 25 },
        purchaseLimit: 1,
      },
    ]

    it('stays on r0 highlight first (for be-af-mr)', () => {
      const bot = new IdlerBot(idlerUpgrades)
      const state = {
        score: 0,
        resources: { r0: 0, r1: 0 },
        generators: {},
        meta: { highlight: 'r0' as const },
        upgrades: {
          'be-af-mr': 0,
          u0: 0,
          u1: 0,
          u2: 0,
        },
      }
      const actions = bot.decide(state)
      // First plan step is be-af-mr (costs r0), highlight should stay on r0
      const highlights = actions.filter((a) => a.type === 'set_highlight')
      expect(highlights).toHaveLength(0) // already on r0, no switch needed
    })

    it('buys be-af-mr when r0 is sufficient', () => {
      const bot = new IdlerBot(idlerUpgrades)
      const state = {
        score: 0,
        resources: { r0: 0, r1: 0 },
        generators: {},
        meta: { highlight: 'r0' as const },
        upgrades: {
          'be-af-mr': 0,
          u0: 0,
          u1: 0,
          u2: 0,
        },
      }
      // First call — not enough r0
      let actions = bot.decide(state)
      expect(actions.filter((a) => a.type === 'buy')).toHaveLength(0)

      // Now with enough r0 for be-af-mr (costs 5)
      state.resources.r0 = 5
      actions = bot.decide(state)
      expect(actions).toContainEqual({ type: 'buy', upgradeId: 'be-af-mr' })
    })

    it('returns empty actions after plan is exhausted', () => {
      const bot = new IdlerBot(idlerUpgrades)
      const state = {
        score: 0,
        resources: { r0: 200, r1: 200 },
        generators: {},
        meta: { highlight: 'r0' as const },
        upgrades: {
          'be-af-mr': 0,
          u0: 0,
          u1: 0,
          u2: 0,
        },
      }

      // Buy through the entire base plan: be-af-mr (1 step); extra calls are no-ops
      for (let i = 0; i < 4; i++) {
        bot.decide(state)
      }

      // Plan exhausted — should return empty
      const actions = bot.decide(state)
      expect(actions).toHaveLength(0)
    })

    it('appends trophy prereqs to plan under buy-upgrade goal', () => {
      const upgWithTrophy = [
        ...idlerUpgrades,
        {
          id: 'u4' as const,
          cost: { r0: 50 },
          purchaseLimit: 1,
          prerequisites: {
            type: 'all' as const,
            items: [
              { type: 'upgrade' as const, id: 'u1' },
              { type: 'upgrade' as const, id: 'u0' },
              { type: 'upgrade' as const, id: 'u2' },
            ],
          },
        },
        {
          id: 'u5' as const,
          cost: { r0: 1000 },
          purchaseLimit: 1,
          goalType: 'buy-upgrade' as const,
          prerequisites: { type: 'all' as const, items: [{ type: 'upgrade' as const, id: 'u4' }] },
        },
      ]
      const bot = new IdlerBot(upgWithTrophy)
      const state = {
        score: 0,
        resources: { r0: 9999, r1: 9999 },
        generators: {},
        meta: { highlight: 'r0' as const },
        upgrades: { 'be-af-mr': 0, u0: 0, u1: 0, u2: 0, u4: 0, u5: 0 },
      }

      // Run through all plan steps (be-af-mr, u0, u1, u2, u4, u5 = 6 steps)
      const buyIds: string[] = []
      for (let i = 0; i < 10; i++) {
        const actions = bot.decide(state)
        for (const a of actions) {
          if (a.type === 'buy') buyIds.push(a.upgradeId)
        }
      }

      expect(buyIds).toContain('u4')
      expect(buyIds).toContain('u5')
      // Trophy prereqs must come before trophy
      expect(buyIds.indexOf('u4')).toBeLessThan(buyIds.indexOf('u5'))
    })
  })

  describe('createBot', () => {
    it('returns IdlerBot for idler mode', () => {
      const bot = createBot('idler', getModeDefinition('idler'))
      expect(bot).toBeInstanceOf(IdlerBot)
    })
  })

  // ── Bot Match Integration Tests ────────────────────────────────

  describe('Match with bot', () => {
    function createBotMatch(mode: GameMode = 'idler', bot?: BotStrategy, goal?: Goal) {
      const strategy = bot ?? createBot(mode, getModeDefinition(mode))
      return new Match({ id: 'human', ws: ws1 }, { id: 'bot-1', ws: null }, mode, goal, strategy)
    }

    it('sends ROUND_START only to the human player', () => {
      const m = createBotMatch()
      m.start()
      const starts = sentOfType(ws1, 'ROUND_START')
      expect(starts).toHaveLength(1)
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
      const timedGoal: Goal = { type: 'timed', label: '⏱ Timed', durationSec: ROUND_DURATION_SEC }
      const m = createBotMatch('idler', undefined, timedGoal)
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
      const goal: Goal = {
        type: 'target-score',
        label: '🎯 Race to Score',
        target,
        safetyCapSec: 300,
      }
      // Passive bot (no purchases) so idler base income (1/s) climbs monotonically
      // to the low target without spending the score resource.
      const passiveBot: BotStrategy = { decide: () => [] }
      const m = createBotMatch('idler', passiveBot, goal)
      m.start()
      vi.advanceTimersByTime(COUNTDOWN_SEC * 1000) // enter playing

      // Idler earns r0 passively at 1/s; advance well past the target.
      vi.advanceTimersByTime(10000)

      const ends = sentOfType(ws1, 'ROUND_END')
      expect(ends).toHaveLength(1)
      expect(ends[0].reason).toBe('complete')
    })
  })
})
