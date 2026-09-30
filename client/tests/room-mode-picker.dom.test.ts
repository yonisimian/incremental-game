// @vitest-environment happy-dom
//
// The room creator picks which tree (mode) the match is played on. The picker
// only renders when more than one mode is available, and a chip click is what
// sends the `ROOM_UPDATE` — DOM tier because both are about the rendered
// lobby, not the settings logic (covered server-side in matchmaking.test.ts).

import { beforeAll, describe, expect, it, vi } from 'vitest'
import { getAvailableModes, getModeDefinition, getModeFlavor } from '@game/shared'
import type { GameMode } from '@game/shared'
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

function roomState(mode: GameMode, isRoomCreator = true): GameState {
  return {
    roomCode: 'ABC123',
    roomSettings: { mode, goal: getModeDefinition(mode).goals[0] },
    roomPlayers: ['Me'],
    isRoomCreator,
  } as unknown as GameState
}

const chips = (): HTMLButtonElement[] => [
  ...document.querySelectorAll<HTMLButtonElement>('#mode-chips .mode-chip'),
]

describe('room mode picker (DOM)', () => {
  it('shows one chip per tree, labelled with its display name, current one selected', () => {
    renderRoomScreen(roomState('idler-alternative'))
    expect(chips().map((c) => c.dataset.mode)).toEqual(getAvailableModes())
    expect(chips().map((c) => c.textContent)).toEqual(
      getAvailableModes().map((m) => getModeFlavor(getModeDefinition(m)).displayName),
    )
    const selected = chips().filter((c) => c.classList.contains('selected'))
    expect(selected.map((c) => c.dataset.mode)).toEqual(['idler-alternative'])
  })

  it('sends the chosen tree as a room settings update', () => {
    updateRoomSettings.mockClear()
    renderRoomScreen(roomState('idler'))
    chips()
      .find((c) => c.dataset.mode === 'idler-alternative')!
      .click()
    expect(updateRoomSettings).toHaveBeenCalledWith({ mode: 'idler-alternative' })
  })

  it('hides the picker from the joining player', () => {
    renderRoomScreen(roomState('idler', false))
    expect(chips()).toHaveLength(0)
  })
})
