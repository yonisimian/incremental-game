import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Goal, RoundEndMessage, RoundStartMessage, StateUpdateMessage } from '@game/shared'
import {
  COUNTDOWN_SEC,
  getAvailableUpgrades,
  getAttackPrepareCost,
  getModeDefinition,
  isMaxed,
  isUnlimited,
  ROUND_DURATION_SEC,
} from '@game/shared'
import idlerTreeFile from '@game/shared/trees/idler.json'

// ─── Module-level mocks ──────────────────────────────────────────────

// Mock network.ts — game.ts imports getSeq, queueAction, resetSeq, send* from it.
vi.mock('../src/network.js', () => {
  let seq = 0
  return {
    getSeq: vi.fn(() => seq),
    queueAction: vi.fn(),
    resetSeq: vi.fn(() => {
      seq = 0
    }),
    sendQuickMatch: vi.fn(() => true),
    sendRoomCreate: vi.fn(() => true),
    sendRoomJoin: vi.fn(() => true),
    sendRoomUpdate: vi.fn(),
    sendQuit: vi.fn(),
    sendBotRequest: vi.fn(),
  }
})

// ─── Helpers ─────────────────────────────────────────────────────────

type GameModule = typeof import('../src/game.js')

async function loadGame(): Promise<GameModule> {
  vi.resetModules()
  // resetModules wipes the runtime mode registry — re-register the tree on the
  // fresh module instance before importing code that reads it.
  const shared = await import('@game/shared')
  shared.loadTree(idlerTreeFile)
  return await import('../src/game.js')
}

const defaultTimedGoal: Goal = { type: 'timed', label: '⏱ Timed', durationSec: ROUND_DURATION_SEC }

const idlerDef = getModeDefinition('idler')

function makeRoundStart(overrides: Partial<RoundStartMessage> = {}): RoundStartMessage {
  return {
    type: 'ROUND_START',
    matchId: 'test-match',
    config: { mode: 'idler', goal: defaultTimedGoal },
    opponentName: '',
    vsBot: false,
    serverTime: Date.now(),
    ...overrides,
  }
}

const defaultUpgrades: Record<string, number> = {
  'sh-unlock': 0,
  'sc-unlock': 0,
}

function makeStateUpdate(overrides: Partial<StateUpdateMessage> = {}): StateUpdateMessage {
  return {
    type: 'STATE_UPDATE',
    tick: 1,
    ackSeq: 0,
    player: {
      score: 0,
      resources: { r0: 0 },
      upgrades: { ...defaultUpgrades },
      generators: {},
      pendingAttacks: [],
      meta: {},
    },
    opponent: {
      score: 0,
      resources: { r0: 0 },
      rates: {},
    },
    timeLeft: 55,
    paused: false,
    ...overrides,
  }
}

function makeRoundEnd(overrides: Partial<RoundEndMessage> = {}): RoundEndMessage {
  return {
    type: 'ROUND_END',
    winner: 'player',
    reason: 'complete',
    finalScores: { player: 42, opponent: 10 },
    stats: { totalClicks: 30, peakCps: 8, upgradesPurchased: [] },
    ...overrides,
  }
}

/** Advance into the 'playing' state by sending ROUND_START + ticking through countdown. */
function enterPlaying(game: GameModule): void {
  game.handleServerMessage(makeRoundStart())
  advancePastCountdown()
}

/** Enter idler-mode playing state. */
function enterIdlerPlaying(game: GameModule): void {
  game.handleServerMessage(
    makeRoundStart({
      config: { mode: 'idler', goal: defaultTimedGoal },
    }),
  )
  advancePastCountdown()
}

/**
 * Tick through the countdown into the playing phase. The countdown interval
 * fires once per second and always needs at least one tick to transition (it
 * decrements then checks `<= 0`), so advance at least 1s even when
 * `COUNTDOWN_SEC` is 0.
 */
function advancePastCountdown(): void {
  vi.advanceTimersByTime(Math.max(COUNTDOWN_SEC, 1) * 1000)
}

// ─── Tests ───────────────────────────────────────────────────────────

