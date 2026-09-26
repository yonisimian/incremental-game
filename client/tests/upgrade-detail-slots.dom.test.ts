// @vitest-environment happy-dom
//
// The upgrade detail popup names the slot budget as the lock reason.
// Without it a slot-blocked node looks affordable and does nothing on click,
// which reads as a bug. DOM tier because the popup is mounted into a live host
// and its Buy button's `disabled` state is what the player actually meets.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  COUNTDOWN_SEC,
  ROUND_DURATION_SEC,
  createInitialState,
  getModeDefinition,
  registerMode,
} from '@game/shared'
import type { GameState } from '../src/game.js'

/** The state the popup reads; swapped per test. */
let current: GameState

vi.mock('../src/game.js', () => ({
  getState: () => current,
  doBuy: vi.fn(),
}))

const { openUpgradeDetail, closeUpgradeDetail } = await import('../src/ui/upgrade-detail.js')

const base = getModeDefinition('idler')
registerMode('idler', {
  ...base,
  effects: [
    ...(base.effects ?? []).filter((e) => e.type !== 'attackSlots'),
    { type: 'attackSlots', attackKind: 'active', value: 1 },
  ],
})
const mode = getModeDefinition('idler')

function unlockOf(attack: string): string {
  return mode.upgrades.find((u) =>
    u.effects?.some((e) => e.type === 'unlockAttack' && e.attack === attack),
  )!.id
}
const panelUpgrade = mode.upgrades.find((u) =>
  u.effects?.some((e) => e.type === 'panelUnlock' && e.panel === 'attack'),
)!.id
const A0 = unlockOf('a0')
const A1 = unlockOf('a1')

function makeState(owned: Record<string, number>): GameState {
  const player = createInitialState(mode)
  player.resources.r0 = 1e6
  player.resources.r1 = 1e6
  player.upgrades[panelUpgrade] = 1
  Object.assign(player.upgrades, owned)
  return {
    screen: 'playing',
    mode: 'idler',
    goal: { type: 'timed', label: '⏱ Timed', durationSec: ROUND_DURATION_SEC },
    player,
    opponent: { score: 0, resources: {}, rates: {} },
    opponentPurchaseFeed: [],
    incomingAttacks: [],
    pactBonuses: [],
    opponentPacts: [],
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

describe('upgrade detail — attack slots', () => {
  beforeEach(() => {
    const host = document.createElement('div')
    host.id = 'tree-viewport'
    document.body.appendChild(host)
  })

  afterEach(() => {
    closeUpgradeDetail()
    document.body.innerHTML = ''
  })

  it('states the slot budget as the lock reason and disables Buy', () => {
    current = makeState({ [A0]: 1 })
    openUpgradeDetail(A1)
    expect(document.getElementById('upgrade-detail-lock')?.textContent).toBe('No attack slots left')
    expect((document.getElementById('upgrade-detail-buy') as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows no lock reason and an enabled Buy while a slot is free', () => {
    current = makeState({})
    openUpgradeDetail(A1)
    expect(document.getElementById('upgrade-detail-lock')).toBeNull()
    expect((document.getElementById('upgrade-detail-buy') as HTMLButtonElement).disabled).toBe(
      false,
    )
  })
})
