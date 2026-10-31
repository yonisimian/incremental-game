// @vitest-environment happy-dom
//
// The About dialog opens the whole upgrade tree for reading before a match. It
// must show every upgrade at full strength, describe one without offering to
// buy it, and close back to About rather than closing both dialogs at once.
// DOM tier because the failures are what the lobby player actually meets:
// dimmed nodes, a Buy button, one Escape tearing down two dialogs.

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { getModeDefinition, getPrerequisiteUpgradeIds } from '@game/shared'

vi.mock('../src/game.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/game.js')>()),
  getState: () => ({ playerName: '', roomError: null }),
  doBuy: vi.fn(),
}))

let renderLobbyScreen: (typeof import('../src/ui/lobby.js'))['renderLobbyScreen']
let doBuy: (typeof import('../src/game.js'))['doBuy']

beforeAll(async () => {
  // `ui/helpers.ts` resolves `#app` at import time, so it must exist first.
  document.body.innerHTML = '<div id="app"></div>'
  ;({ renderLobbyScreen } = await import('../src/ui/lobby.js'))
  ;({ doBuy } = await import('../src/game.js'))
})

afterEach(() => {
  document.getElementById('tree-reader-overlay')?.remove()
  document.getElementById('about-overlay')?.remove()
})

const mode = getModeDefinition('idler')

function openReader(): HTMLElement {
  renderLobbyScreen()
  document.querySelector<HTMLButtonElement>('#about-btn')!.click()
  document.querySelector<HTMLButtonElement>('#about-tree-btn')!.click()
  return document.getElementById('tree-reader-overlay')!
}

const escape = (target: EventTarget = document): void => {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
}

describe('upgrade tree reader (DOM)', () => {
  it('shows every upgrade, goal-specific ones included, none dimmed', () => {
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
    overlay.querySelector<HTMLButtonElement>(`.tree-node[data-upgrade="${gated.id}"]`)!.click()

    const popup = overlay.querySelector('#upgrade-detail')!
    expect(popup.querySelector('#upgrade-detail-buy')).toBeNull()
    expect(popup.querySelector('#upgrade-detail-lock')!.textContent).toMatch(/^Requires /)
    expect(popup.querySelector('#upgrade-detail-cancel')!.textContent).toBe('Close')
    expect(doBuy).not.toHaveBeenCalled()
  })

  it('closes one layer per Escape: popup, then reader, leaving About open', () => {
    vi.useFakeTimers()
    const overlay = openReader()
    vi.runAllTimers()
    overlay.querySelector<HTMLButtonElement>('.tree-node')!.click()

    escape(document.getElementById('upgrade-detail-cancel')!)
    expect(overlay.querySelector('#upgrade-detail')).toBeNull()
    expect(document.getElementById('tree-reader-overlay')).not.toBeNull()

    escape()
    vi.runAllTimers()
    expect(document.getElementById('tree-reader-overlay')).toBeNull()
    expect(document.getElementById('about-overlay')).not.toBeNull()
    vi.useRealTimers()
  })
})