describe('game.ts', () => {
  let game: GameModule

  beforeEach(async () => {
    vi.useFakeTimers()
    game = await loadGame()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ── Initial state ────────────────────────────────────────────────

  describe('initial state', () => {
    it('starts on the lobby screen', () => {
      expect(game.getState().screen).toBe('lobby')
    })

    it('has zeroed player state', () => {
      const s = game.getState()
      expect(s.player.score).toBe(0)
    })
  })

  // ── quickMatch → waiting ─────────────────────────────────────────

  describe('quickMatch', () => {
    it('transitions from lobby to waiting', () => {
      game.quickMatch()
      expect(game.getState().screen).toBe('waiting')
    })

    it('is a no-op outside lobby', () => {
      game.quickMatch()
      game.quickMatch() // already on waiting screen
      expect(game.getState().screen).toBe('waiting')
    })

    it('stays on lobby when WebSocket is not connected', async () => {
      const { sendQuickMatch } = await import('../src/network.js')
      vi.mocked(sendQuickMatch).mockReturnValueOnce(false) // simulate disconnected
      game.quickMatch()
      expect(game.getState().screen).toBe('lobby')
    })
  })

  // ── ROUND_START → countdown ──────────────────────────────────────

  describe('ROUND_START', () => {
    it('transitions to countdown screen', () => {
      game.handleServerMessage(makeRoundStart())
      expect(game.getState().screen).toBe('countdown')
    })

    it('stores matchId and upgrade definitions', () => {
      game.handleServerMessage(makeRoundStart({ matchId: 'm-123' }))
      const s = game.getState()
      expect(s.matchId).toBe('m-123')
      // Upgrades are derived from the registered tree for this goal (the timed
      // goal excludes the buy-upgrade trophy), not copied off the wire.
      expect(s.upgrades.length).toBe(getAvailableUpgrades(idlerDef, defaultTimedGoal).length)
    })

    it('counts down from COUNTDOWN_SEC to playing', () => {
      game.handleServerMessage(makeRoundStart())
      expect(game.getState().countdown).toBe(COUNTDOWN_SEC)

      for (let i = COUNTDOWN_SEC - 1; i >= 1; i--) {
        vi.advanceTimersByTime(1000)
        expect(game.getState().countdown).toBe(i)
        expect(game.getState().screen).toBe('countdown')
      }

      vi.advanceTimersByTime(1000)
      expect(game.getState().screen).toBe('playing')
    })

    it('derives upgrades from the registered tree with unlimited limits intact', () => {
      // The client derives upgrades from its own registered tree rather than the
      // wire, so `Infinity` purchase limits survive (they would otherwise be
      // mangled to `null` by JSON transport) and are never treated as maxed.
      const unlimitedId = idlerDef.upgrades.find(isUnlimited)!.id
      game.handleServerMessage(makeRoundStart())
      const stored = game.getState().upgrades.find((u) => u.id === unlimitedId)!
      expect(stored.purchaseLimit).toBe(Infinity)
      expect(isUnlimited(stored)).toBe(true)
      expect(isMaxed(stored, 0)).toBe(false)
      expect(isMaxed(stored, 5)).toBe(false)
    })
  })

  // ── Clicks (optimistic) ──────────────────────────────────────────

  describe('doClick', () => {
    it('is a no-op outside playing screen', () => {
      // Still on 'lobby'
      game.doClick()
      expect(game.getState().player.score).toBe(0)
    })

    it('is a no-op in idler mode', () => {
      enterIdlerPlaying(game)
      expect(game.getState().screen).toBe('playing')

      game.doClick()
      expect(game.getState().player.score).toBe(0)
    })
  })

  // ── Purchases (optimistic) ───────────────────────────────────────

  describe('doBuy', () => {
    it('is a no-op outside playing screen', () => {
      game.doBuy('u1')
      expect(game.getState().player.upgrades.u1).toBeUndefined()
    })
  })

  describe('doBuyGeneratorMax', () => {
    it('buys the maximum affordable generators and queues actions', async () => {
      enterIdlerPlaying(game)
      game.handleServerMessage(
        makeStateUpdate({
          ackSeq: 0,
          player: {
            score: 0,
            resources: { r1: 100 },
            // g0 is gated behind the g1-g2 upgrade; grant it so buy-max applies.
            upgrades: { ...defaultUpgrades, 'g1-g2': 1 },
            generators: {},
            pendingAttacks: [],
            meta: {},
          },
          opponent: {
            score: 0,
            resources: { r0: 0 },
            rates: {},
          },
          timeLeft: 55,
        }),
      )

      const { queueAction } = await import('../src/network.js')
      vi.mocked(queueAction).mockClear()

      game.doBuyGeneratorMax('g0')
      const s = game.getState()
      const count = s.player.generators.g0

      expect(count).toBeGreaterThan(0)
      expect(s.player.resources.r1).toBeLessThan(100)
      expect(vi.mocked(queueAction)).toHaveBeenCalledTimes(count)
    })
  })

  describe('doSellGenerator', () => {
    it('sells a generator optimistically and queues a sell action', async () => {
      enterIdlerPlaying(game)
      game.handleServerMessage(
        makeStateUpdate({
          ackSeq: 0,
          player: {
            score: 0,
            resources: { r1: 0 },
            upgrades: { ...defaultUpgrades, 'g1-g2': 1 },
            generators: { g0: 1 },
            pendingAttacks: [],
            meta: {},
          },
          opponent: {
            score: 0,
            resources: { r0: 0 },
            rates: {},
          },
          timeLeft: 55,
        }),
      )

      const { queueAction } = await import('../src/network.js')
      vi.mocked(queueAction).mockClear()

      game.doSellGenerator('g0')

      const s = game.getState()
      expect(s.player.generators.g0).toBe(0)
      expect(s.player.resources.r1).toBeGreaterThan(0)
      expect(vi.mocked(queueAction)).toHaveBeenCalledTimes(1)
      expect(vi.mocked(queueAction)).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'sell_generator', generatorId: 'g0' }),
      )
    })

    it('replays an unacked sell action on top of server state', () => {
      enterIdlerPlaying(game)
      game.handleServerMessage(
        makeStateUpdate({
          ackSeq: 0,
          player: {
            score: 0,
            resources: { r1: 0 },
            upgrades: { ...defaultUpgrades, 'g1-g2': 1 },
            generators: { g0: 1 },
            pendingAttacks: [],
            meta: {},
          },
          opponent: {
            score: 0,
            resources: { r0: 0 },
            rates: {},
          },
          timeLeft: 55,
        }),
      )

      game.doSellGenerator('g0')
      expect(game.getState().player.generators.g0).toBe(0)
      expect(game.getState().player.resources.r1).toBeGreaterThan(0)

      game.handleServerMessage(
        makeStateUpdate({
          ackSeq: 0,
          player: {
            score: 0,
            resources: { r1: 0 },
            upgrades: { ...defaultUpgrades, 'g1-g2': 1 },
            generators: { g0: 1 },
            pendingAttacks: [],
            meta: {},
          },
          opponent: {
            score: 0,
            resources: { r0: 0 },
            rates: {},
          },
          timeLeft: 54,
        }),
      )

      const s = game.getState()
      expect(s.player.generators.g0).toBe(0)
      expect(s.player.resources.r1).toBeGreaterThan(0)
    })
  })

  // ── Active attacks (optimistic) ──────────────────────────────────

  describe('doActivateAttack', () => {
    // Resolve the (flattened) upgrade ids that gate the attack panel and a0, so
    // the test tracks the tree rather than hard-coding authoring ids.
    const panelUpgrade = idlerDef.upgrades.find((u) =>
      u.effects?.some(
        (e) => e.type === 'panelUnlock' && (e as { panel?: string }).panel === 'attack',
      ),
    )!
    const a0Upgrade = idlerDef.upgrades.find((u) =>
      u.effects?.some(
        (e) => e.type === 'unlockAttack' && (e as { attack?: string }).attack === 'a0',
      ),
    )!

    /** a0's authored Wood prepare cost, read from the tree rather than pinned here. */
    const woodCost = getAttackPrepareCost(idlerDef.attacks.find((a) => a.id === 'a0')!).r0
    /** Wood held by an armed player: the cost over again, so a strike leaves a remainder. */
    const armedWood = woodCost * 2

    /** A player snapshot that has the panel + a0 unlocked and enough Wood to arm. */
    function armedPlayer(): StateUpdateMessage['player'] {
      return {
        score: 0,
        resources: { r0: armedWood },
        upgrades: { ...defaultUpgrades, [panelUpgrade.id]: 1, [a0Upgrade.id]: 1 },
        generators: {},
        pendingAttacks: [],
        meta: { gameSec: 5 },
      }
    }

    it('activates optimistically, deducts the prepare cost, and queues an action', async () => {
      enterIdlerPlaying(game)
      game.handleServerMessage(makeStateUpdate({ ackSeq: 0, player: armedPlayer() }))

      const { queueAction } = await import('../src/network.js')
      vi.mocked(queueAction).mockClear()

      game.doActivateAttack('a0')

      const s = game.getState()
      expect(s.player.pendingAttacks).toHaveLength(1)
      expect(s.player.pendingAttacks[0]?.attack).toBe('a0')
      expect(s.player.resources.r0).toBe(armedWood - woodCost)
      expect(vi.mocked(queueAction)).toHaveBeenCalledTimes(1)
      expect(vi.mocked(queueAction)).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'activate_attack', attackId: 'a0' }),
      )
    })

    it('is a no-op when the prepare cost is unaffordable', async () => {
      enterIdlerPlaying(game)
      game.handleServerMessage(
        makeStateUpdate({
          ackSeq: 0,
          player: { ...armedPlayer(), resources: { r0: Math.max(0, woodCost - 1) } },
        }),
      )

      const { queueAction } = await import('../src/network.js')
      vi.mocked(queueAction).mockClear()

      game.doActivateAttack('a0')

      expect(game.getState().player.pendingAttacks).toHaveLength(0)
      expect(vi.mocked(queueAction)).not.toHaveBeenCalled()
    })

    it('replays an unacked activation on top of server state', () => {
      enterIdlerPlaying(game)
      game.handleServerMessage(makeStateUpdate({ ackSeq: 0, player: armedPlayer() }))

      game.doActivateAttack('a0')
      expect(game.getState().player.pendingAttacks).toHaveLength(1)

      // A server snapshot that still hasn't acked the activation — it must be
      // re-applied so the pending strike doesn't flicker away.
      game.handleServerMessage(makeStateUpdate({ ackSeq: 0, player: armedPlayer() }))
      const s = game.getState()
      expect(s.player.pendingAttacks).toHaveLength(1)
      expect(s.player.resources.r0).toBe(armedWood - woodCost)
    })
  })

  describe('STATE_UPDATE', () => {
    it('adopts server state when no pending actions', () => {
      enterPlaying(game)
      game.handleServerMessage(
        makeStateUpdate({
          ackSeq: 0,
          player: {
            score: 5,
            resources: { r0: 5 },
            upgrades: { ...defaultUpgrades },
            generators: {},
            pendingAttacks: [],
            meta: {},
          },
          opponent: {
            score: 3,
            resources: { r0: 3 },
            rates: {},
          },
          timeLeft: 50,
        }),
      )

      const s = game.getState()
      expect(s.player.score).toBe(5)
      expect(s.opponent.score).toBe(3)
      expect(s.timeLeft).toBe(50)
    })

    it('stores incoming debuffs and clears them on the next debuff-free update', () => {
      enterPlaying(game)
      game.handleServerMessage(
        makeStateUpdate({
          debuffs: [{ stage: 'multiplicative', field: 'r0', value: 0.9 }],
        }),
      )
      expect(game.getState().debuffs).toEqual([
        { stage: 'multiplicative', field: 'r0', value: 0.9 },
      ])

      // An update without `debuffs` resets to empty (no lingering debuff).
      game.handleServerMessage(makeStateUpdate())
      expect(game.getState().debuffs).toEqual([])
    })

    it('resets debuffs at the start of a new round', () => {
      enterPlaying(game)
      game.handleServerMessage(
        makeStateUpdate({
          debuffs: [{ stage: 'multiplicative', field: 'r0', value: 0.9 }],
        }),
      )
      expect(game.getState().debuffs).toHaveLength(1)

      game.handleServerMessage(makeRoundStart())
      expect(game.getState().debuffs).toEqual([])
    })

    it('drops acknowledged batches', () => {
      enterIdlerPlaying(game)
      // Give currency and make an optimistic purchase
      game.handleServerMessage(
        makeStateUpdate({
          ackSeq: 0,
          player: {
            score: 50,
            resources: { r0: 50 },
            upgrades: { ...defaultUpgrades },
            generators: {},
            pendingAttacks: [],
            meta: {},
          },
        }),
      )
      game.doBuy('sc-unlock') // costs 50, optimistic

      // Server acks all pending batches and reports the post-purchase state
      game.handleServerMessage(
        makeStateUpdate({
          ackSeq: 999, // acks everything
          player: {
            score: 50,
            resources: { r0: 0 },
            upgrades: { ...defaultUpgrades, 'sc-unlock': 1 },
            generators: {},
            pendingAttacks: [],
            meta: {},
          },
        }),
      )

      // No pending → adopts server state exactly
      expect(game.getState().player.resources.r0).toBe(0)
      expect(game.getState().player.upgrades['sc-unlock']).toBe(1)
    })

    it('replays unacked purchases on top of server state', () => {
      enterPlaying(game)

      // Give the player enough currency via server state
      game.handleServerMessage(
        makeStateUpdate({
          ackSeq: 0,
          player: {
            score: 50,
            resources: { r0: 50 },
            upgrades: { ...defaultUpgrades },
            generators: {},
            pendingAttacks: [],
            meta: {},
          },
        }),
      )

      // Buy sc-unlock (costs 50) — optimistic
      game.doBuy('sc-unlock')
      expect(game.getState().player.upgrades['sc-unlock']).toBe(1)
      expect(game.getState().player.resources.r0).toBe(0)

      // Server sends update that hasn't seen the buy yet (ackSeq=0)
      game.handleServerMessage(
        makeStateUpdate({
          ackSeq: 0,
          player: {
            score: 55,
            resources: { r0: 55 },
            upgrades: { ...defaultUpgrades },
            generators: {},
            pendingAttacks: [],
            meta: {},
          },
        }),
      )

      // Pending purchase should be replayed on top of server state
      expect(game.getState().player.upgrades['sc-unlock']).toBe(1)
      expect(game.getState().player.resources.r0).toBe(5) // 55 - 50
    })

    it('replays unacked highlight on top of server state', () => {
      enterIdlerPlaying(game)

      // Give player the highlight-unlock upgrade so setHighlight works
      game.handleServerMessage(
        makeStateUpdate({
          player: {
            score: 5,
            resources: { r0: 5, r1: 5 },
            upgrades: { 'sh-unlock': 1 },
            generators: {},
            pendingAttacks: [],
            meta: { highlight: 'r0' },
          },
        }),
      )

      game.setHighlight('r1')
      expect(game.getState().player.meta.highlight).toBe('r1')

      // Server sends update that still shows old highlight
      game.handleServerMessage(
        makeStateUpdate({
          ackSeq: 0,
          player: {
            score: 5,
            resources: { r0: 5, r1: 5 },
            upgrades: { 'sh-unlock': 1 },
            generators: {},
            pendingAttacks: [],
            meta: { highlight: 'r0' },
          },
        }),
      )

      // Pending highlight should be replayed
      expect(game.getState().player.meta.highlight).toBe('r1')
    })

    it('replays an unacked highlight release on top of server state', () => {
      enterIdlerPlaying(game)

      const serverPlayer = {
        score: 5,
        resources: { r0: 5, r1: 5 },
        upgrades: { 'sh-unlock': 1 },
        generators: {},
        pendingAttacks: [],
        meta: { highlight: 'r0' },
      }
      game.handleServerMessage(makeStateUpdate({ player: serverPlayer }))

      game.setHighlight(null)
      expect(game.getState().player.meta.highlight).toBeNull()

      // A snapshot that predates the release must not resurrect the old
      // selection — the replay has to re-apply the release, not just switches.
      game.handleServerMessage(makeStateUpdate({ ackSeq: 0, player: serverPlayer }))
      expect(game.getState().player.meta.highlight).toBeNull()
    })
  })

  // ── ROUND_END ────────────────────────────────────────────────────

  describe('ROUND_END', () => {
    it('transitions to ended screen', () => {
      enterPlaying(game)
      game.handleServerMessage(makeRoundEnd())
      expect(game.getState().screen).toBe('ended')
    })

    it('stores end data', () => {
      enterPlaying(game)
      game.handleServerMessage(makeRoundEnd({ winner: 'opponent' }))
      expect(game.getState().endData!.winner).toBe('opponent')
    })

    it('sets final scores from server', () => {
      enterPlaying(game)
      game.handleServerMessage(
        makeRoundEnd({
          finalScores: { player: 100, opponent: 50 },
        }),
      )
      expect(game.getState().player.score).toBe(100)
      expect(game.getState().opponent.score).toBe(50)
    })
  })

  // ── resetForMatch ────────────────────────────────────────────────

  describe('resetForMatch', () => {
    it('resets to lobby screen with clean state', () => {
      enterPlaying(game)
      game.handleServerMessage(
        makeStateUpdate({
          player: {
            score: 10,
            resources: { r0: 10 },
            upgrades: { ...defaultUpgrades },
            generators: {},
            pendingAttacks: [],
            meta: {},
          },
        }),
      )
      game.resetForMatch()

      const s = game.getState()
      expect(s.screen).toBe('lobby')
      expect(s.mode).toBeNull()
      expect(s.player.score).toBe(0)
      expect(s.matchId).toBeNull()
      expect(s.endData).toBeNull()
      expect(s.countdown).toBe(COUNTDOWN_SEC)
    })
  })

  // ── cancelQueue ────────────────────────────────────────────────────

  describe('cancelQueue', () => {
    it('transitions from waiting to lobby', async () => {
      game.quickMatch()
      expect(game.getState().screen).toBe('waiting')
      game.cancelQueue()
      expect(game.getState().screen).toBe('lobby')
      const { sendQuit } = await import('../src/network.js')
      expect(vi.mocked(sendQuit)).toHaveBeenCalledOnce()
    })

    it('is a no-op on lobby screen', () => {
      game.cancelQueue()
      expect(game.getState().screen).toBe('lobby')
    })

    it('is a no-op on playing screen', () => {
      enterPlaying(game)
      game.cancelQueue()
      expect(game.getState().screen).toBe('playing')
    })
  })

  // ── quitMatch ──────────────────────────────────────────────────────

  describe('quitMatch', () => {
    it('transitions to lobby from playing', async () => {
      enterPlaying(game)
      const { sendQuit } = await import('../src/network.js')
      vi.mocked(sendQuit).mockClear()
      game.quitMatch()
      expect(game.getState().screen).toBe('lobby')
      expect(vi.mocked(sendQuit)).toHaveBeenCalledOnce()
    })

    it('transitions to lobby from countdown', () => {
      game.handleServerMessage(makeRoundStart())
      expect(game.getState().screen).toBe('countdown')
      game.quitMatch()
      expect(game.getState().screen).toBe('lobby')
    })

    it('is a no-op on lobby screen', () => {
      game.quitMatch()
      expect(game.getState().screen).toBe('lobby')
    })
  })

  // ── ROUND_END reason handling ──────────────────────────────────────

  describe('ROUND_END reason', () => {
    it('ignores quit message when user is the quitter', () => {
      enterPlaying(game)
      // Simulate: we quit, server tells us we lost
      game.handleServerMessage(makeRoundEnd({ reason: 'quit', winner: 'opponent' }))
      // Should be ignored since quitMatch() already moved us to lobby
      // Here we test that handleRoundEnd doesn't move to ended screen
      // (in real flow, quitMatch resets to lobby before this arrives)
      expect(game.getState().screen).toBe('playing') // not ended
    })

    it('shows ended screen when opponent quits', () => {
      enterPlaying(game)
      game.handleServerMessage(makeRoundEnd({ reason: 'quit', winner: 'player' }))
      expect(game.getState().screen).toBe('ended')
      expect(game.getState().endData!.reason).toBe('quit')
    })

    it('shows ended screen on forfeit', () => {
      enterPlaying(game)
      game.handleServerMessage(makeRoundEnd({ reason: 'forfeit', winner: 'player' }))
      expect(game.getState().screen).toBe('ended')
      expect(game.getState().endData!.reason).toBe('forfeit')
    })
  })

  // ── Idler: setHighlight ────────────────────────────────────────────

  describe('setHighlight', () => {
    function unlockHighlight(g: GameModule): void {
      g.handleServerMessage(
        makeStateUpdate({
          player: {
            score: 0,
            resources: { r0: 0, r1: 0 },
            upgrades: { 'sh-unlock': 1 },
            generators: {},
            pendingAttacks: [],
            meta: { highlight: 'r0' },
          },
        }),
      )
    }

    it('is a no-op before purchasing the unlock upgrade', () => {
      enterIdlerPlaying(game)
      game.setHighlight('r1')
      expect(game.getState().player.meta.highlight).toBe('r0') // unchanged
    })

    it('optimistically updates highlight after unlock', () => {
      enterIdlerPlaying(game)
      unlockHighlight(game)
      expect(game.getState().player.meta.highlight).toBe('r0') // from createInitialState
      game.setHighlight('r1')
      expect(game.getState().player.meta.highlight).toBe('r1')
    })

    it('is a no-op outside playing screen', () => {
      game.setHighlight('ale')
      expect(game.getState().screen).toBe('lobby')
    })

    it('is a no-op when already set to same value', async () => {
      enterIdlerPlaying(game)
      unlockHighlight(game)
      game.setHighlight('r1')
      const { queueAction } = await import('../src/network.js')
      vi.mocked(queueAction).mockClear()
      game.setHighlight('r1') // same value
      expect(vi.mocked(queueAction)).not.toHaveBeenCalled()
    })

    it('rejects an invalid target resource', () => {
      enterIdlerPlaying(game)
      unlockHighlight(game)
      game.setHighlight('bogus')
      expect(game.getState().player.meta.highlight).toBe('r0') // unchanged
    })

    it('releases the highlight on null', () => {
      enterIdlerPlaying(game)
      unlockHighlight(game)
      game.setHighlight(null)
      expect(game.getState().player.meta.highlight).toBeNull()
    })

    it('toggles the held resource off and a different one on', () => {
      enterIdlerPlaying(game)
      unlockHighlight(game)
      game.toggleHighlight('r0') // already held → release
      expect(game.getState().player.meta.highlight).toBeNull()
      game.toggleHighlight('r1') // nothing held → select
      expect(game.getState().player.meta.highlight).toBe('r1')
      game.toggleHighlight('r0') // a different one held → switch, not release
      expect(game.getState().player.meta.highlight).toBe('r0')
    })
  })

  // ── Idler: doBuy ───────────────────────────────────────────────────

  describe('idler doBuy', () => {
    function giveR0(g: GameModule, amount: number): void {
      g.handleServerMessage(
        makeStateUpdate({
          player: {
            score: amount,
            resources: { r0: amount, r1: 0 },
            upgrades: { 'sh-unlock': 1, 'sc-unlock': 0 },
            generators: {},
            pendingAttacks: [],
            meta: { highlight: 'r0' },
          },
        }),
      )
    }

    it('deducts r0 for r0-cost upgrades', () => {
      enterIdlerPlaying(game)
      giveR0(game, 50)
      game.doBuy('sc-unlock') // costs 50 r0
      expect(game.getState().player.upgrades['sc-unlock']).toBe(1)
      expect(game.getState().player.resources.r0).toBe(0)
    })
  })

  // ── Idler: doClick ─────────────────────────────────────────────────

  describe('idler doClick', () => {
    /** Unlock clicking (sc-unlock grants +1 clickIncome) with both buckets empty. */
    function unlockClicking(g: GameModule): void {
      g.handleServerMessage(
        makeStateUpdate({
          player: {
            score: 0,
            resources: { r0: 0, r1: 0 },
            upgrades: { 'sc-unlock': 1 },
            generators: {},
            pendingAttacks: [],
            meta: { highlight: 'r0' },
          },
        }),
      )
    }

    it('credits a clicked non-score resource without adding to score', () => {
      enterIdlerPlaying(game)
      unlockClicking(game)
      game.doClick('r1')
      const s = game.getState()
      expect(s.player.resources.r1).toBe(1) // click income credited to r1
      expect(s.player.resources.r0).toBe(0) // score bucket untouched
      expect(s.player.score).toBe(0) // clicking r1 never adds to score
    })

    it('credits the score resource and adds to score', () => {
      enterIdlerPlaying(game)
      unlockClicking(game)
      game.doClick('r0') // r0 is the score resource
      const s = game.getState()
      expect(s.player.resources.r0).toBe(1)
      expect(s.player.score).toBe(1)
    })

    it('defaults to the score resource when no target is given', () => {
      enterIdlerPlaying(game)
      unlockClicking(game)
      game.doClick()
      const s = game.getState()
      expect(s.player.resources.r0).toBe(1)
      expect(s.player.score).toBe(1)
    })

    it('falls back to the score resource for an unknown target', () => {
      enterIdlerPlaying(game)
      unlockClicking(game)
      game.doClick('bogus')
      const s = game.getState()
      expect(s.player.resources.r0).toBe(1)
      expect(s.player.score).toBe(1)
      expect(s.player.resources.bogus).toBeUndefined()
    })
  })

  // ── Click target (cycled by the Z hotkey) ──────────────────────────

  describe('click target', () => {
    /** Unlock clicking with both buckets empty so the Z hotkey is active. */
    function unlockClicking(g: GameModule): void {
      g.handleServerMessage(
        makeStateUpdate({
          player: {
            score: 0,
            resources: { r0: 0, r1: 0 },
            upgrades: { 'sc-unlock': 1 },
            generators: {},
            pendingAttacks: [],
            meta: {},
          },
        }),
      )
    }

    it('defaults to the score resource', () => {
      enterIdlerPlaying(game)
      unlockClicking(game)
      expect(game.getClickTarget(idlerDef)).toBe('r0') // r0 is the score resource
    })

    it('cycleClickTarget advances to the next resource', () => {
      enterIdlerPlaying(game)
      unlockClicking(game)
      game.cycleClickTarget()
      expect(game.getClickTarget(idlerDef)).toBe('r1')
    })

    it('cycleClickTarget wraps back to the first resource', () => {
      enterIdlerPlaying(game)
      unlockClicking(game)
      game.cycleClickTarget() // r0 -> r1
      game.cycleClickTarget() // r1 -> r0 (wrap)
      expect(game.getClickTarget(idlerDef)).toBe('r0')
    })

    it('doClick() with no target uses the cycled target', () => {
      enterIdlerPlaying(game)
      unlockClicking(game)
      game.cycleClickTarget() // now targeting r1
      game.doClick()
      const s = game.getState()
      expect(s.player.resources.r1).toBe(1) // credited the cycled target
      expect(s.player.resources.r0).toBe(0) // score bucket untouched
      expect(s.player.score).toBe(0) // r1 is not the score resource
    })

    it('an explicit doClick target still wins over the cycled target', () => {
      enterIdlerPlaying(game)
      unlockClicking(game)
      game.cycleClickTarget() // targeting r1
      game.doClick('r0') // explicit target overrides
      const s = game.getState()
      expect(s.player.resources.r0).toBe(1)
      expect(s.player.score).toBe(1)
    })

    it('cycleClickTarget is a no-op when clicking is locked', () => {
      enterIdlerPlaying(game) // sc-unlock not owned → clicking locked
      game.cycleClickTarget()
      expect(game.getClickTarget(idlerDef)).toBe('r0') // unchanged
    })

    it('cycleClickTarget is a no-op outside the playing screen', () => {
      // Still on 'lobby'
      game.cycleClickTarget()
      expect(game.getClickTarget(idlerDef)).toBe('r0') // unchanged
    })

    it('resets to the score resource when a new round starts', () => {
      enterIdlerPlaying(game)
      unlockClicking(game)
      game.cycleClickTarget() // now targeting r1
      expect(game.getClickTarget(idlerDef)).toBe('r1')

      game.handleServerMessage(makeRoundStart()) // fresh match
      expect(game.getClickTarget(idlerDef)).toBe('r0') // back to the default
    })
  })
})
