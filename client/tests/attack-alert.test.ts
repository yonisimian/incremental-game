/**
 * Plan 41 — the client side of the attack alert: `incomingAttacks` is replaced
 * from each snapshot and cleared at round start, a strike is toasted once when
 * it first comes into view, and the espionage panel lists what is inbound.
 *
 * Node tier: the VFX module is mocked, so the toast assertion is on *what* the
 * game layer asked to show (the toast's rendering is `toast.dom.test.ts`'s).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IncomingAttack, RoundStartMessage, StateUpdateMessage } from '@game/shared'
import {
  COUNTDOWN_SEC,
  ROUND_DURATION_SEC,
  createInitialState,
  getModeDefinition,
} from '@game/shared'
import idlerTreeFile from '@game/shared/trees/idler.json'
import type { GameState } from '../src/game.js'
import { espionagePanel } from '../src/ui/panels/espionage-panel.js'

vi.mock('../src/network.js', () => ({
  getSeq: vi.fn(() => 0),
  queueAction: vi.fn(),
  resetSeq: vi.fn(),
  sendQuickMatch: vi.fn(() => true),
  sendRoomCreate: vi.fn(() => true),
  sendRoomJoin: vi.fn(() => true),
  sendRoomUpdate: vi.fn(),
  sendQuit: vi.fn(),
  sendBotRequest: vi.fn(),
}))

const { spawnToast } = vi.hoisted(() => ({
  spawnToast: vi.fn<(text: string, tone: string) => void>(),
}))
vi.mock('../src/ui/vfx/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/ui/vfx/index.js')>()),
  spawnToast,
}))

type GameModule = typeof import('../src/game.js')

async function loadGame(): Promise<GameModule> {
  vi.resetModules()
  const shared = await import('@game/shared')
  shared.loadTree(idlerTreeFile)
  return await import('../src/game.js')
}

const roundStart: RoundStartMessage = {
  type: 'ROUND_START',
  matchId: 'test-match',
  config: {
    mode: 'idler',
    goal: { type: 'timed', label: '⏱ Timed', durationSec: ROUND_DURATION_SEC },
  },
  opponentName: '',
  vsBot: false,
  serverTime: Date.now(),
}

/** A snapshot at `gameSec` carrying `incomingAttacks` (absent when omitted). */
function snapshot(gameSec: number, incomingAttacks?: IncomingAttack[]): StateUpdateMessage {
  return {
    type: 'STATE_UPDATE',
    tick: 1,
    ackSeq: 0,
    player: {
      score: 0,
      resources: { r0: 0 },
      upgrades: {},
      generators: {},
      pendingAttacks: [],
      meta: { gameSec },
    },
    opponent: {
      score: 0,
      resources: { r0: 0 },
      rates: {},
      ...(incomingAttacks ? { incomingAttacks } : {}),
    },
    timeLeft: 55,
    paused: false,
  }
}

describe('incomingAttacks — state and toasts', () => {
  let game: GameModule

  beforeEach(async () => {
    vi.useFakeTimers()
    spawnToast.mockClear()
    game = await loadGame()
    game.handleServerMessage(roundStart)
    vi.advanceTimersByTime(Math.max(COUNTDOWN_SEC, 1) * 1000)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('replaces the list from each snapshot and empties it when the field is absent', () => {
    game.handleServerMessage(snapshot(10, [{ readyAtSec: 14 }]))
    expect(game.getState().incomingAttacks).toEqual([{ readyAtSec: 14 }])
    game.handleServerMessage(snapshot(10.5, [{ readyAtSec: 14 }, { readyAtSec: 15 }]))
    expect(game.getState().incomingAttacks).toHaveLength(2)
    game.handleServerMessage(snapshot(14.5))
    expect(game.getState().incomingAttacks).toEqual([])
  })

  it('toasts a strike once, when it first comes into view, with the time left', () => {
    game.handleServerMessage(snapshot(10, [{ readyAtSec: 14 }]))
    expect(spawnToast).toHaveBeenCalledTimes(1)
    const [text, tone] = spawnToast.mock.calls[0]
    expect(text).toBe('⚠️ Incoming attack in 4.0s')
    expect(tone).toBe('warning')

    // The same strike, rebroadcast as it counts down: no second toast.
    game.handleServerMessage(snapshot(10.5, [{ readyAtSec: 14 }]))
    game.handleServerMessage(snapshot(11, [{ readyAtSec: 14 }]))
    expect(spawnToast).toHaveBeenCalledTimes(1)

    // A second strike joining the list is announced on its own.
    game.handleServerMessage(snapshot(11.5, [{ readyAtSec: 14 }, { readyAtSec: 20 }]))
    expect(spawnToast).toHaveBeenCalledTimes(2)
    expect(spawnToast.mock.calls[1][0]).toBe('⚠️ Incoming attack in 8.5s')
  })

  it('names the attack when the warning carries its id', () => {
    game.handleServerMessage(snapshot(10, [{ readyAtSec: 12.25, attack: 'a0' }]))
    const [text] = spawnToast.mock.calls[0]
    expect(text).toContain('Steal') // the idler's a0 flavor name
    expect(text).not.toContain('Incoming attack')
    expect(text).toContain('in 2.3s')
  })

  it('never shows a negative countdown', () => {
    game.handleServerMessage(snapshot(15, [{ readyAtSec: 14 }]))
    expect(spawnToast.mock.calls[0][0]).toBe('⚠️ Incoming attack in 0.0s')
  })

  it('clears the list at the start of a new round', () => {
    game.handleServerMessage(snapshot(10, [{ readyAtSec: 14 }]))
    expect(game.getState().incomingAttacks).toHaveLength(1)
    game.handleServerMessage(roundStart)
    expect(game.getState().incomingAttacks).toEqual([])
  })
})

describe('espionage panel — incoming strikes', () => {
  const modeDef = getModeDefinition('idler')

  function makeState(incomingAttacks: IncomingAttack[]): GameState {
    const player = createInitialState(modeDef)
    player.meta.gameSec = 20
    return {
      screen: 'playing',
      mode: 'idler',
      goal: { type: 'timed', label: '⏱ Timed', durationSec: 60 },
      player,
      opponent: { resources: {}, rates: {} },
      opponentPurchaseFeed: [],
      debuffs: [],
      pactBonuses: [],
      opponentPacts: [],
      incomingAttacks,
      timeLeft: 60,
      paused: false,
      vsBot: false,
      matchId: null,
      upgrades: [],
      countdown: 0,
      endData: null,
      playerName: 'p1',
      opponentName: 'p2',
      roomCode: null,
      roomSettings: null,
      roomPlayers: [],
      isRoomCreator: false,
      serverActiveRooms: 0,
      roomError: null,
    }
  }

  function render(state: GameState): string {
    const container = { innerHTML: '' } as HTMLElement
    espionagePanel.render(container, state)
    return container.innerHTML
  }

  it('lists each inbound strike, soonest first, with no espionage researched', () => {
    const html = render(makeState([{ readyAtSec: 28 }, { readyAtSec: 23.5, attack: 'a0' }]))
    expect(html).toContain('Enemy Attacks')
    const named = html.indexOf('lands in 3.5s.')
    const bare = html.indexOf('⚠️ Enemy attack lands in 8.0s.')
    expect(named).toBeGreaterThan(-1)
    expect(bare).toBeGreaterThan(named)
    expect(html).toContain('No intel yet')
  })

  it('stays silent with nothing inbound', () => {
    expect(render(makeState([]))).not.toContain('lands in')
  })
})
