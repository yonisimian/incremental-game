import { doClick, doBuy, setHighlight, getState } from '../game.js'
import { canBuy, UPGRADE_HOTKEYS } from './helpers.js'
import type { UpgradeCategory } from '@game/shared'

/**
 * Set to true while the hotkey handler is processing a Space press.
 * The click-button listener checks this to avoid double-firing doClick().
 */
export let handledByHotkey = false

/** Register global keyboard shortcuts. Call once at startup. */
export function initHotkeys(): void {
  if (window.matchMedia('(pointer: coarse)').matches) return

  document.addEventListener('keydown', (e) => {
    const state = getState()
    if (state.screen !== 'playing') return

    // Don't intercept keystrokes while typing in an input
    const target = e.target as HTMLElement
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      return

    // Don't intercept browser shortcuts (Ctrl+R reload, Ctrl+W close, Ctrl+1 switch tab, etc.)
    if (e.ctrlKey || e.metaKey || e.altKey) return

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

    // C — buy all buyable upgrades (cheapest first); skips locked & one-shot-owned
    if (e.key === 'c' || e.key === 'C') {
      const buyable = state.upgrades.filter((u) => canBuy(state, u)).sort((a, b) => a.cost - b.cost)
      for (const u of buyable) doBuy(u.id)
      return
    }

    // Per-category indexed buy: 1/2/3… → play (see UPGRADE_HOTKEYS).
    // Categories without an entry (e.g. tree) have no per-index hotkeys.
    const pressed = e.key.toLowerCase()
    for (const cat of Object.keys(UPGRADE_HOTKEYS) as UpgradeCategory[]) {
      const keys = UPGRADE_HOTKEYS[cat]
      if (!keys) continue
      const idx = keys.toLowerCase().indexOf(pressed)
      if (idx === -1) continue
      const upgrades = state.upgrades.filter((u) => (u.category ?? 'play') === cat)
      if (idx < upgrades.length) doBuy(upgrades[idx].id)
      return
    }
  })
}
