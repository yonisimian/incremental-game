// @vitest-environment happy-dom
//
// The About dialog opens the whole upgrade tree for reading before a match. It
// must show every upgrade at full strength, describe one without offering to
// buy it, and close one layer per Escape (popup, then reader, then About), and
// closing it must not leave a popup behind that swallows a later Escape.
// DOM tier because the failures are what the lobby player actually meets:
// dimmed nodes, a Buy button, one Escape tearing down two dialogs, an Escape
// that no longer leaves the matchmaking queue. The global hotkeys run too,
// since they also handle Escape.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { getModeDefinition, getPrerequisiteUpgradeIds } from '@game/shared'

let current: { screen: string; playerName: string; roomError: null }
const doBuy = vi.fn<(id: string) => void>()
const cancelQueue = vi.fn<() => void>()

vi.mock('../src/game.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/game.js')>()),
  getState: () => current,
  doBuy: (id: string) => {
    doBuy(id)
  },
  cancelQueue: () => {
    cancelQueue()
  },
}))

let renderLobbyScreen: (typeof import('../src/ui/lobby.js'))['renderLobbyScreen']

beforeAll(async () => {
  // `ui/helpers.ts` resolves `#app` at import time, so it must exist first.
  document.body.innerHTML = '<div id="app"></div>'
  ;({ renderLobbyScreen } = await import('../src/ui/lobby.js'))
  const { initHotkeys } = await import('../src/ui/hotkeys.js')
  initHotkeys()
})

beforeEach(() => {
  vi.useFakeTimers()
  current = { screen: 'lobby', playerName: '', roomError: null }
  doBuy.mockClear()
  cancelQueue.mockClear()
})

afterEach(() => {
  // Close through ✕, topmost first, so the modal stack is empty for the next test.
  for (const id of ['tree-reader-overlay', 'about-overlay']) {
    document.querySelector<HTMLButtonElement>(`#${id} .modal-close`)?.click()
    vi.runAllTimers()
  }
  vi.useRealTimers()
})

const mode = getModeDefinition('idler')

function openReader(): HTMLElement {
  renderLobbyScreen()
  document.querySelector<HTMLButtonElement>('#about-btn')!.click()
  document.querySelector<HTMLButtonElement>('#about-tree-btn')!.click()
  vi.runAllTimers()
  return document.getElementById('tree-reader-overlay')!
}

function openPopup(overlay: HTMLElement, id = mode.upgrades[0].id): void {
  overlay.querySelector<HTMLButtonElement>(`.tree-node[data-upgrade="${id}"]`)!.click()
}

function escape(target: EventTarget = document.body): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  vi.runAllTimers()
}

const isOpen = (id: string): boolean => document.getElementById(id) !== null

describe('upgrade tree reader (DOM)', () => {
  it('shows every upgrade, goal-specific ones included, dimming only coming-soon ones', () => {
    const overlay = openReader()
    const nodes = [...overlay.querySelectorAll<HTMLElement>('.tree-node')]

    expect(nodes.map((n) => n.dataset.upgrade).sort()).toEqual(
      mode.upgrades
        .filter((u) => u.position)
        .map((u) => u.id)
        .sort(),
    )
    const dimmed = nodes.filter((n) => n.matches('.locked, .too-expensive, .locked-by-attack'))
    const comingSoon = mode.upgrades.filter((u) => u.comingSoon).map((u) => u.id)
    expect(dimmed.map((n) => n.dataset.upgrade)).toEqual(comingSoon)
  })

  it('describes an upgrade with its prerequisites and no Buy button', () => {
    const overlay = openReader()
    const gated = mode.upgrades.find(
      (u) => u.position && !u.comingSoon && getPrerequisiteUpgradeIds(u.prerequisites).length > 0,
    )!
    openPopup(overlay, gated.id)

    const popup = overlay.querySelector('#upgrade-detail')!
    expect(popup.querySelector('#upgrade-detail-buy')).toBeNull()
    expect(popup.querySelector('#upgrade-detail-lock')!.textContent).toMatch(/^Requires /)
    expect(popup.querySelector('#upgrade-detail-cancel')!.textContent).toBe('Close')
    expect(doBuy).not.toHaveBeenCalled()
  })

  it('closes one layer per Escape while focus is in the popup', () => {
    const overlay = openReader()
    openPopup(overlay)

    escape(document.getElementById('upgrade-detail-cancel')!)
    expect(overlay.querySelector('#upgrade-detail')).toBeNull()
    expect(isOpen('tree-reader-overlay')).toBe(true)

    escape()
    expect(isOpen('tree-reader-overlay')).toBe(false)
    expect(isOpen('about-overlay')).toBe(true)
  })

  it('closes only the popup on Escape while focus is elsewhere', () => {
    const overlay = openReader()
    openPopup(overlay)
    ;(document.activeElement as HTMLElement).blur()

    escape()
    expect(overlay.querySelector('#upgrade-detail')).toBeNull()
    expect(isOpen('tree-reader-overlay')).toBe(true)
  })

  it('leaves no popup behind when closed with one open', () => {
    const overlay = openReader()
    openPopup(overlay)
    overlay.querySelector<HTMLButtonElement>('.modal-close')!.click()
    document.querySelector<HTMLButtonElement>('#about-overlay .modal-close')!.click()
    vi.runAllTimers()

    // In the matchmaking queue, the next Escape must leave it.
    current.screen = 'waiting'
    escape()
    expect(cancelQueue).toHaveBeenCalledOnce()
  })
})
