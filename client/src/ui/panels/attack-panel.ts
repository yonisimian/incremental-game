import type { Panel } from '../panels.js'
import type { GameState } from '../../game.js'
import { getModeDefinition, unlockedAttacks } from '@game/shared'

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
 * A list of the attacks the viewer has unlocked. Attacks have no behavior yet,
 * so each is a disabled, no-op entry — unlocking one only makes it appear here.
 */
function renderAttacks(attacks: readonly string[]): string {
  const items = attacks
    .map(
      (id) => `
        <li class="attack-item">
          <button class="attack-btn" type="button" disabled>${id}</button>
        </li>
      `,
    )
    .join('')
  return `
    <section class="attack-section">
      <h3 class="attack-heading">Attacks</h3>
      <ul class="attack-list">${items}</ul>
      <p class="attack-hint">Attacks don't do anything yet.</p>
    </section>
  `
}

function renderAttack(state: Readonly<GameState>): string {
  if (!state.mode) return ''
  const attacks = unlockedAttacks(state.player, getModeDefinition(state.mode))
  return attacks.length === 0 ? renderLocked() : renderAttacks(attacks)
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
