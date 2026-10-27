// @vitest-environment happy-dom
//
// The tree re-renders on every affordability change. If that replaced the node
// buttons, a click whose pointerdown hit the old button would never reach the
// canvas listener. DOM tier because the failure is element identity in a live tree.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
// The panel remembers what it has shown per match, so each test uses its own match id.
describe('upgrade tree panel visibility modes', () => {
  const stubs = () => document.querySelectorAll('.tree-edges line.stub').length
  const inMatch = (matchId: string, state: GameState): GameState => ({ ...state, matchId })

  it('hidden: shows a child only once its prerequisites are met', () => {
    setTreeVisibility('hidden')
    mountTree(inMatch('hidden', makeState(0)))
    expect(nodeOf('g1-g2')).not.toBeNull()
    expect(document.querySelector('[data-upgrade="g1-af"]')).toBeNull()
    expect(stubs()).toBeGreaterThan(0)

    current = inMatch('hidden', makeState(0, { 'g1-g2': 1 }))
    upgradeTreePanel.update!(current)

    expect(nodeOf('g1-af')).not.toBeNull()
    expect(document.querySelector('[data-upgrade="g1-dp"]')).toBeNull()
  })

  it('hidden: keeps a revealed node when its parent purchase is rolled back', () => {
    setTreeVisibility('hidden')
    mountTree(inMatch('rollback', makeState(0)))
    current = inMatch('rollback', makeState(0, { 'g1-g2': 1 }))
    upgradeTreePanel.update!(current)
    const revealed = nodeOf('g1-af')

    // The server rejected the purchase; reconciliation sets g1-g2 back to 0.
    current = inMatch('rollback', makeState(0))
    upgradeTreePanel.update!(current)

    expect(nodeOf('g1-af')).toBe(revealed)
    expect(revealed.classList.contains('locked')).toBe(true)
  })

  it('peek: shows the children of reachable upgrades, but not grandchildren, with no stubs', () => {
    setTreeVisibility('peek')
    mountTree(inMatch('peek', makeState(0)))
    expect(nodeOf('g1-af').classList.contains('locked')).toBe(true)
    expect(document.querySelector('[data-upgrade="g1-dp"]')).toBeNull()
    expect(stubs()).toBe(0)
  })

  it('re-seeds when the setting changes mid-match, so Full → Hidden actually hides', () => {
    mountTree(inMatch('switch', makeState(0)))
    expect(nodeOf('g1-dp')).not.toBeNull()

    // Changed from the in-match Settings panel; the tree re-renders on tab switch.
    setTreeVisibility('hidden')
    document.body.innerHTML = ''
    mountTree(inMatch('switch', makeState(0)))

    expect(document.querySelector('[data-upgrade="g1-af"]')).toBeNull()
    expect(nodeOf('g1-g2').classList.contains('revealed')).toBe(false)
  })

  it('full: shows every upgrade, as before', () => {
    mountTree(inMatch('full', makeState(0)))
    expect(nodeOf('g1-dp')).not.toBeNull()
    expect(stubs()).toBe(0)
  })
})

// The panel remembers what it has shown per match, so each test starts its own.
describe('upgrade tree panel reveal pulse', () => {
  let match = 0
  const inMatch = (state: GameState): GameState => ({ ...state, matchId: `pulse-${match}` })
  const pulsing = (id: string) => nodeOf(id).classList.contains('revealed')
  // happy-dom runs no CSS animations, so the test fires their end by hand.
  const finish = (id: string, animationName: string) =>
    nodeOf(id).dispatchEvent(new AnimationEvent('animationend', { animationName, bubbles: true }))

  beforeEach(() => {
    match++
    setTreeVisibility('hidden')
  })

  it('does not pulse nodes visible at round start', () => {
    mountTree(inMatch(makeState(0)))
    expect(pulsing('g1-g2')).toBe(false)
  })

  it('pulses a node revealed mid-round until its ring animation ends', () => {
    mountTree(inMatch(makeState(0)))

    current = inMatch(makeState(0, { 'g1-g2': 1 }))
    upgradeTreePanel.update!(current)
    expect(pulsing('g1-af')).toBe(true)

    // Later updates inside the pulse keep the class, or the animation is cut short.
    current = inMatch(makeState(10, { 'g1-g2': 1 }))
    upgradeTreePanel.update!(current)
    expect(pulsing('g1-af')).toBe(true)

    // The pop ending alone doesn't end the pulse; the ring (which always runs) does.
    finish('g1-af', 'tree-reveal-pop')
    expect(pulsing('g1-af')).toBe(true)
    finish('g1-af', 'tree-reveal-ring')
    expect(pulsing('g1-af')).toBe(false)

    current = inMatch(makeState(20, { 'g1-g2': 1 }))
    upgradeTreePanel.update!(current)
    expect(pulsing('g1-af')).toBe(false)
  })

  it('pulses an upgrade revealed before the tree tab first opened', () => {
    // The round started on another tab; g1-g2 was bought before the tree rendered.
    mountTree(inMatch(makeState(0, { 'g1-g2': 1 })))
    expect(pulsing('g1-af')).toBe(true)
    expect(pulsing('g1-g2')).toBe(false)
  })

  it('forgets the previous match when a new one starts', () => {
    mountTree(inMatch(makeState(0)))
    current = inMatch(makeState(0, { 'g1-g2': 1 }))
    upgradeTreePanel.update!(current)
    finish('g1-af', 'tree-reveal-ring')

    document.body.innerHTML = ''
    match++
    mountTree(inMatch(makeState(0)))
    current = inMatch(makeState(0, { 'g1-g2': 1 }))
    upgradeTreePanel.update!(current)
    expect(pulsing('g1-af')).toBe(true)
  })

  it('never pulses in Full mode', () => {
    setTreeVisibility('full')
    mountTree(inMatch(makeState(0)))
    current = inMatch(makeState(0, { 'g1-g2': 1 }))
    upgradeTreePanel.update!(current)
    expect(document.querySelectorAll('.tree-node.revealed')).toHaveLength(0)
  })
})

describe('upgrade tree panel node order', () => {
  it('inserts a revealed node at its tree position, not at the end', () => {
    setTreeVisibility('hidden')
    mountTree({ ...makeState(0), matchId: 'order' })
    current = { ...makeState(0, { 'g1-g2': 1 }), matchId: 'order' }
    upgradeTreePanel.update!(current)

    const domOrder = [...document.querySelectorAll<HTMLElement>('.tree-node')].map(
      (n) => n.dataset.upgrade,
    )
    const treeOrder = current.upgrades.map((u) => u.id).filter((id) => domOrder.includes(id))
    expect(domOrder).toContain('g1-af')
    expect(domOrder).toEqual(treeOrder)
  })
})
