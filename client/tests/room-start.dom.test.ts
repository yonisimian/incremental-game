// @vitest-environment happy-dom
//
// A full room no longer starts on its own: the creator gets a Start button and
// the joiner is told to wait. DOM tier because what each player sees — and that
// the button is what sends the start — is about the rendered lobby (the
// server-side gate lives in matchmaking.test.ts).

import { beforeAll, describe, expect, it, vi } from 'vitest'
import { getModeDefinition } from '@game/shared'
import type { GameState } from '../src/game.js'

const startRoomMatch = vi.fn()

vi.mock('../src/game.js', () => ({
  cancelQueue: vi.fn(),
  quitMatch: vi.fn(),
  requestBot: vi.fn(),
  startRoomMatch,
  updateRoomSettings: vi.fn(),
}))
vi.mock('../src/network.js', () => ({ connect: vi.fn() }))

let renderRoomScreen: (typeof import('../src/ui/screens.js'))['renderRoomScreen']
let updateRoomScreen: (typeof import('../src/ui/screens.js'))['updateRoomScreen']

beforeAll(async () => {
  // `ui/helpers.ts` resolves `#app` at import time, so it must exist first.
  document.body.innerHTML = '<div id="app"></div>'
  ;({ renderRoomScreen, updateRoomScreen } = await import('../src/ui/screens.js'))
})

function roomState(roomPlayers: string[], isRoomCreator = true): GameState {
  return {
    roomCode: 'ABC123',
    roomSettings: { mode: 'idler', goal: getModeDefinition('idler').goals[0] },
    roomPlayers,
    isRoomCreator,
  } as unknown as GameState
}

const startBtn = () => document.getElementById('room-start-btn')
const botBtn = () => document.getElementById('room-bot-btn')
const waiting = () => document.getElementById('room-waiting')

describe('room start (DOM)', () => {
  it('offers the creator a bot while alone, never a start', () => {
    renderRoomScreen(roomState(['Me']))
    expect(botBtn()).not.toBeNull()
    expect(startBtn()).toBeNull()
    expect(waiting()).toBeNull()
  })

  it('swaps the bot button for Start when the second player arrives', () => {
    renderRoomScreen(roomState(['Me']))
    updateRoomScreen(roomState(['Me', 'Them']))
    expect(botBtn()).toBeNull()
    expect(startBtn()).not.toBeNull()
  })

  it('sends the start when the creator clicks the button', () => {
    startRoomMatch.mockClear()
    renderRoomScreen(roomState(['Me', 'Them']))
    startBtn()!.click()
    expect(startRoomMatch).toHaveBeenCalledOnce()
  })

  it('tells the joiner to wait for the host', () => {
    renderRoomScreen(roomState(['Them', 'Me'], false))
    expect(startBtn()).toBeNull()
    expect(botBtn()).toBeNull()
    expect(waiting()!.textContent).toMatch(/host/u)
  })

  it('hands the promoted joiner the start once the room refills', () => {
    renderRoomScreen(roomState(['Them', 'Me'], false))
    updateRoomScreen(roomState(['Me'], true))
    expect(botBtn()).not.toBeNull()
    updateRoomScreen(roomState(['Me', 'New'], true))
    expect(startBtn()).not.toBeNull()
  })
})
