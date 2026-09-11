// @vitest-environment happy-dom
//
// The data panel's report of an incoming `clickIncome` debuff. "Per click"
// already folds the debuff in (it has to — it's what the server credits), so
// without these rows the victim reads a quietly halved number as their honest
// click power. One row per pipeline stage, each carrying the authored figure:
// the two compose in an order the panel can't restate, so they're never merged
// into a single number.
//
// DOM tier because the rows are toggled via `hidden` on live elements, which
// no-ops in the plain node environment.

import { beforeEach, describe, expect, it } from 'vitest'
import { createInitialState, getModeDefinition } from '@game/shared'
import type { Modifier } from '@game/shared'
import type { GameState } from '../src/game.js'
import { dataPanel } from '../src/ui/panels/data-panel.js'

const modeDef = getModeDefinition('idler')

const MULT_DEBUFF: Modifier = { stage: 'multiplicative', field: 'clickIncome', value: 0.5 }
const ADD_DEBUFF: Modifier = { stage: 'additive', field: 'clickIncome', value: -2 }
const RATE_DEBUFF: Modifier = { stage: 'multiplicative', field: 'r0', value: 0.5 }

/**
 * A playing-screen state with the given incoming debuffs. `sc-unlock` (+1 per
 * click) plus three `sc-af-cp` (+1 each, compounded by owned count) put the
 * undebuffed income at 4 — high enough that the additive debuff below bites
 * without hitting the floor at 0.
 */
function makeState(debuffs: Modifier[]): GameState {
  const player = createInitialState(modeDef)
  player.upgrades['sc-unlock'] = 1
  player.upgrades['sc-af-cp'] = 3
  return {
    screen: 'playing',
    mode: 'idler',
    goal: { type: 'timed', label: '⏱ Timed', durationSec: 60 },
    player,
    opponent: { resources: {}, rates: {} },
    opponentPurchaseFeed: [],
    debuffs,
    timeLeft: 60,
    paused: false,
    vsBot: false,
    matchId: null,
    upgrades: modeDef.upgrades,
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

/**
 * Render the panel into a fresh body. The panel fills its rows by
 * `getElementById`, so a leftover render from earlier in the same test would
 * swallow every write — one live panel at a time.
 */
function renderData(state: GameState): HTMLElement {
  document.body.innerHTML = ''
  const container = document.createElement('div')
  document.body.append(container)
  dataPanel.render(container, state)
  return container
}

function row(container: HTMLElement, stage: 'add' | 'mult'): HTMLElement {
  const el = container.querySelector<HTMLElement>(`#data-click-debuff-${stage}-row`)
  expect(el).not.toBeNull()
  return el!
}

function text(container: HTMLElement, id: string): string {
  return container.querySelector(`#${id}`)?.textContent ?? ''
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('data panel — Clicking section', () => {
  it('reports a multiplicative click debuff on its own row', () => {
    const container = renderData(makeState([MULT_DEBUFF]))
    expect(row(container, 'mult').hidden).toBe(false)
    expect(text(container, 'data-click-debuff-mult')).toBe('×0.5')
    // The flat row stays out of the way — nothing is draining a flat amount.
    expect(row(container, 'add').hidden).toBe(true)
    expect(text(container, 'data-click-income')).toBe('2')
  })

  it('reports an additive click debuff as the flat drain it is', () => {
    const container = renderData(makeState([ADD_DEBUFF]))
    expect(row(container, 'add').hidden).toBe(false)
    expect(text(container, 'data-click-debuff-add')).toBe('-2')
    expect(row(container, 'mult').hidden).toBe(true)
    expect(text(container, 'data-click-income')).toBe('2')
  })

  it('shows both stages side by side, each aggregated within its own stage', () => {
    // Two flat drains sum, two factors multiply, and the stages stay apart. The
    // income itself is the click track applied strictly in list order —
    // ((4 - 2 - 1) × 0.5) × 0.5 = 0.25, but ((4 × 0.5) × 0.5) - 2 - 1 would floor
    // at 0 from the very same four attacks. That a fixed data ordering decides
    // which of those a player gets is why no combined row is shown.
    const container = renderData(
      makeState([
        ADD_DEBUFF,
        { stage: 'additive', field: 'clickIncome', value: -1 },
        MULT_DEBUFF,
        { stage: 'multiplicative', field: 'clickIncome', value: 0.5 },
      ]),
    )
    expect(text(container, 'data-click-debuff-add')).toBe('-3')
    expect(text(container, 'data-click-debuff-mult')).toBe('×0.25')
    expect(text(container, 'data-click-income')).toBe('0.3')
  })

  it('hides both rows with no debuff, and for a debuff that is not on clicking', () => {
    let container = renderData(makeState([]))
    expect(row(container, 'add').hidden).toBe(true)
    expect(row(container, 'mult').hidden).toBe(true)
    container = renderData(makeState([RATE_DEBUFF]))
    expect(row(container, 'add').hidden).toBe(true)
    expect(row(container, 'mult').hidden).toBe(true)
    expect(text(container, 'data-click-income')).toBe('4')
  })

  it('hides both rows while clicking is locked, where there is nothing to lose', () => {
    // No `sc-unlock`: click income is 0 either way, so there is no bite to report.
    const state = makeState([MULT_DEBUFF, ADD_DEBUFF])
    state.player.upgrades = {}
    const container = renderData(state)
    expect(row(container, 'add').hidden).toBe(true)
    expect(row(container, 'mult').hidden).toBe(true)
  })
})
