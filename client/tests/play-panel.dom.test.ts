// @vitest-environment happy-dom
//
// The Play panel's empty state: cards per tree root that open the upgrade
// popup in place. DOM tier because it's inject/remove on gate flips, delegated
// listeners, and a popup mounted inside the panel.

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

vi.mock('../src/ui/panels.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/ui/panels.js')>()),
  switchToPanel: vi.fn(),
}))

const { playPanel } = await import('../src/ui/panels/play-panel.js')
const { closeUpgradeDetail, isUpgradeDetailOpen } = await import('../src/ui/upgrade-detail.js')
const panels = await import('../src/ui/panels.js')

const mode = getModeDefinition('idler')
const ROOTS = ['be-af-mr', 'ae-mf-ar', 'g1-g2', 'sc-unlock', 'a-unlock', 'ir-unlock', 'e-se-mr']

function makeState(
  resources: Partial<Record<'r0' | 'r1', number>> = {},
  owned: Record<string, number> = {},
): GameState {
  const player = createInitialState(mode)
  player.resources = { ...player.resources, ...resources }
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

function mount(state: GameState): void {
  current = state
  const container = document.createElement('div')
  document.body.appendChild(container)
  playPanel.render(container, state)
  playPanel.bind?.(state)
}

function update(state: GameState): void {
  current = state
  playPanel.update!(state)
}

const opening = () => document.getElementById('play-opening')
const cardIds = () =>
  [...document.querySelectorAll<HTMLElement>('.opening-card')].map((c) => c.dataset.upgrade)
const card = (id: string) =>
  document.querySelector<HTMLElement>(`.opening-card[data-upgrade="${id}"]`)!

afterEach(() => {
  closeUpgradeDetail()
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

describe('play panel opening', () => {
  it('shows one card per tree root in tree order, without the goal', () => {
    mount(makeState())
    expect(opening()).not.toBeNull()
    expect(cardIds()).toEqual(ROOTS)
  })

  it('leaves out a root bought up to its limit', () => {
    mount(makeState({}, { 'a-unlock': 1 }))
    expect(cardIds()).not.toContain('a-unlock')
  })

  it('drops a card on update once its root is maxed', () => {
    mount(makeState())
    update(makeState({}, { 'e-se-mr': 1 }))
    expect(cardIds()).toEqual(ROOTS.filter((id) => id !== 'e-se-mr'))
  })

  it('dims a card it cannot buy and undims it once affordable', () => {
    mount(makeState({ r0: 100, r1: 0 }))
    const optimize = card('ae-mf-ar')
    expect(optimize.classList.contains('blocked')).toBe(true)
    expect(card('be-af-mr').classList.contains('blocked')).toBe(false)

    update(makeState({ r0: 100, r1: 100 }))
    expect(card('ae-mf-ar')).toBe(optimize)
    expect(optimize.classList.contains('blocked')).toBe(false)
  })

  it('gives way to the click cards when clicking unlocks, and returns if it relocks', () => {
    mount(makeState())
    update(makeState({}, { 'sc-unlock': 1 }))
    expect(opening()).toBeNull()
    expect(document.querySelector('.click-cards')).not.toBeNull()

    update(makeState())
    expect(opening()).not.toBeNull()
    expect(document.querySelector('.click-cards')).toBeNull()
  })

  it('opens the detail popup inside the opening and keeps its Buy button live', () => {
    mount(makeState({ r0: 0, r1: 0 }))
    card('g1-g2').click()

    const buy = document.querySelector<HTMLButtonElement>('#play-opening #upgrade-detail-buy')
    expect(buy).not.toBeNull()
    expect(buy!.disabled).toBe(true)

    update(makeState({ r0: 100 }))
    expect(buy!.disabled).toBe(false)
  })

  it('closes the popup when the opening goes away', () => {
    mount(makeState())
    card('sc-unlock').click()
    update(makeState({}, { 'sc-unlock': 1 }))
    expect(isUpgradeDetailOpen()).toBe(false)
  })

  it('switches to the tree tab from the link', () => {
    mount(makeState())
    document.getElementById('opening-tree-link')!.click()
    expect(panels.switchToPanel).toHaveBeenCalledWith(panels.UPGRADE_TREE_PANEL_INDEX)
  })
})

describe('renderActivePanel', () => {
  it('clears a popup left open by the previous panel', () => {
    current = makeState()
    const container = document.createElement('div')
    container.id = 'panel-container'
    document.body.appendChild(container)
    panels.configurePanels([{ index: 0, panel: playPanel }])
    panels.renderActivePanel(current)
    card('g1-g2').click()
    expect(isUpgradeDetailOpen()).toBe(true)

    panels.renderActivePanel(current)
    expect(isUpgradeDetailOpen()).toBe(false)
  })
})
