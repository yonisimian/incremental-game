import {
  doClick,
  doBuy,
  setHighlight,
  getState,
  togglePause,
  cancelQueue,
  quitMatch,
} from '../game.js'
import { canBuy } from './helpers.js'
import { switchToPanel, switchToPanelRelative } from './panels.js'
import { isUpgradeDetailOpen, closeUpgradeDetail } from './upgrade-detail.js'
import { getModeDefinition, getUpgradeCostTotal, isHighlightActive } from '@game/shared'

/** Register global keyboard shortcuts. Call once at startup. */
export function initHotkeys(): void {
  // Block Tab from cycling focus on all screens — this is a game, not a form.
  // Must be registered unconditionally (even on touch devices) so Tab never
  // moves focus to arbitrary buttons/links.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') e.preventDefault()
  })

  if (window.matchMedia('(pointer: coarse)').matches) return

  document.addEventListener('keydown', (e) => {
    const state = getState()

    // Don't intercept keystrokes while typing in an input
    const target = e.target as HTMLElement
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      return

    // ── Escape — context-sensitive quit/back (screen-agnostic) ──
    if (e.key === 'Escape') {
      // An open upgrade-detail popup takes priority — close it, don't quit.
      if (isUpgradeDetailOpen()) {
        closeUpgradeDetail()
        return
      }
      if (state.screen === 'playing' || state.screen === 'countdown') {
        quitMatch()
      } else if (state.screen === 'waiting' || state.screen === 'room') {
        cancelQueue()
      }
      return
    }

    // Pause / resume hotkey (bot matches only).
    if (e.key.toLowerCase() === 'p' && state.screen === 'playing' && state.mode && state.vsBot) {
      e.preventDefault()
      togglePause()
      return
    }

    // Everything below requires the playing screen
    if (state.screen !== 'playing' || !state.mode) return

    const modeDef = getModeDefinition(state.mode)

    // ── Ctrl + digit/arrow — panel switching ──
    // Only intercept Ctrl (not Cmd/Meta on Mac — let macOS shortcuts pass through)
    if (e.ctrlKey && !e.metaKey) {
      // Ctrl+1…9 → panels 0…8, Ctrl+0 → panel 9
      if (e.key >= '0' && e.key <= '9') {
        e.preventDefault()
        const index = e.key === '0' ? 9 : Number(e.key) - 1
        switchToPanel(index)
        return
      }
      // Ctrl+ArrowLeft/Right → prev/next panel
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        switchToPanelRelative(-1)
        return
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        switchToPanelRelative(1)
        return
      }
      // Don't intercept other Ctrl shortcuts (Ctrl+R, Ctrl+W, etc.)
      return
    }

    // Don't intercept Meta/Alt combos
    if (e.metaKey || e.altKey) return

    // Let the tab grid handle its own keyboard events (Space activates tab, arrows navigate)
    const inTabGrid = target.closest('#tab-grid') !== null

    // Space — click (clicks-enabled modes), unless focus is inside the tab grid
    if (e.key === ' ' || e.code === 'Space') {
      if (inTabGrid || !modeDef.clicksEnabled) return
      e.preventDefault() // prevent page scroll
      doClick()
      return
    }

    // Tab — cycle highlight (non-clicking modes with highlight), unless focus is inside the tab grid
    if (e.key === 'Tab') {
      if (inTabGrid || !isHighlightActive(state.player, modeDef)) return
      const resources = modeDef.resources
      const current = (state.player.meta.highlight as string | undefined) ?? resources[0]
      const idx = resources.indexOf(current)
      setHighlight(resources[(idx + 1) % resources.length])
      return
    }

    // C — buy all buyable upgrades (cheapest first); skips locked & one-shot-owned
    if (e.key === 'c' || e.key === 'C') {
      const buyable = state.upgrades
        .filter((u) => canBuy(state, u))
        .sort(
          (a, b) =>
            getUpgradeCostTotal(a, state.player.upgrades[a.id] ?? 0) -
            getUpgradeCostTotal(b, state.player.upgrades[b.id] ?? 0),
        )
      for (const u of buyable) doBuy(u.id)
      return
    }
  })
}
