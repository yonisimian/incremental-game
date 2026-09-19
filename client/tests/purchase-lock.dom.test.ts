// @vitest-environment happy-dom
//
// Plan 40 — the upgrade detail popup names an enemy purchase lock as the lock
// reason, with its countdown. Without it a locked node looks affordable and
// does nothing on click, which reads as a bug. DOM tier for the same reason as
// the slots twin: the popup mounts into a live host, and its Buy button's
// `disabled` state is what the player actually meets.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  COUNTDOWN_SEC,
  ROUND_DURATION_SEC,
  createInitialState,
  getModeDefinition,
} from '@game/shared'
import type { PurchaseLock } from '@game/shared'
import type { GameState } from '../src/game.js'

/** The state the popup reads; swapped per test. */
let current: GameState

vi.mock('../src/game.js', () => ({
  getState: () => current,
  doBuy: vi.fn(),
}))

const { openUpgradeDetail, closeUpgradeDetail } = await import('../src/ui/upgrade-detail.js')

const mode = getModeDefinition('idler')

/** A free root upgrade with no prerequisites — buyable unless locked. */
const ROOT = mode.upgrades.find((u) => u.prerequisites === undefined && u.purchaseLimit === 1)!

function makeState(locks?: PurchaseLock[]): GameState {
  const player = createInitialState(mode)
  player.resources.r0 = 1e6
  player.resources.r1 = 1e6
  player.meta.gameSec = 20
  if (locks) player.incomingPurchaseLocks = locks
  return {
    screen: 'playing',
    mode: 'idler',
    goal: { type: 'timed', label: '⏱ Timed', durationSec: ROUND_DURATION_SEC },
    player,
    opponent: { score: 0, resources: {}, rates: {} },
    opponentPurchaseFeed: [],
    incomingAttacks: [],
    debuffs: [],
    timeLeft: ROUND_DURATION_SEC,
    paused: false,
    vsBot: false,
    matchId: 'test-match',
    upgrades: mode.upgrades,
    countdown: COUNTDOWN_SEC,
    endData: null,
    playerName: '',
    opponentName: '',
    roomCode: null,
    roomSettings: null,
    roomPlayers: [],
    isRoomCreator: false,
    serverActiveRooms: 0,
    roomError: null,
  }
}

describe('upgrade detail — enemy purchase lock', () => {
  beforeEach(() => {
    const host = document.createElement('div')
    host.id = 'tree-viewport'
    document.body.appendChild(host)
  })

  afterEach(() => {
    closeUpgradeDetail()
    document.body.innerHTML = ''
  })

  it('states the lock with its countdown and disables Buy', () => {
    current = makeState([{ scope: 'upgrade', untilSec: 27.5 }])
    openUpgradeDetail(ROOT.id)
    expect(document.getElementById('upgrade-detail-lock')?.textContent).toBe(
      'Enemy attack — 🔒 Locked 7.5s',
    )
    expect((document.getElementById('upgrade-detail-buy') as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows no lock reason and an enabled Buy under a generator-only lock', () => {
    current = makeState([{ scope: 'generator', untilSec: 27.5 }])
    openUpgradeDetail(ROOT.id)
    expect(document.getElementById('upgrade-detail-lock')).toBeNull()
    expect((document.getElementById('upgrade-detail-buy') as HTMLButtonElement).disabled).toBe(
      false,
    )
  })
})
