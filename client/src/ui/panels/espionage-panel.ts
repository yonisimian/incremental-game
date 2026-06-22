import type { Panel } from '../panels.js'

/**
 * Espionage panel — empty placeholder for now. Gated behind a `panelUnlock`
 * upgrade targeting its id (`'espionage'`); see `getModeUI`.
 */
export const espionagePanel: Panel = {
  id: 'espionage',
  label: 'Espionage',
  icon: '🕵️',

  render(container) {
    container.innerHTML = `
      <div class="panel-placeholder">
        <span class="placeholder-icon">🕵️</span>
        <p>Coming soon!</p>
      </div>
    `
  },
}
