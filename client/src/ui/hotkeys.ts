import { doClick, doBuy, setHighlight, getState } from '../game.js'
import { canAfford } from './helpers.js'

/**
 * Set to true while the hotkey handler is processing a Space press.
 * The click-button listener checks this to avoid double-firing doClick().
 */
export let handledByHotkey = false

/** Register global keyboard shortcuts. Call once at startup. */
export function initHotkeys(): void {
  document.addEventListener('keydown', (e) => {
    const state = getState()
    if (state.screen !== 'playing') return

    // Don't intercept keystrokes while typing in an input
    const target = e.target as HTMLElement
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      return

    // Let the tab grid handle its own keyboard events (Space activates tab, arrows navigate)
    const inTabGrid = target.closest('#tab-grid') !== null

    // Space — click (clicker mode), unless focus is inside the tab grid
    if (e.key === ' ' || e.code === 'Space') {
      if (inTabGrid || state.mode !== 'clicker') return
      e.preventDefault() // prevent page scroll
      handledByHotkey = true
      setTimeout(() => {
        handledByHotkey = false
      }, 200)
      doClick()
      return
    }

    // Tab — toggle highlight (idler mode), unless focus is inside the tab grid
    if (e.key === 'Tab') {
      if (inTabGrid || state.mode !== 'idler') return // allow natural focus movement
      e.preventDefault() // prevent focus shift
      const current = (state.player.meta.highlight as string | undefined) ?? 'wood'
      setHighlight(current === 'wood' ? 'ale' : 'wood')
      return
    }

    // C — buy all affordable upgrades (cheapest first)
    if (e.key === 'c' || e.key === 'C') {
      const affordable = state.upgrades
        .filter((u) => canAfford(state, u))
        .sort((a, b) => a.cost - b.cost)
      for (const u of affordable) doBuy(u.id)
      return
    }

    // 1/2/3 — buy upgrade by index
    const index = Number(e.key) - 1
    if (index >= 0 && index < state.upgrades.length) {
      doBuy(state.upgrades[index].id)
    }
  })
}
