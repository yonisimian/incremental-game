// @vitest-environment happy-dom
//
// The tree re-renders on every affordability change. If that replaced the node
// buttons, a click whose pointerdown hit the old button would never reach the
// canvas listener. DOM tier because the failure is element identity in a live tree.

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  COUNTDOWN_SEC,
  ROUND_DURATION_SEC,
  createInitialState,
  getModeDefinition,
} from '@game/shared'
import type { GameState } from '../src/game.js'

let current: GameState

vi.mock('../src/game.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/game.js')>()),
  getState: () => current,
  doBuy: vi.fn(),
}))

const { upgradeTreePanel } = await import('../src/ui/panels/upgrade-tree-panel.js')
const { closeUpgradeDetail } = await import('../src/ui/upgrade-detail.js')
const { setTreeVisibility } = await import('../src/ui/tree-visibility.js')

const mode = getModeDefinition('idler')

function makeState(wood: number, owned: Record<string, number> = {}): GameState {
  const player = createInitialState(mode)
  player.resources.r0 = wood
  player.upgrades = { ...player.upgrades, ...owned }
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
    opponentPactWindows: [],
    incomingAutoClicksPerSec: 0,
    debuffs: [],
    timeLeft: ROUND_DURATION_SEC,
    paused: false,
    resigning: false,
    vsBot: false,
    matchId: 'test-match',
    seatToken: null,
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

function mountTree(state: GameState): void {
  current = state
  const container = document.createElement('div')
  document.body.appendChild(container)
  upgradeTreePanel.render(container, state)
  upgradeTreePanel.bind?.(state)
}

const nodeOf = (id: string) => document.querySelector<HTMLButtonElement>(`[data-upgrade="${id}"]`)!

afterEach(() => {
  closeUpgradeDetail()
  setTreeVisibility('full')
  document.body.innerHTML = ''
})

describe('upgrade tree panel update', () => {
  it('keeps the node button when its affordability changes', () => {
    mountTree(makeState(0))
    const before = nodeOf('a-unlock')
    expect(before.classList.contains('too-expensive')).toBe(true)

    current = makeState(1000)
    upgradeTreePanel.update!(current)

    expect(nodeOf('a-unlock')).toBe(before)
    expect(before.classList.contains('too-expensive')).toBe(false)
  })

  it('opens the detail from a node rendered before the update', () => {
    mountTree(makeState(0))
    const pressed = nodeOf('a-unlock')

    current = makeState(1000)
    upgradeTreePanel.update!(current)
    pressed.click()

    expect(document.getElementById('upgrade-detail-buy')).not.toBeNull()
  })
})

// g1-g2 is a root; g1-af requires it, and g1-dp requires g1-af.
describe('upgrade tree panel visibility modes', () => {
  const stubs = () => document.querySelectorAll('.tree-edges line.stub').length

  it('hidden: shows a child only once its prerequisites are met', () => {
    setTreeVisibility('hidden')
    mountTree(makeState(0))
    expect(nodeOf('g1-g2')).not.toBeNull()
    expect(document.querySelector('[data-upgrade="g1-af"]')).toBeNull()
    expect(stubs()).toBeGreaterThan(0)

    current = makeState(0, { 'g1-g2': 1 })
    upgradeTreePanel.update!(current)

    expect(nodeOf('g1-af')).not.toBeNull()
    expect(document.querySelector('[data-upgrade="g1-dp"]')).toBeNull()
  })

  it('peek: shows the children of reachable upgrades, but not grandchildren, with no stubs', () => {
    setTreeVisibility('peek')
    mountTree(makeState(0))
    expect(nodeOf('g1-af').classList.contains('locked')).toBe(true)
    expect(document.querySelector('[data-upgrade="g1-dp"]')).toBeNull()
    expect(stubs()).toBe(0)
  })

  it('full: shows every upgrade, as before', () => {
    mountTree(makeState(0))
    expect(nodeOf('g1-dp')).not.toBeNull()
    expect(stubs()).toBe(0)
  })
})
