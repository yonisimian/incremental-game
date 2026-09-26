// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { COUNTDOWN_SEC, ROUND_DURATION_SEC, type Modifier } from '@game/shared'
import type { GameState } from '../src/game.js'
import { dataPanel } from '../src/ui/panels/data-panel.js'

// `sc-unlock` grants +1 clickIncome, so an un-debuffed click is worth 1.
function makeIdlerState(debuffs: Modifier[] = []): GameState {
  const goal = { type: 'timed' as const, label: '⏱ Timed', durationSec: ROUND_DURATION_SEC }
  return {
    screen: 'playing',
    mode: 'idler',
    goal,
    player: {
      score: 0,
      resources: { r0: 0, r1: 0 },
      upgrades: { 'sc-unlock': 1 },
      generators: {},
      pendingAttacks: [],
      meta: { highlight: 'r0' },
    },
    opponent: { score: 0, resources: {}, rates: {} },
    opponentPurchaseFeed: [],
    debuffs,
    incomingAttacks: [],
    pactBonuses: [],
    opponentPacts: [],
    timeLeft: ROUND_DURATION_SEC,
    paused: false,
    vsBot: false,
    matchId: 'test-match',
    upgrades: [],
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
  } as unknown as GameState
}

function render(state: GameState): HTMLElement {
  const container = document.createElement('div')
  document.body.appendChild(container)
  dataPanel.render(container, state)
  return container
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('data panel — per-click income display', () => {
  it('shows a plain figure when no debuff is active', () => {
    const el = render(makeIdlerState()).querySelector('#data-click-income')!
    expect(el.textContent).toBe('1')
    expect(el.querySelector('.data-value-debuffed')).toBeNull()
    expect(el.querySelector('.data-value-base')).toBeNull()
  })

  it('shows the debuffed figure in red with the un-debuffed value in parentheses', () => {
    const debuffs: Modifier[] = [{ stage: 'multiplicative', field: 'clickIncome', value: 0.5 }]
    const el = render(makeIdlerState(debuffs)).querySelector('#data-click-income')!
    const debuffed = el.querySelector('.data-value-debuffed')
    const base = el.querySelector('.data-value-base')
    expect(debuffed?.textContent).toBe('0.5')
    expect(base?.textContent).toBe('(1)')
  })

  it('reflects a flat (additive) click debuff, flooring the figure at 0', () => {
    // `less-click-power-add` is a −2 additive clickIncome debuff; against a base
    // of 1 it floors the credit to 0, still shown as debuffed 0 vs base (1).
    const debuffs: Modifier[] = [{ stage: 'additive', field: 'clickIncome', value: -2 }]
    const el = render(makeIdlerState(debuffs)).querySelector('#data-click-income')!
    expect(el.querySelector('.data-value-debuffed')?.textContent).toBe('0')
    expect(el.querySelector('.data-value-base')?.textContent).toBe('(1)')
  })
})
