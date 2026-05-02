import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Goal, RoundEndMessage, RoundStartMessage, StateUpdateMessage } from '@game/shared'
import { COUNTDOWN_SEC, getModeDefinition, ROUND_DURATION_SEC } from '@game/shared'

// ─── Module-level mocks ──────────────────────────────────────────────

// Mock network.ts — game.ts imports getSeq, queueAction, resetSeq, sendModeSelect from it.
vi.mock('../src/network.js', () => {
  let seq = 0
  return {
    getSeq: vi.fn(() => seq),
    queueAction: vi.fn(),
    resetSeq: vi.fn(() => {
      seq = 0
    }),
    sendModeSelect: vi.fn(() => true),
    sendQuit: vi.fn(),
    sendBotRequest: vi.fn(),
  }
})

// ─── Helpers ─────────────────────────────────────────────────────────

type GameModule = typeof import('../src/game.js')

async function loadGame(): Promise<GameModule> {
  vi.resetModules()
  return await import('../src/game.js')
}

const defaultTimedGoal: Goal = { type: 'timed', durationSec: ROUND_DURATION_SEC }

const clickerDef = getModeDefinition('clicker')
const idlerDef = getModeDefinition('idler')

function makeRoundStart(overrides: Partial<RoundStartMessage> = {}): RoundStartMessage {
  return {
    type: 'ROUND_START',
    matchId: 'test-match',
    config: { mode: 'clicker', goal: defaultTimedGoal, upgrades: [...clickerDef.upgrades] },
    opponentName: '',
    serverTime: Date.now(),
    ...overrides,
  }
}

const defaultUpgrades: Record<string, number> = {
  'double-click': 0,
  multiplier: 0,
}

