/**
 * The toasts `game.ts` raises for attack events arriving on a STATE_UPDATE —
 * here the `debuff` kind a duration attack's strike produces (plan 37).
 *
 * Node tier: the VFX module is mocked, so the assertion is on *what* the game
 * layer asked to show, not on DOM output (the toast's own rendering is covered
 * by `toast.dom.test.ts`).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AttackEvent, RoundStartMessage, StateUpdateMessage } from '@game/shared'
import {
  COUNTDOWN_SEC,
  ROUND_DURATION_SEC,
  getModeDefinition,
  getModeFlavor,
  getPactName,
} from '@game/shared'
import idlerTreeFile from '@game/shared/trees/idler.json'

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

// Hoisted so the (also hoisted) mock factory can hand these out directly.
const { spawnToast, shakeScreen } = vi.hoisted(() => ({
  spawnToast: vi.fn<(text: string, tone: string) => void>(),
  shakeScreen: vi.fn<(strength: string) => void>(),
}))
vi.mock('../src/ui/vfx/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/ui/vfx/index.js')>()),
  spawnToast,
  shakeScreen,
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

function stateUpdate(attackEvents: AttackEvent[]): StateUpdateMessage {
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
      meta: {},
    },
    opponent: { score: 0, resources: { r0: 0 }, rates: {} },
    timeLeft: 55,
    paused: false,
    attackEvents,
  }
}

describe('debuff attack events → toasts', () => {
  let game: GameModule

  beforeEach(async () => {
    vi.useFakeTimers()
    spawnToast.mockClear()
    shakeScreen.mockClear()
    game = await loadGame()
    game.handleServerMessage(roundStart)
    vi.advanceTimersByTime(Math.max(COUNTDOWN_SEC, 1) * 1000)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('tells the attacker their debuff is in force, with its duration', () => {
    game.handleServerMessage(
      stateUpdate([{ attack: 'a0', direction: 'outgoing', kind: 'debuff', durationSec: 12, t: 5 }]),
    )
    expect(spawnToast).toHaveBeenCalledTimes(1)
    const [text, tone] = spawnToast.mock.calls[0]
    expect(text).toContain('enemy debuffed for 12s')
    expect(tone).toBe('success')
    expect(shakeScreen).not.toHaveBeenCalled()
  })

  it('warns the victim, shakes, and states how long it lasts', () => {
    game.handleServerMessage(
      stateUpdate([
        { attack: 'a0', direction: 'incoming', kind: 'debuff', durationSec: 7.5, t: 5 },
      ]),
    )
    expect(spawnToast).toHaveBeenCalledTimes(1)
    const [text, tone] = spawnToast.mock.calls[0]
    expect(text).toContain('debuffed for 7.5s')
    expect(text).not.toContain('enemy debuffed')
    expect(tone).toBe('danger')
    expect(shakeScreen).toHaveBeenCalledTimes(1)
  })

  it('shows a raid as two toasts — the theft and the window', () => {
    game.handleServerMessage(
      stateUpdate([
        { attack: 'a0', direction: 'incoming', kind: 'resource', resource: 'r0', amount: 50, t: 5 },
        { attack: 'a0', direction: 'incoming', kind: 'debuff', durationSec: 10, t: 5 },
      ]),
    )
    expect(spawnToast).toHaveBeenCalledTimes(2)
    const texts = spawnToast.mock.calls.map(([text]) => text)
    expect(texts[0]).toContain('lost')
    expect(texts[1]).toContain('debuffed for 10s')
  })
})

describe('shared pact → toast', () => {
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

  /** A snapshot whose opponent view names the given mutual pacts. */
  function withSharedPacts(pacts: string[] | undefined): StateUpdateMessage {
    const update = stateUpdate([])
    return { ...update, opponent: { ...update.opponent, ...(pacts ? { pacts } : {}) } }
  }

  it('announces a treaty the enemy signed once, by its flavor name', () => {
    const name = getPactName(getModeFlavor(getModeDefinition('idler')), 'p3')
    game.handleServerMessage(withSharedPacts(['p3']))
    expect(spawnToast).toHaveBeenCalledTimes(1)
    const [text, tone] = spawnToast.mock.calls[0]
    expect(text).toContain(name)
    expect(text).toContain('signed by the enemy')
    expect(tone).toBe('info')

    // Rebroadcast every snapshot: announced only on first appearance.
    game.handleServerMessage(withSharedPacts(['p3']))
    expect(spawnToast).toHaveBeenCalledTimes(1)
  })

  it('stays quiet when the view names no pact', () => {
    game.handleServerMessage(withSharedPacts(undefined))
    expect(spawnToast).not.toHaveBeenCalled()
  })
})
