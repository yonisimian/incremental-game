import type { Panel } from '../panels.js'
import type { GameState } from '../../game.js'
import {
  getModeDefinition,
  getModeFlavor,
  getPactDescription,
  getPactIcon,
  getPactName,
  unlockedPacts,
} from '@game/shared'
import type { ModeFlavor } from '@game/shared'

/** Cache of last rendered HTML to avoid unnecessary DOM churn on update(). */
let prevHtml = ''

/** Placeholder shown until the viewer unlocks a pact via an `unlockPact` upgrade. */
function renderLocked(): string {
  return `
    <div class="panel-placeholder">
      <span class="placeholder-icon">🤝</span>
      <p>No pacts unlocked yet — research the relations tree to unlock one.</p>
    </div>
  `
}

/**
 * One block of pacts (e.g. all active, or all passive), shown as cards with
 * their flavor (icon, name, description). Pacts have no behavior yet, so each is
 * a disabled, no-op button — unlocking one only makes it appear here.
 */
function renderSection(flavor: ModeFlavor, heading: string, pacts: readonly string[]): string {
  const items = pacts
    .map((id) => {
      const desc = getPactDescription(flavor, id)
      return `
        <li class="pact-item">
          <button class="pact-btn" type="button" disabled>
            <span class="pact-icon">${getPactIcon(flavor, id)}</span>
            <span class="pact-name">${getPactName(flavor, id)}</span>
            ${desc ? `<span class="pact-desc">${desc}</span>` : ''}
          </button>
        </li>
      `
    })
    .join('')
  return `
    <section class="pact-section">
      <h3 class="pact-heading">${heading}</h3>
      <ul class="pact-list">${items}</ul>
    </section>
  `
}

function renderRelations(state: Readonly<GameState>): string {
  if (!state.mode) return ''
  const modeDef = getModeDefinition(state.mode)
  const unlocked = unlockedPacts(state.player, modeDef)
  if (unlocked.length === 0) return renderLocked()

  // Split unlocked pacts into their kinds so each renders in its own block.
  const kindOf = new Map(modeDef.pacts.map((p) => [p.id, p.kind]))
  const active = unlocked.filter((id) => kindOf.get(id) === 'active')
  const passive = unlocked.filter((id) => kindOf.get(id) === 'passive')

  const flavor = getModeFlavor(modeDef)
  return `
    ${active.length > 0 ? renderSection(flavor, 'Active', active) : ''}
    ${passive.length > 0 ? renderSection(flavor, 'Passive', passive) : ''}
    <p class="pact-hint">Pacts don't do anything yet.</p>
  `
}

/**
 * International Relationship panel — lists pacts the viewer has unlocked via
 * `unlockPact` effects. The panel tab itself is gated by a `panelUnlock` upgrade
 * targeting its id (`'international-relationship'`); see `getModeUI`. Individual
 * pacts are hidden until an owning upgrade unlocks them (`isPactUnlocked`).
 */
export const internationalRelationshipPanel: Panel = {
  id: 'international-relationship',
  label: 'Relations',
  icon: '🤝',

  render(container, state) {
    const html = renderRelations(state)
    prevHtml = html
    container.innerHTML = `<div class="pact-content" id="pact-content">${html}</div>`
  },

  update(state) {
    const html = renderRelations(state)
    if (html === prevHtml) return
    prevHtml = html
    const content = document.getElementById('pact-content')
    if (content) content.innerHTML = html
  },
}