function makeStateUpdate(overrides: Partial<StateUpdateMessage> = {}): StateUpdateMessage {
  return {
    type: 'STATE_UPDATE',
    tick: 1,
    ackSeq: 0,
    player: {
      score: 0,
      resources: { currency: 0 },
      upgrades: { ...defaultUpgrades },
      generators: {},
      meta: {},
    },
    opponent: {
      score: 0,
      resources: { currency: 0 },
      upgrades: { ...defaultUpgrades },
      generators: {},
      meta: {},
    },
    timeLeft: 55,
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
  vi.advanceTimersByTime(COUNTDOWN_SEC * 1000)
}

/** Enter idler-mode playing state. */
function enterIdlerPlaying(game: GameModule): void {
  game.handleServerMessage(
    makeRoundStart({
      config: { mode: 'idler', goal: defaultTimedGoal, upgrades: [...idlerDef.upgrades] },
    }),
  )
  vi.advanceTimersByTime(COUNTDOWN_SEC * 1000)
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

  // ── selectMode → waiting ─────────────────────────────────────────

  describe('selectMode', () => {
    it('transitions from lobby to waiting', () => {
      game.selectMode('clicker', defaultTimedGoal)
      expect(game.getState().screen).toBe('waiting')
      expect(game.getState().mode).toBe('clicker')
    })

    it('is a no-op outside lobby', () => {
      game.selectMode('clicker', defaultTimedGoal)
      game.selectMode('idler', defaultTimedGoal) // already on waiting screen
      expect(game.getState().mode).toBe('clicker')
    })

    it('stays on lobby when WebSocket is not connected', async () => {
      const { sendModeSelect } = await import('../src/network.js')
      vi.mocked(sendModeSelect).mockReturnValueOnce(false) // simulate disconnected
      game.selectMode('clicker', defaultTimedGoal)
      expect(game.getState().screen).toBe('lobby')
      expect(game.getState().mode).toBeNull()
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
      expect(s.upgrades.length).toBe(clickerDef.upgrades.length)
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
  })

  // ── Clicks (optimistic) ──────────────────────────────────────────

  describe('doClick', () => {
    it('increments score and currency by 1', () => {
      enterPlaying(game)
      game.doClick()

      const s = game.getState()
      expect(s.player.score).toBe(1)
      expect(s.player.resources.currency).toBe(1)
    })

    it('accumulates multiple clicks', () => {
      enterPlaying(game)
      game.doClick()
      game.doClick()
      game.doClick()

      expect(game.getState().player.score).toBe(3)
    })

    it('is a no-op outside playing screen', () => {
      // Still on 'lobby'
      game.doClick()
      expect(game.getState().player.score).toBe(0)
    })

    it('is a no-op in idler mode', () => {
      game.handleServerMessage(
        makeRoundStart({
          config: { mode: 'idler', goal: defaultTimedGoal, upgrades: [] },
        }),
      )
      vi.advanceTimersByTime(COUNTDOWN_SEC * 1000)
      expect(game.getState().screen).toBe('playing')

      game.doClick()
      expect(game.getState().player.score).toBe(0)
    })

    it('notifies the state change handler', () => {
      enterPlaying(game)
      const spy = vi.fn()
      game.setStateChangeHandler(spy)
      spy.mockClear()

      game.doClick()
      expect(spy).toHaveBeenCalledOnce()
    })
  })

  // ── Purchases (optimistic) ───────────────────────────────────────

  describe('doBuy', () => {
    it('deducts currency and grants upgrade', () => {
      enterPlaying(game)
      // double-click costs 25 — earn enough
      for (let i = 0; i < 25; i++) game.doClick()

      game.doBuy('double-click')
      const s = game.getState()
      expect(s.player.upgrades['double-click']).toBe(1)
      expect(s.player.resources.currency).toBe(0)
      expect(s.player.score).toBe(25) // score unchanged by purchase
    })

    it('rejects if not enough currency', () => {
      enterPlaying(game)
      game.doClick() // 1 currency

      game.doBuy('double-click') // costs 25
      expect(game.getState().player.upgrades['double-click']).toBe(0)
      expect(game.getState().player.resources.currency).toBe(1)
    })

    it('rejects a duplicate purchase', () => {
      enterPlaying(game)
      for (let i = 0; i < 50; i++) game.doClick()

      game.doBuy('double-click') // costs 25
      game.doBuy('double-click') // duplicate
      expect(game.getState().player.resources.currency).toBe(25) // 50 − 25, not 50 − 50
    })

    it('is a no-op outside playing screen', () => {
      game.doBuy('double-click')
      expect(game.getState().player.upgrades['double-click']).toBeUndefined()
    })
  })

  // ── Upgrade effects on click income ──────────────────────────────

  describe('upgrade effects on clicks', () => {
    it('double-click gives +2 per click', () => {
      enterPlaying(game)
      for (let i = 0; i < 25; i++) game.doClick()
      game.doBuy('double-click') // costs 25

      const before = game.getState().player.score
      game.doClick()
      expect(game.getState().player.score - before).toBe(2)
    })

    it('multiplier doubles click income', () => {
      enterPlaying(game)
      for (let i = 0; i < 100; i++) game.doClick()
      game.doBuy('multiplier') // costs 100

      const before = game.getState().player.score
      game.doClick()
      expect(game.getState().player.score - before).toBe(2) // 1 * 2
    })

    it('double-click + multiplier gives +4 per click', () => {
      enterPlaying(game)
      // earn 125 currency (25 + 100)
      for (let i = 0; i < 125; i++) game.doClick()
      game.doBuy('double-click')
      game.doBuy('multiplier')

      const before = game.getState().player.score
      game.doClick()
      expect(game.getState().player.score - before).toBe(4) // 2 * 2
    })
  })

  // ── STATE_UPDATE reconciliation ──────────────────────────────────

  describe('STATE_UPDATE', () => {
    it('adopts server state when no pending actions', () => {
      enterPlaying(game)
      game.handleServerMessage(
        makeStateUpdate({
          ackSeq: 0,
          player: {
            score: 5,
            resources: { currency: 5 },
            upgrades: { ...defaultUpgrades },
            generators: {},
            meta: {},
          },
          opponent: {
            score: 3,
            resources: { currency: 3 },
            upgrades: { ...defaultUpgrades },
            generators: {},
            meta: {},
          },
          timeLeft: 50,
        }),
      )

      const s = game.getState()
      expect(s.player.score).toBe(5)
      expect(s.opponent.score).toBe(3)
      expect(s.timeLeft).toBe(50)
    })

    it('replays unacked clicks on top of server state', () => {
      enterPlaying(game)
      // 3 optimistic clicks → score=3, currency=3
      game.doClick()
      game.doClick()
      game.doClick()

      // Server acks 0 of them (ackSeq=0), server sees score=0
      game.handleServerMessage(
        makeStateUpdate({
          ackSeq: 0,
          player: {
            score: 0,
            resources: { currency: 0 },
            upgrades: { ...defaultUpgrades },
            generators: {},
            meta: {},
          },
        }),
      )

      // Reconciled: server(0) + 3 pending clicks = 3
      expect(game.getState().player.score).toBe(3)
    })

    it('drops acknowledged batches', () => {
      enterPlaying(game)
      game.doClick()
      game.doClick()

      // Server acks all pending batches and reports score=2
      game.handleServerMessage(
        makeStateUpdate({
          ackSeq: 999, // acks everything
          player: {
            score: 2,
            resources: { currency: 2 },
            upgrades: { ...defaultUpgrades },
            generators: {},
            meta: {},
          },
        }),
      )

      // No pending → adopts server state exactly
      expect(game.getState().player.score).toBe(2)
    })

    it('replays unacked purchases on top of server state', () => {
      enterPlaying(game)

      // Give the player enough currency via server state
      game.handleServerMessage(
        makeStateUpdate({
          ackSeq: 0,
          player: {
            score: 50,
            resources: { currency: 50 },
            upgrades: { ...defaultUpgrades },
            generators: {},
            meta: {},
          },
        }),
      )

      // Buy double-click (costs 25) — optimistic
      game.doBuy('double-click')
      expect(game.getState().player.upgrades['double-click']).toBe(1)
      expect(game.getState().player.resources.currency).toBe(25)

      // Server sends update that hasn't seen the buy yet (ackSeq=0)
      game.handleServerMessage(
        makeStateUpdate({
          ackSeq: 0,
          player: {
            score: 55,
            resources: { currency: 55 },
            upgrades: { ...defaultUpgrades },
            generators: {},
            meta: {},
          },
        }),
      )

      // Pending purchase should be replayed on top of server state
      expect(game.getState().player.upgrades['double-click']).toBe(1)
      expect(game.getState().player.resources.currency).toBe(30) // 55 - 25
    })

    it('replays unacked highlight on top of server state', () => {
      enterIdlerPlaying(game)

      game.setHighlight('ale')
      expect(game.getState().player.meta.highlight).toBe('ale')

      // Server sends update that still shows old highlight
      game.handleServerMessage(
        makeStateUpdate({
          ackSeq: 0,
          player: {
            score: 5,
            resources: { wood: 5, ale: 5 },
            upgrades: { 'sharpened-axes': 0 },
            generators: {},
            meta: { highlight: 'wood' },
          },
        }),
      )

      // Pending highlight should be replayed
      expect(game.getState().player.meta.highlight).toBe('ale')
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
      game.doClick()
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
      game.selectMode('clicker', defaultTimedGoal)
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
    it('optimistically updates highlight', () => {
      enterIdlerPlaying(game)
      expect(game.getState().player.meta.highlight).toBe('wood') // from createInitialState
      game.setHighlight('ale')
      expect(game.getState().player.meta.highlight).toBe('ale')
    })

    it('is a no-op in clicker mode', () => {
      enterPlaying(game)
      game.setHighlight('ale')
      expect(game.getState().player.meta.highlight).toBeUndefined()
    })

    it('is a no-op outside playing screen', () => {
      game.setHighlight('ale')
      expect(game.getState().screen).toBe('lobby')
    })

    it('is a no-op when already set to same value', async () => {
      enterIdlerPlaying(game)
      game.setHighlight('ale')
      const { queueAction } = await import('../src/network.js')
      vi.mocked(queueAction).mockClear()
      game.setHighlight('ale') // same value
      expect(vi.mocked(queueAction)).not.toHaveBeenCalled()
    })

    it('rejects an invalid target resource', () => {
      enterIdlerPlaying(game)
      game.setHighlight('bogus')
      expect(game.getState().player.meta.highlight).toBe('wood') // unchanged
    })

    it('rejects a valid resource when mode has no highlight', () => {
      enterPlaying(game) // clicker mode
      game.setHighlight('currency') // valid resource for clicker, but mode has no highlight
      expect(game.getState().player.meta.highlight).toBeUndefined()
    })
  })

  // ── Idler: doBuy ───────────────────────────────────────────────────

  describe('idler doBuy', () => {
    function giveWood(g: GameModule, amount: number): void {
      g.handleServerMessage(
        makeStateUpdate({
          player: {
            score: amount,
            resources: { wood: amount, ale: 0 },
            upgrades: { 'sharpened-axes': 0 },
            generators: {},
            meta: { highlight: 'wood' },
          },
        }),
      )
    }

    function giveAle(g: GameModule, amount: number): void {
      g.handleServerMessage(
        makeStateUpdate({
          player: {
            score: 0,
            resources: { wood: 0, ale: amount },
            upgrades: { 'sharpened-axes': 0 },
            generators: {},
            meta: { highlight: 'wood' },
          },
        }),
      )
    }

    it('deducts wood for wood-cost upgrades', () => {
      enterIdlerPlaying(game)
      giveWood(game, 50)
      game.doBuy('sharpened-axes') // costs 30 wood
      expect(game.getState().player.upgrades['sharpened-axes']).toBe(1)
      expect(game.getState().player.resources.wood).toBe(20)
    })

    it('deducts ale for ale-cost tree upgrades', () => {
      enterIdlerPlaying(game)
      giveAle(game, 25)
      game.doBuy('royal-brewery') // costs 25 ale
      expect(game.getState().player.upgrades['royal-brewery']).toBe(1)
      expect(game.getState().player.resources.ale).toBe(0)
    })

    it('allows buying repeatable upgrades multiple times', () => {
      enterIdlerPlaying(game)
      giveAle(game, 30)
      game.doBuy('master-craftsmen') // prereq: royal-brewery
      // master-craftsmen requires royal-brewery, so give it via state
      game.handleServerMessage(
        makeStateUpdate({
          player: {
            score: 0,
            resources: { wood: 0, ale: 30 },
            upgrades: { 'royal-brewery': 1, 'master-craftsmen': 0, 'sharpened-axes': 0 },
            generators: {},
            meta: { highlight: 'wood' },
          },
        }),
      )
      game.doBuy('master-craftsmen') // 1st: 30-10=20 ale
      game.doBuy('master-craftsmen') // 2nd: 20-10=10 ale
      game.doBuy('master-craftsmen') // 3rd: 10-10=0 ale
      expect(game.getState().player.upgrades['master-craftsmen']).toBe(3)
      expect(game.getState().player.resources.ale).toBe(0)
    })

    it('rejects if wrong currency balance is too low', () => {
      enterIdlerPlaying(game)
      giveAle(game, 100) // plenty of ale, no wood
      game.doBuy('sharpened-axes') // costs 30 wood — should fail
      expect(game.getState().player.upgrades['sharpened-axes']).toBe(0)
    })

    it('rejects repeatable buy when insufficient funds', () => {
      enterIdlerPlaying(game)
      // Give royal-brewery prereq + some ale
      game.handleServerMessage(
        makeStateUpdate({
          player: {
            score: 0,
            resources: { wood: 0, ale: 15 },
            upgrades: { 'royal-brewery': 1, 'master-craftsmen': 0, 'sharpened-axes': 0 },
            generators: {},
            meta: { highlight: 'wood' },
          },
        }),
      )
      game.doBuy('master-craftsmen') // 1st: 15-10=5 ale
      game.doBuy('master-craftsmen') // 2nd: 5 < 10 — should fail
      expect(game.getState().player.upgrades['master-craftsmen']).toBe(1)
      expect(game.getState().player.resources.ale).toBe(5)
    })

    it('rejects buying a tree upgrade when prerequisites are unowned', () => {
      enterIdlerPlaying(game)
      // Provide tons of resources but no prereqs
      game.handleServerMessage(
        makeStateUpdate({
          player: {
            score: 0,
            resources: { wood: 9999, ale: 9999 },
            upgrades: {
              'industrial-era': 0,
              'heavy-logging': 0,
              'royal-brewery': 0,
              'sharpened-axes': 0,
            },
            generators: {},
            meta: { highlight: 'wood' },
          },
        }),
      )
      game.doBuy('industrial-era') // prereqs unmet → no-op
      expect(game.getState().player.upgrades['industrial-era'] ?? 0).toBe(0)
      // Cost should NOT be deducted on rejected buy
      expect(game.getState().player.resources.wood).toBe(9999)
    })

    it('accepts buying a tree upgrade once both prerequisites are owned', () => {
      enterIdlerPlaying(game)
      game.handleServerMessage(
        makeStateUpdate({
          player: {
            score: 0,
            resources: { wood: 9999, ale: 9999 },
            upgrades: {
              'industrial-era': 0,
              'heavy-logging': 1,
              'royal-brewery': 1,
              'sharpened-axes': 1,
            },
            generators: {},
            meta: { highlight: 'wood' },
          },
        }),
      )
      game.doBuy('industrial-era')
      expect(game.getState().player.upgrades['industrial-era']).toBe(1)
    })

    it('AND-semantics: rejects when only one of two prerequisites is owned', () => {
      enterIdlerPlaying(game)
      game.handleServerMessage(
        makeStateUpdate({
          player: {
            score: 0,
            resources: { wood: 9999, ale: 9999 },
            upgrades: {
              'industrial-era': 0,
              'heavy-logging': 1,
              'royal-brewery': 0,
              'sharpened-axes': 0,
            },
            generators: {},
            meta: { highlight: 'wood' },
          },
        }),
      )
      game.doBuy('industrial-era')
      expect(game.getState().player.upgrades['industrial-era'] ?? 0).toBe(0)
    })
  })
})
