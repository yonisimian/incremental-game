import type { Panel } from '../panels.js'

/**
 * Attack panel — empty placeholder for now. Gated behind a `panelUnlock`
 * upgrade targeting its id (`'attack'`); see `getModeUI`.
 */
export const attackPanel: Panel = {
  id: 'attack',
  label: 'Attack',
  icon: '⚔️',

  render(container) {
    container.innerHTML = `
      <div class="panel-placeholder">
        <span class="placeholder-icon">⚔️</span>
        <p>Coming soon!</p>
      </div>
    `
  },
}
