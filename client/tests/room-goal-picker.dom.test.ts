// @vitest-environment happy-dom
//
// The room creator picks the goal from chips; beside the mode's own goals sits
// a "random" chip that defers the pick to match start. DOM tier because the
// chip, its selected state, the absent tuning input and the joiner's label are
// all about the rendered lobby (the settings logic is in matchmaking.test.ts).

import { beforeAll, describe, expect, it, vi } from 'vitest'
import { RANDOM_GOAL, getModeDefinition } from '@game/shared'
import type { GoalChoice } from '@game/shared'
import type { GameState } from '../src/game.js'

const updateRoomSettings = vi.fn()

vi.mock('../src/game.js', () => ({
  cancelQueue: vi.fn(),
  quitMatch: vi.fn(),
  requestBot: vi.fn(),
  updateRoomSettings,
}))
vi.mock('../src/network.js', () => ({ connect: vi.fn() }))

let renderRoomScreen: (typeof import('../src/ui/screens.js'))['renderRoomScreen']

beforeAll(async () => {
  // `ui/helpers.ts` resolves `#app` at import time, so it must exist first.
  document.body.innerHTML = '<div id="app"></div>'
  ;({ renderRoomScreen } = await import('../src/ui/screens.js'))
})

const idlerGoals = () => getModeDefinition('idler').goals

function roomState(goal: GoalChoice, isRoomCreator = true): GameState {
  return {
    roomCode: 'ABC123',
    roomSettings: { mode: 'idler', goal },
    roomPlayers: ['Me'],
    isRoomCreator,
  } as unknown as GameState
}

const chips = (): HTMLButtonElement[] => [
  ...document.querySelectorAll<HTMLButtonElement>('#goal-chips .goal-chip'),
]

describe('room goal picker (DOM)', () => {
  it("offers a random chip after the mode's goals", () => {
    renderRoomScreen(roomState(idlerGoals()[0]))
    expect(chips().map((c) => c.dataset.goalType)).toEqual([
      ...idlerGoals().map((g) => g.type),
      'random',
    ])
  })

  it('sends the random pick as a room settings update', () => {
    updateRoomSettings.mockClear()
    renderRoomScreen(roomState(idlerGoals()[0]))
    chips()
      .find((c) => c.dataset.goalType === 'random')!
      .click()
    expect(updateRoomSettings).toHaveBeenCalledWith({ goal: RANDOM_GOAL })
  })

  it('marks random selected and shows no tuning input', () => {
    renderRoomScreen(roomState(RANDOM_GOAL))
    const selected = chips().filter((c) => c.classList.contains('selected'))
    expect(selected.map((c) => c.dataset.goalType)).toEqual(['random'])
    expect(document.querySelector('#room-settings input')).toBeNull()
  })

  it('tells the joining player the goal is random', () => {
    renderRoomScreen(roomState(RANDOM_GOAL, false))
    expect(chips()).toHaveLength(0)
    expect(document.getElementById('room-settings')!.textContent).toContain(RANDOM_GOAL.label)
  })
})
