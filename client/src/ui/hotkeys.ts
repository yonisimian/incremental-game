import { doClick, doBuy, setHighlight, getState } from '../game.js'
import { canAfford } from './helpers.js'

/** Register global keyboard shortcuts. Call once at startup. */
export function initHotkeys(): void {
  document.addEventListener('keydown', (e) => {
    const state = getState()
    if (state.screen !== 'playing') return

    // Space — click (clicker mode)
    if (e.key === ' ' || e.code === 'Space') {
      e.preventDefault() // prevent page scroll
      doClick()
      return
    }

    // Tab — toggle highlight (idler mode)
    if (e.key === 'Tab') {
      e.preventDefault() // prevent focus shift
      const current = state.player.highlight ?? 'wood'
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
