import type { Panel } from '../panels.js'

/**
 * International Relationship panel — empty placeholder for now. Gated behind a
 * `panelUnlock` upgrade targeting its id (`'international-relationship'`); see
 * `getModeUI`.
 */
export const internationalRelationshipPanel: Panel = {
  id: 'international-relationship',
  label: 'Relations',
  icon: '🤝',

  render(container) {
    container.innerHTML = `
      <div class="panel-placeholder">
        <span class="placeholder-icon">🤝</span>
        <p>Coming soon!</p>
      </div>
    `
  },
}
