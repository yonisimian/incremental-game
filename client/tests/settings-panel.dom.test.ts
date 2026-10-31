// @vitest-environment happy-dom
//
// Resign moved from the header into the Settings panel behind a two-click
// confirm. DOM tier because the failure is a click on the live button
// resigning too early, or never.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GameState } from '../src/game.js'

let current: { resigning: boolean }
const resignMatch = vi.fn<() => void>()

vi.mock('../src/game.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/game.js')>()),
  getState: () => current,
  resignMatch: () => {
    resignMatch()
  },
}))

const { settingsPanel } = await import('../src/ui/panels/settings-panel.js')
const { getAudioSettings, setMusicVolume } = await import('../src/ui/audio-settings.js')
const { resetDom } = await import('./dom-harness.js')

const state = () => current as unknown as GameState
const resignBtn = () => document.getElementById('resign-btn') as HTMLButtonElement

function mount(): HTMLElement {
  const container = document.createElement('div')
  document.body.appendChild(container)
  settingsPanel.render(container, state())
  settingsPanel.bind?.(state())
  return container
}

beforeEach(() => {
  vi.useFakeTimers()
  current = { resigning: false }
  resignMatch.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
  setMusicVolume(70)
  resetDom()
})

describe('settings panel — resign', () => {
  it('arms on the first click without resigning', () => {
    mount()
    resignBtn().click()

    expect(resignMatch).not.toHaveBeenCalled()
    expect(resignBtn().textContent).toBe('Confirm resign?')
    expect(resignBtn().classList.contains('confirming')).toBe(true)
  })

  it('drops focus when a pointer arms it, so a stray Space cannot confirm', () => {
    mount()
    resignBtn().focus()
    resignBtn().dispatchEvent(new MouseEvent('click', { detail: 1, bubbles: true }))

    expect(resignBtn().classList.contains('confirming')).toBe(true)
    expect(document.activeElement).not.toBe(resignBtn())
  })

  it('keeps focus when the keyboard arms it, so Enter can confirm', () => {
    mount()
    resignBtn().focus()
    resignBtn().click()

    expect(document.activeElement).toBe(resignBtn())
  })

  it('resigns on the second click', () => {
    mount()
    resignBtn().click()
    resignBtn().click()

    expect(resignMatch).toHaveBeenCalledTimes(1)
  })

  it('disarms after the confirm window, so a later click only arms again', () => {
    mount()
    resignBtn().click()
    vi.advanceTimersByTime(3000)

    expect(resignBtn().textContent).toBe('Resign')
    expect(resignBtn().classList.contains('confirming')).toBe(false)
    resignBtn().click()
    expect(resignMatch).not.toHaveBeenCalled()
  })

  it('disarms when the panel re-renders (tab switched away and back)', () => {
    mount()
    resignBtn().click()
    resetDom()
    mount()
    resignBtn().click()

    expect(resignMatch).not.toHaveBeenCalled()
  })

  it('freezes the button while the resign is in flight', () => {
    mount()
    resignBtn().click()
    resignBtn().click()
    current = { resigning: true }
    settingsPanel.update!(state())

    expect(resignBtn().disabled).toBe(true)
    expect(resignBtn().textContent).toBe('Resigning…')
    // The confirm window closing must not paint over the pending label.
    vi.advanceTimersByTime(3000)
    expect(resignBtn().textContent).toBe('Resigning…')
  })
})

describe('settings panel — preferences', () => {
  it('stores a volume dragged on its slider', () => {
    const container = mount()
    const slider = container.querySelector<HTMLInputElement>('input[data-volume="music"]')!
    slider.value = '25'
    slider.dispatchEvent(new Event('input', { bubbles: true }))

    expect(getAudioSettings().music).toBe(25)
    expect(container.querySelector('[data-volume-readout="music"]')!.textContent).toBe('25%')
    expect(slider.getAttribute('aria-valuetext')).toBe('25%')
  })
})
