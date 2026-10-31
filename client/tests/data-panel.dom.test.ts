// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  COUNTDOWN_SEC,
  ROUND_DURATION_SEC,
  getModeDefinition,
  type Modifier,
  type PlayerState,
} from '@game/shared'
import type { GameState } from '../src/game.js'
import { roundStats } from '../src/stats/round-stats.js'
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
    opponentPactWindows: [],
    incomingAutoClicksPerSec: 0,
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

/** The `.data-section` card holding element `id`. */
function sectionOf(el: HTMLElement, id: string): HTMLElement {
  return el.querySelector(`#${id}`)!.closest<HTMLElement>('.data-section')!
}

/** An idler state owning `upgrades` (on top of `sc-unlock`), its clock at `gameSec`. */
function withUpgrades(
  upgrades: Record<string, number>,
  gameSec = 0,
  player: Partial<PlayerState> = {},
): GameState {
  const state = makeIdlerState()
  state.player = {
    ...state.player,
    ...player,
    upgrades: { ...state.player.upgrades, ...upgrades },
    meta: { ...state.player.meta, gameSec, ...player.meta },
  }
  return state
}

/** The first row of the per-item list `listId`. */
function firstRow(el: HTMLElement, listId: string): HTMLElement {
  return el.querySelector<HTMLElement>(`#${listId} .data-item`)!
}

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

describe('data panel — attacks section', () => {
  beforeEach(() => {
    roundStats.reset()
  })

  it('is hidden until the attack tab unlocks or an enemy strike lands', () => {
    expect(sectionOf(render(makeIdlerState()), 'data-attacks').style.display).toBe('none')
    const hit = withUpgrades({}, 0, { meta: { attacksSuffered: 1 } })
    expect(sectionOf(render(hit), 'data-attacks').style.display).toBe('')
  })

  it('shows weighted slots and one row per held attack', () => {
    // `node` unlocks a0 (active), `node-3` unlocks a2 (passive).
    const el = render(withUpgrades({ 'a-unlock': 1, node: 1, 'node-3': 1 }))
    expect(sectionOf(el, 'data-attacks').style.display).toBe('')
    expect(el.querySelector('#data-atk-slots-active')?.textContent).toBe('1 / 3')
    expect(el.querySelector('#data-atk-slots-passive')?.textContent).toBe('1 / 4')
    expect(el.querySelectorAll('#data-atk-list .data-item')).toHaveLength(2)
  })

  it('reports an active attack cooling down, its resolved stats and its haul', () => {
    const a0 = getModeDefinition('idler').attacks.find((a) => a.id === 'a0')!
    roundStats.recordAttackEvents([
      { attack: 'a0', direction: 'outgoing', kind: 'resource', resource: 'r0', amount: 120, t: 6 },
    ])
    const state = withUpgrades({ 'a-unlock': 1, node: 1 }, 8, {
      cooldowns: [{ kind: 'attack', id: 'a0', untilSec: 16 }],
    })
    const row = firstRow(render(state), 'data-atk-list')
    expect(row.querySelector('.data-item-status')?.textContent).toBe('Ready in 8.0s')
    const details = [...row.querySelectorAll('.data-item-detail')].map((d) => d.textContent)
    expect(details[0]).toContain(`prep ${a0.prepareTimeSec}s`)
    expect(details[0]).toContain(`cooldown ${a0.cooldownSec}s`)
    expect(details[1]).toMatch(/^1 strike · stole 120 /)
  })

  it('reports incoming totals and the debuffs and locks on the player now', () => {
    roundStats.recordAttackEvents([
      { attack: 'a1', direction: 'incoming', kind: 'resource', resource: 'r1', amount: 40, t: 3 },
    ])
    const state = withUpgrades({ 'a-unlock': 1 }, 5, {
      meta: { attacksSuffered: 2 },
      incomingPurchaseLocks: [{ scope: 'generator', untilSec: 9 }],
    })
    state.debuffs = [{ stage: 'multiplicative', field: 'clickIncome', value: 0.5 }]
    const el = render(state)
    expect(el.querySelector('#data-atk-in-strikes')?.textContent).toBe('2')
    expect(el.querySelector('#data-atk-in-lost-r1')?.textContent).toBe('40')
    expect(el.querySelector('#data-atk-in-lost-r0')?.textContent).toBe('0')
    const now = el.querySelector('#data-atk-now')!.textContent.replace(/\s+/g, ' ')
    expect(now).toContain('per click ×0.5')
    expect(now).toContain('🔒 generators 4.0s')
  })
})

describe('data panel — pacts section', () => {
  beforeEach(() => {
    roundStats.reset()
  })

  it('is hidden until the relations tab unlocks or an enemy treaty reaches the player', () => {
    expect(sectionOf(render(makeIdlerState()), 'data-pacts').style.display).toBe('none')
    const reached = makeIdlerState()
    reached.opponentPacts = ['p1']
    expect(sectionOf(render(reached), 'data-pacts').style.display).toBe('')
  })

  it('shows what a passive pact is worth now', () => {
    const state = withUpgrades({ 'ir-unlock': 1, 'pact-node': 1 })
    state.pactBonuses = [
      {
        pact: 'highlighted-clicks',
        modifiers: [{ stage: 'multiplicative', field: 'r0', value: 1.12 }],
      },
    ]
    const el = render(state)
    expect(el.querySelector('#data-pact-own')?.hasAttribute('hidden')).toBe(false)
    const row = firstRow(el, 'data-pact-list')
    expect(row.querySelector('.data-item-status')?.textContent).toBe('In force')
    expect(row.querySelector('.data-item-detail')?.textContent).toMatch(/^\+12% .* production$/)
  })

  it("counts an active pact's activations, time active and spend", () => {
    const modeDef = getModeDefinition('idler')
    const accord = modeDef.pacts.find((p) => p.id === 'drum-accord')!
    const opened = 2
    const expiresAtSec = opened + accord.durationSec!
    const state = withUpgrades({ 'ir-unlock': 1, 'pact-drum-accord': 1 }, opened + 5, {
      activePacts: [{ pact: 'drum-accord', expiresAtSec }],
    })
    roundStats.recordPactWindows(state.player, modeDef)
    const row = firstRow(render(state), 'data-pact-list')
    expect(row.querySelector('.data-item-status')?.textContent).toBe(
      `Active for ${(expiresAtSec - opened - 5).toFixed(1)}s`,
    )
    expect(row.querySelector('.data-item-detail')?.textContent).toMatch(
      /^1 activation · 5s active · spent 300 /,
    )
  })

  it('lists the enemy treaties reaching the player, with countdowns and auto-clicks', () => {
    const state = withUpgrades({}, 5)
    state.opponentPacts = ['drum-accord']
    state.opponentPactWindows = [{ pact: 'drum-accord', expiresAtSec: 12 }]
    state.incomingAutoClicksPerSec = 2.5
    const el = render(state)
    expect(el.querySelector('#data-pact-own')?.hasAttribute('hidden')).toBe(true)
    expect(
      firstRow(el, 'data-pact-shared-list').querySelector('.data-item-status')?.textContent,
    ).toBe('Active for 7.0s')
    expect(el.querySelector('#data-pact-autoclicks')?.textContent).toBe('+2.5/s')
  })
})
