// @vitest-environment happy-dom
//
// In a match, Escape opens the Settings panel (where Resign now lives) instead
// of resigning, and a focused volume slider must not swallow it. DOM tier
// because the failure is a real keydown on a real focused element.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let current: { screen: string; mode: string | null }
const resignMatch = vi.fn<() => void>()
const switchToPanel = vi.fn<(index: number) => void>()

vi.mock('../src/game.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/game.js')>()),
  getState: () => current,
  resignMatch: () => {
    resignMatch()
  },
}))

vi.mock('../src/ui/panels.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/ui/panels.js')>()),
  switchToPanel: (i: number) => {
    switchToPanel(i)
  },
}))

const { initHotkeys } = await import('../src/ui/hotkeys.js')
const { SETTINGS_PANEL_INDEX } = await import('../src/ui/mode-ui.js')
const { resetDom } = await import('./dom-harness.js')

initHotkeys()

function press(key: string, target: EventTarget = document.body): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
}

beforeEach(() => {
  current = { screen: 'playing', mode: 'idler' }
  resignMatch.mockClear()
  switchToPanel.mockClear()
})

afterEach(() => {
  resetDom()
})

describe('Escape hotkey', () => {
  it('opens the Settings panel mid-match without resigning', () => {
    press('Escape')
    expect(switchToPanel).toHaveBeenCalledWith(SETTINGS_PANEL_INDEX)
    expect(resignMatch).not.toHaveBeenCalled()
  })

  it('focuses Resign on a second press, once Settings is open', () => {
    const resignBtn = document.createElement('button')
    resignBtn.id = 'resign-btn'
    document.body.appendChild(resignBtn)
    press('Escape')
    expect(document.activeElement).toBe(resignBtn)
    expect(switchToPanel).not.toHaveBeenCalled()
    expect(resignMatch).not.toHaveBeenCalled()
  })

  it('still resigns during the countdown, which has no panels', () => {
    current = { screen: 'countdown', mode: 'idler' }
    press('Escape')
    expect(resignMatch).toHaveBeenCalledTimes(1)
  })

  it('reaches the hotkeys from a focused volume slider', () => {
    const slider = document.createElement('input')
    slider.type = 'range'
    document.body.appendChild(slider)
    press('Escape', slider)
    expect(switchToPanel).toHaveBeenCalledWith(SETTINGS_PANEL_INDEX)
  })

  it('leaves keystrokes in a text input alone', () => {
    const input = document.createElement('input')
    input.type = 'text'
    document.body.appendChild(input)
    press('Escape', input)
    expect(switchToPanel).not.toHaveBeenCalled()
  })
})
