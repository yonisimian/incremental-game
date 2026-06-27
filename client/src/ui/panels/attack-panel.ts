import type { Panel } from '../panels.js'
import type { GameState } from '../../game.js'
import {
  getAttackDescription,
  getAttackIcon,
  getAttackName,
  getModeDefinition,
  getModeFlavor,
  unlockedAttacks,
} from '@game/shared'
import type { ModeFlavor } from '@game/shared'

/** Cache of last rendered HTML to avoid unnecessary DOM churn on update(). */
let prevHtml = ''

/** Placeholder shown until the viewer unlocks an attack via an `unlockAttack` upgrade. */
function renderLocked(): string {
  return `
    <div class="panel-placeholder">
      <span class="placeholder-icon">⚔️</span>
      <p>No attacks unlocked yet — research the attack tree to unlock one.</p>
    </div>
  `
}

/**
 * One block of attacks (e.g. all active, or all passive), shown as cards with
 * their flavor (icon, name, description). Attacks have no behavior yet, so each
 * is a disabled, no-op button — unlocking one only makes it appear here.
 */
function renderSection(flavor: ModeFlavor, heading: string, attacks: readonly string[]): string {
  const items = attacks
    .map((id) => {
      const desc = getAttackDescription(flavor, id)
      return `
        <li class="attack-item">
          <button class="attack-btn" type="button" disabled>
            <span class="attack-icon">${getAttackIcon(flavor, id)}</span>
            <span class="attack-name">${getAttackName(flavor, id)}</span>
            ${desc ? `<span class="attack-desc">${desc}</span>` : ''}
          </button>
        </li>
      `
    })
    .join('')
  return `
    <section class="attack-section">
      <h3 class="attack-heading">${heading}</h3>
      <ul class="attack-list">${items}</ul>
    </section>
  `
}

function renderAttack(state: Readonly<GameState>): string {
  if (!state.mode) return ''
  const modeDef = getModeDefinition(state.mode)
  const unlocked = unlockedAttacks(state.player, modeDef)
  if (unlocked.length === 0) return renderLocked()

  // Split unlocked attacks into their kinds so each renders in its own block.
  const kindOf = new Map(modeDef.attacks.map((a) => [a.id, a.kind]))
  const active = unlocked.filter((id) => kindOf.get(id) === 'active')
  const passive = unlocked.filter((id) => kindOf.get(id) === 'passive')

  const flavor = getModeFlavor(modeDef)
  return `
    ${active.length > 0 ? renderSection(flavor, 'Active', active) : ''}
    ${passive.length > 0 ? renderSection(flavor, 'Passive', passive) : ''}
    <p class="attack-hint">Attacks don't do anything yet.</p>
  `
}

/**
 * Attack panel — lists attacks the viewer has unlocked via `unlockAttack`
 * effects. The panel tab itself is gated by a `panelUnlock` upgrade targeting
 * its id (`'attack'`); see `getModeUI`. Individual attacks are hidden until an
 * owning upgrade unlocks them (`isAttackUnlocked`).
 */
export const attackPanel: Panel = {
  id: 'attack',
  label: 'Attack',
  icon: '⚔️',

  render(container, state) {
    const html = renderAttack(state)
    prevHtml = html
    container.innerHTML = `<div class="attack-content" id="attack-content">${html}</div>`
  },

  update(state) {
    const html = renderAttack(state)
    if (html === prevHtml) return
    prevHtml = html
    const content = document.getElementById('attack-content')
    if (content) content.innerHTML = html
  },
}
