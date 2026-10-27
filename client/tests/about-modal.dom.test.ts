// @vitest-environment happy-dom
//
// The lobby's "i" button must open the About dialog, and only one of it.
// DOM tier because the failure is a click on the rendered lobby not reaching the modal.

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('../src/game.js', () => ({
  quickMatch: vi.fn(),
  createRoom: vi.fn(),
  joinRoom: vi.fn(),
  getState: () => ({ playerName: '', roomError: null }),
  setPlayerName: vi.fn(),
}))

let renderLobbyScreen: (typeof import('../src/ui/lobby.js'))['renderLobbyScreen']

beforeAll(async () => {
  // `ui/helpers.ts` resolves `#app` at import time, so it must exist first.
  document.body.innerHTML = '<div id="app"></div>'
  ;({ renderLobbyScreen } = await import('../src/ui/lobby.js'))
})

afterEach(() => {
  document.getElementById('about-overlay')?.remove()
})

const aboutBtn = (): HTMLButtonElement => document.querySelector<HTMLButtonElement>('#about-btn')!

describe('about modal (DOM)', () => {
  it('opens from the lobby with a heading and a sentence about the game', () => {
    renderLobbyScreen()
    aboutBtn().click()

    const overlay = document.getElementById('about-overlay')!
    expect(overlay.querySelector('h2')!.textContent).toBe('About')
    expect(overlay.querySelector('.about-body')!.textContent).toContain('head-to-head')
  })

  it('does not stack a second dialog on a repeat click', () => {
    renderLobbyScreen()
    aboutBtn().click()
    aboutBtn().click()

    expect(document.querySelectorAll('#about-overlay')).toHaveLength(1)
  })
})
