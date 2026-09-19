import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type WebSocket from 'ws'
import type { GameMode, Goal, ModeDefinition, PlayerState, UpgradeDefinition } from '@game/shared'
import { COUNTDOWN_SEC, ROUND_DURATION_SEC, getModeDefinition } from '@game/shared'
import { Match } from '../src/match.js'
import { IdlerBot, createBot } from '../src/bot.js'
import type { BotStrategy } from '../src/bot.js'
import { createMockWs, sentOfType, latestUpdate } from './_helpers.js'

/**
 * Build a minimal idler-flavored mode whose upgrades are the supplied synthetic
 * set and which has no generators — enough to unit-test the bot's plan/click
 * logic in isolation. Generator behavior is covered separately against the real
 * idler mode.
 */
function stubMode(upgrades: UpgradeDefinition[]): ModeDefinition {
  return { ...getModeDefinition('idler'), upgrades, generators: [] }
}

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
        cost: { r0: { baseCost: 5 } },
        purchaseLimit: 1,
      },
      {
        id: 'u0' as const,
        cost: { r0: { baseCost: 30 } },
        purchaseLimit: 1,
      },
      {
        id: 'u1' as const,
        cost: { r0: { baseCost: 25 } },
        purchaseLimit: 1,
      },
      {
        id: 'u2' as const,
        cost: { r1: { baseCost: 25 } },
        purchaseLimit: 1,
      },
    ]

    // ── Lantern duty cycle ────────────────────────────────────────

    describe('lantern duty cycle', () => {
      /** The real idler mode (its tree carries the lantern nodes), no generators. */
      const mode: ModeDefinition = { ...getModeDefinition('idler'), generators: [] }

      function stateWith(upgrades: Record<string, number>, meta: Record<string, unknown>) {
        return {
          score: 0,
          resources: { r0: 0, r1: 0 },
          generators: {},
          pendingAttacks: [],
          upgrades,
          meta,
        }
      }
      /** Lantern owned, bare — at the shipped defaults this is exactly break-even. */
      const lantern = { 'sh-unlock': 1, 'shb-unlock': 1 }
      /** One Brighter Flame tips cycling ahead of holding. */
      const cycling = { ...lantern, 'shb-bp': 1 }
      const highlightOf = (actions: ReturnType<IdlerBot['decide']>) =>
        actions.filter((a) => a.type === 'set_highlight')

      it('holds the highlight when there is no lantern', () => {
        const bot = new IdlerBot(mode)
        const actions = bot.decide(stateWith({ 'sh-unlock': 1 }, { highlight: null }))
        expect(highlightOf(actions)).toEqual([{ type: 'set_highlight', highlight: 'r0' }])
      })

      it('releases the highlight once the lantern runs dry', () => {
        const bot = new IdlerBot(mode)
        const actions = bot.decide(stateWith(cycling, { highlight: 'r0', hlCharge: 0 }))
        expect(highlightOf(actions)).toEqual([{ type: 'set_highlight', highlight: null }])
      })

      it('keeps holding while the lantern still has oil', () => {
        const bot = new IdlerBot(mode)
        expect(
          highlightOf(bot.decide(stateWith(cycling, { highlight: 'r0', hlCharge: 5 }))),
        ).toEqual([])
      })

      it('stays released until the lantern is full, then resumes', () => {
        const bot = new IdlerBot(mode)
        // Drain -> release.
        bot.decide(stateWith(cycling, { highlight: 'r0', hlCharge: 0 }))
        // Partly refilled: still recharging, so no switch back yet.
        expect(
          highlightOf(bot.decide(stateWith(cycling, { highlight: null, hlCharge: 15 }))),
        ).toEqual([])
        // Full: resume holding.
        expect(
          highlightOf(bot.decide(stateWith(cycling, { highlight: null, hlCharge: 20 }))),
        ).toEqual([{ type: 'set_highlight', highlight: 'r0' }])
      })

      it('holds forever rather than cycling a bare lantern', () => {
        // At the shipped defaults (×1.5 factor, equal rates, ×2 highlight) the two
        // policies tie exactly, so releasing would buy nothing — see `worthCycling`.
        const bot = new IdlerBot(mode)
        expect(
          highlightOf(bot.decide(stateWith(lantern, { highlight: 'r0', hlCharge: 0 }))),
        ).toEqual([])
      })

      it('holds forever when a strong highlight multiplier outweighs the lantern', () => {
        // Clearer Lens compounds the highlight bonus, so the multiplier given up
        // while recharging grows faster than the lantern's share of it.
        const bot = new IdlerBot(mode)
        const actions = bot.decide(
          stateWith({ ...cycling, 'sh-mf-hp': 20 }, { highlight: 'r0', hlCharge: 0 }),
        )
        expect(highlightOf(actions)).toEqual([])
      })

      it('cycles when a slower burn stretches the hold instead', () => {
        const bot = new IdlerBot(mode)
        const actions = bot.decide(
          stateWith({ ...lantern, 'shb-mf-ds': 1 }, { highlight: 'r0', hlCharge: 0 }),
        )
        expect(highlightOf(actions)).toEqual([{ type: 'set_highlight', highlight: null }])
      })
    })

    it('stays on r0 highlight first (for be-af-mr)', () => {
      const bot = new IdlerBot(stubMode(idlerUpgrades))
      const state = {
        score: 0,
        resources: { r0: 0, r1: 0 },
        generators: {},
        pendingAttacks: [],
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
      const bot = new IdlerBot(stubMode(idlerUpgrades))
      const state = {
        score: 0,
        resources: { r0: 0, r1: 0 },
        generators: {},
        pendingAttacks: [],
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

    // Plan 40: the plan advances on *emitting* a buy, so a buy the server would
    // drop for an enemy purchase lock has to be held back, or the bot steps
    // past the upgrade for good.
    it('holds its plan step under an enemy purchase lock and buys once it lifts', () => {
      const bot = new IdlerBot(stubMode(idlerUpgrades))
      const state = {
        score: 0,
        resources: { r0: 5, r1: 0 },
        generators: {},
        pendingAttacks: [],
        meta: { highlight: 'r0' as const, gameSec: 3 },
        upgrades: { 'be-af-mr': 0, u0: 0, u1: 0, u2: 0 },
        incomingPurchaseLocks: [{ scope: 'upgrade' as const, untilSec: 10 }],
      }
      // Affordable, but locked: no buy, and — the point — no plan advance.
      for (let i = 0; i < 3; i++) {
        expect(bot.decide(state).filter((a) => a.type === 'buy')).toHaveLength(0)
      }

      // The stamp clears (the server re-stamps before every bot turn); the
      // held step is still the first plan target.
      const { incomingPurchaseLocks: _lifted, ...unlocked } = state
      expect(bot.decide(unlocked)).toContainEqual({ type: 'buy', upgradeId: 'be-af-mr' })
    })

    it('keeps clicking the score resource after the plan is exhausted', () => {
      const bot = new IdlerBot(stubMode(idlerUpgrades))
      const state = {
        score: 0,
        resources: { r0: 200, r1: 200 },
        generators: {},
        pendingAttacks: [],
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

      // Plan exhausted — no more upgrade buys, but the bot still farms score.
      const actions = bot.decide(state)
      expect(actions.filter((a) => a.type === 'buy')).toHaveLength(0)
      const clicks = actions.filter((a) => a.type === 'click')
      expect(clicks.length).toBeGreaterThan(0)
      expect(clicks.every((a) => a.resource === 'r0')).toBe(true)
    })

    it('appends trophy prereqs to plan under buy-upgrade goal', () => {
      const upgWithTrophy = [
        ...idlerUpgrades,
        {
          id: 'u4' as const,
          cost: { r0: { baseCost: 50 } },
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
          cost: { r0: { baseCost: 1000 } },
          purchaseLimit: 1,
          goalType: 'buy-upgrade' as const,
          prerequisites: { type: 'all' as const, items: [{ type: 'upgrade' as const, id: 'u4' }] },
        },
      ]
      const bot = new IdlerBot(stubMode(upgWithTrophy))
      const state = {
        score: 0,
        resources: { r0: 9999, r1: 9999 },
        generators: {},
        pendingAttacks: [],
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

    it('clicks the farmed resource each tick when clicking is enabled', () => {
      const bot = new IdlerBot(stubMode(idlerUpgrades))
      const state = {
        score: 0,
        resources: { r0: 0, r1: 0 },
        generators: {},
        pendingAttacks: [],
        meta: { highlight: 'r0' as const },
        upgrades: { 'be-af-mr': 0, u0: 0, u1: 0, u2: 0 },
      }
      const clicks = bot.decide(state).filter((a) => a.type === 'click')
      expect(clicks.length).toBeGreaterThan(0)
      // First plan step (be-af-mr) is r0-funded, so the bot clicks r0.
      expect(clicks.every((a) => a.resource === 'r0')).toBe(true)
    })

    it('buys an unlocked, affordable generator (real idler mode)', () => {
      const mode = getModeDefinition('idler')
      const bot = new IdlerBot(mode)
      // g1-g2 owned unlocks g0/g1 (both r1-funded); fund r1 generously.
      const state = {
        score: 0,
        resources: { r0: 0, r1: 1000 },
        generators: {},
        pendingAttacks: [],
        meta: { highlight: 'r1' as const },
        upgrades: { 'g1-g2': 1 },
      }
      const genBuys = bot.decide(state).filter((a) => a.type === 'buy_generator')
      expect(genBuys.length).toBeGreaterThan(0)
    })

    it('buys action-system unlocks before depending on their actions', () => {
      const mode = getModeDefinition('idler')
      const bot = new IdlerBot(mode)
      const state = {
        score: 0,
        resources: { r0: 50, r1: 20 },
        generators: {},
        meta: { highlight: 'r0' as const },
        upgrades: {},
        pendingAttacks: [],
      }

      expect(bot.decide(state)).toContainEqual({ type: 'buy', upgradeId: 'sc-unlock' })
    })

    // Plan 41 §8: the bot fires one active attack so a solo player meets the
    // early warning. The stub keeps the real idler's attacks (a0 costs 1000 r0)
    // and swaps in a tiny tree: the base plan step, the attack's unlock chain,
    // and an expensive trophy to make "don't starve the plan" observable.
    describe('active attacks', () => {
      const attackUpgrades: UpgradeDefinition[] = [
        ...idlerUpgrades,
        {
          id: 'a-unlock' as const,
          cost: {},
          purchaseLimit: 1,
          effects: [{ type: 'panelUnlock', panel: 'attack' }],
        },
        {
          id: 'unlock-a0' as const,
          cost: {},
          purchaseLimit: 1,
          prerequisites: { type: 'upgrade' as const, id: 'a-unlock' },
          effects: [{ type: 'unlockAttack', attack: 'a0' }],
        },
        {
          id: 'trophy' as const,
          cost: { r0: { baseCost: 1500 } },
          purchaseLimit: 1,
          goalType: 'buy-upgrade' as const,
        },
      ]
      /** a0 unlocked, the base plan bought, only the trophy left to save for. */
      const armed = { 'be-af-mr': 1, 'a-unlock': 1, 'unlock-a0': 1, u0: 0, u1: 0, u2: 0, trophy: 0 }
      const stateWith = (r0: number, extra: Partial<PlayerState> = {}): PlayerState => ({
        score: 0,
        resources: { r0, r1: 0 },
        generators: {},
        pendingAttacks: [],
        meta: { highlight: 'r0', gameSec: 5 },
        upgrades: { ...armed },
        ...extra,
      })
      /** Advance the bot past the plan steps it already owns, up to the trophy. */
      function botAtTrophy(): IdlerBot {
        const bot = new IdlerBot(stubMode(attackUpgrades))
        // be-af-mr, a-unlock, unlock-a0 are affordable (owned or free) and get
        // emitted-and-advanced; the 1500 trophy is not, so the plan holds there.
        for (let i = 0; i < 4; i++) bot.decide(stateWith(100))
        return bot
      }
      const attacksOf = (actions: ReturnType<IdlerBot['decide']>) =>
        actions.filter((a) => a.type === 'activate_attack')

      it('puts the attack panel and one attack unlock on its plan, in order', () => {
        const bot = new IdlerBot(stubMode(attackUpgrades))
        const buys: string[] = []
        for (let i = 0; i < 6; i++) {
          for (const a of bot.decide(stateWith(100))) if (a.type === 'buy') buys.push(a.upgradeId)
        }
        expect(buys).toContain('a-unlock')
        expect(buys).toContain('unlock-a0')
        expect(buys.indexOf('a-unlock')).toBeLessThan(buys.indexOf('unlock-a0'))
      })

      it('holds its fire while still saving for a plan step', () => {
        const bot = botAtTrophy()
        // Could pay the 1000 raid, but the 1500 trophy is still on the plan.
        expect(attacksOf(bot.decide(stateWith(1400)))).toEqual([])
      })

      it('fires from the surplus left after this tick’s buys, once the plan is done', () => {
        // 2400: buys the trophy (plan exhausted) leaving 900 — short of the raid.
        let bot = botAtTrophy()
        let actions = bot.decide(stateWith(2400))
        expect(actions).toContainEqual({ type: 'buy', upgradeId: 'trophy' })
        expect(attacksOf(actions)).toEqual([])
        // 2600: buys the trophy leaving 1100 — the raid fits in the same tick.
        bot = botAtTrophy()
        actions = bot.decide(stateWith(2600))
        expect(actions).toContainEqual({ type: 'buy', upgradeId: 'trophy' })
        expect(attacksOf(actions)).toEqual([{ type: 'activate_attack', attackId: 'a0' }])
        // And on a later tick with the plan exhausted, at exactly the prepare cost.
        expect(
          attacksOf(bot.decide(stateWith(1000, { upgrades: { ...armed, trophy: 1 } }))),
        ).toEqual([{ type: 'activate_attack', attackId: 'a0' }])
      })

      it('holds while the attack is preparing, unaffordable, or not unlocked', () => {
        const bot = botAtTrophy()
        bot.decide(stateWith(1500)) // buys the trophy → plan exhausted
        const done = { upgrades: { ...armed, trophy: 1 } }
        expect(
          attacksOf(
            bot.decide(
              stateWith(5000, { ...done, pendingAttacks: [{ attack: 'a0', readyAtSec: 11 }] }),
            ),
          ),
        ).toEqual([])
        expect(attacksOf(bot.decide(stateWith(999, done)))).toEqual([])
        expect(
          attacksOf(
            bot.decide(stateWith(5000, { upgrades: { ...armed, trophy: 1, 'unlock-a0': 0 } })),
          ),
        ).toEqual([])
      })
    })

    it('does not buy generators that are still locked', () => {
      const mode = getModeDefinition('idler')
      const bot = new IdlerBot(mode)
      // No unlock upgrades owned → every generator is gated.
      const state = {
        score: 0,
        resources: { r0: 1000, r1: 1000 },
        generators: {},
        pendingAttacks: [],
        meta: { highlight: 'r1' as const },
        upgrades: {},
      }
      const genBuys = bot.decide(state).filter((a) => a.type === 'buy_generator')
      expect(genBuys).toHaveLength(0)
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
      // Timed goal so the bot's (opponent's) score is broadcast — it's hidden
      // under the default buy-upgrade goal.
      const timedGoal: Goal = { type: 'timed', label: '⏱ Timed', durationSec: ROUND_DURATION_SEC }
      const m = createBotMatch('idler', undefined, timedGoal)
      m.start()
      vi.advanceTimersByTime(COUNTDOWN_SEC * 1000)

      // Advance several seconds for passive income
      vi.advanceTimersByTime(5000)

      const update = latestUpdate(ws1)
      expect(update).toBeDefined()
      expect(update.opponent.score).toBeGreaterThan(0)
    })

    it('bot raids the human once funded, and the hit is counted on the human', () => {
      const timedGoal: Goal = { type: 'timed', label: '⏱ Timed', durationSec: ROUND_DURATION_SEC }
      const m = createBotMatch('idler', undefined, timedGoal)
      m.start()
      vi.advanceTimersByTime(COUNTDOWN_SEC * 1000)
      // Fund the bot in both currencies so every plan step (some cost Ale) and
      // the 1000-Wood prepare cost are within reach without waiting on income;
      // the raid is paid from surplus once the plan is exhausted.
      m.grantResourcesForTest('bot-1', { r0: 50_000, r1: 50_000 })
      m.grantResourcesForTest('human', { r0: 5000 })
      // The plan buys one step per tick; give it a few seconds, then the
      // strike's own preparation time.
      vi.advanceTimersByTime(8000)
      const a0 = getModeDefinition('idler').attacks.find((a) => a.id === 'a0')!
      vi.advanceTimersByTime(a0.prepareTimeSec! * 1000 + 1000)

      const incoming = sentOfType(ws1, 'STATE_UPDATE').flatMap((u) => u.attackEvents ?? [])
      expect(incoming).toContainEqual(
        expect.objectContaining({ attack: 'a0', direction: 'incoming', kind: 'resource' }),
      )
      expect(latestUpdate(ws1).player.meta.attacksSuffered).toBeGreaterThanOrEqual(1)
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

    it('real idler bot buys the trophy before the buy-upgrade safety cap', () => {
      const goal: Goal = {
        type: 'buy-upgrade',
        label: '🏆 Race to Buy',
        safetyCapSec: 600,
      }
      const m = createBotMatch('idler', undefined, goal)
      m.start()
      vi.advanceTimersByTime(COUNTDOWN_SEC * 1000)
      vi.advanceTimersByTime(goal.safetyCapSec * 1000)

      const ends = sentOfType(ws1, 'ROUND_END')
      expect(ends).toHaveLength(1)
      expect(ends[0].reason).toBe('complete')
      expect(ends[0].winner).toBe('opponent')
    })
  })
})
