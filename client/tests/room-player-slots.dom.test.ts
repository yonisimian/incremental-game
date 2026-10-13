// @vitest-environment happy-dom
//
// The room's two seats name whoever sits in them. A player who skipped the
// name field still has a seat, so they get a role label ("Host" / "Guest")
// rather than looking like nobody is there. Each seat also carries tags:
// "Lobby owner" on the host's seat for both players, "(you)" on the viewer's
// own seat. DOM tier: this is purely about the rendered lobby.

import { beforeAll, describe, expect, it, vi } from 'vitest'
import { getModeDefinition } from '@game/shared'
import type { GameState } from '../src/game.js'

vi.mock('../src/game.js', () => ({
  cancelQueue: vi.fn(),
  quitMatch: vi.fn(),
  requestBot: vi.fn(),
  startRoomMatch: vi.fn(),
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

const slots = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('.player-slot')]
const texts = (): string[] =>
  slots().map((s) => s.querySelector('.player-slot-name')!.textContent.trim())
const tags = (): string[][] =>
  slots().map((s) => [...s.querySelectorAll('.player-tag')].map((t) => t.textContent.trim()))

describe('room player slots (DOM)', () => {
  it('names both seated players', () => {
    renderRoomScreen(roomState(['Alice', 'Bob']))
    expect(texts()).toEqual(['Alice', 'Bob'])
    expect(slots().map((s) => s.classList.contains('filled'))).toEqual([true, true])
  })

  it('shows the second seat as waiting until someone joins', () => {
    renderRoomScreen(roomState(['Alice']))
    expect(texts()).toEqual(['Alice', 'Waiting…'])
    expect(slots()[1].classList.contains('empty')).toBe(true)
  })

  it('labels a nameless joiner Guest rather than an empty seat', () => {
    renderRoomScreen(roomState(['Alice', '']))
    expect(texts()).toEqual(['Alice', 'Guest'])
    expect(slots()[1].classList.contains('filled')).toBe(true)
  })

  it('labels a nameless host Host', () => {
    renderRoomScreen(roomState(['', 'Bob'], false))
    expect(texts()).toEqual(['Host', 'Bob'])
  })

  it('fills the seat in place when the joiner arrives', () => {
    renderRoomScreen(roomState(['Alice']))
    updateRoomScreen(roomState(['Alice', '']))
    expect(texts()).toEqual(['Alice', 'Guest'])
    updateRoomScreen(roomState(['Alice', 'Bob']))
    expect(texts()).toEqual(['Alice', 'Bob'])
  })

  it('keeps a HTML-like name as text', () => {
    renderRoomScreen(roomState(['Alice', '<img src=x>']))
    expect(texts()[1]).toBe('<img src=x>')
    expect(document.querySelector('.player-slot img')).toBeNull()
  })

  it('tags the host seat as lobby owner and the creator as (you)', () => {
    renderRoomScreen(roomState(['Alice', 'Bob'], true))
    expect(tags()).toEqual([['Lobby owner', '(you)'], []])
  })

  it('tags the guest seat as (you) for the joiner, keeping the owner tag on the host', () => {
    renderRoomScreen(roomState(['Alice', 'Bob'], false))
    expect(tags()).toEqual([['Lobby owner'], ['(you)']])
  })

  it('never tags an empty seat', () => {
    renderRoomScreen(roomState(['Alice'], true))
    expect(tags()).toEqual([['Lobby owner', '(you)'], []])
  })

  it('moves the tags when the remaining player is promoted to owner', () => {
    renderRoomScreen(roomState(['Alice', 'Bob'], false))
    updateRoomScreen(roomState(['Bob'], true))
    expect(texts()).toEqual(['Bob', 'Waiting…'])
    expect(tags()).toEqual([['Lobby owner', '(you)'], []])
  })
})
