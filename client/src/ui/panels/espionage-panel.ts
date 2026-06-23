import type { Panel } from '../panels.js'
import type { GameState } from '../../game.js'
import { formatNumber } from '../format-number.js'
import {
  getModeDefinition,
  getModeFlavor,
  getResourceIcon,
  getResourceName,
  hasEnemyDataAccess,
} from '@game/shared'

// ─── Helpers ─────────────────────────────────────────────────────────

/** Cache of last rendered HTML to avoid unnecessary DOM churn on update(). */
let prevHtml = ''

/** Locked teaser shown until the viewer owns an `accessEnemyData` upgrade. */
function renderLocked(): string {
  return `
    <div class="panel-placeholder">
      <span class="placeholder-icon">🕵️</span>
      <p>No intel yet — research espionage to reveal enemy data.</p>
    </div>
  `
}

/**
 * A read-only table of the opponent's resource stockpiles, limited to the
 * resource keys the viewer has unlocked via `accessEnemyData` (each espionage
 * upgrade reveals one resource — e.g. main/Wood, then secondary/Ale).
 */
function renderResources(state: Readonly<GameState>, resourceKeys: readonly string[]): string {
  const modeDef = getModeDefinition(state.mode!)
  const flavor = getModeFlavor(modeDef)
  const rows = resourceKeys
    .map((key) => {
      const amount = state.opponent.resources[key] ?? 0
      return `
        <tr>
          <td class="espionage-res-name">${getResourceIcon(flavor, key)} ${getResourceName(flavor, key)}</td>
          <td class="espionage-res-value">${formatNumber(amount)}</td>
        </tr>
      `
    })
    .join('')
  return `
    <section class="espionage-section">
      <h3 class="espionage-heading">Enemy Resources</h3>
      <table class="espionage-table">
        <tbody>${rows}</tbody>
      </table>
    </section>
  `
}

function renderEspionage(state: Readonly<GameState>): string {
  if (!state.mode) return ''
  const modeDef = getModeDefinition(state.mode)
  // Show the resources the viewer has unlocked, in the mode's declared order.
  const unlocked = modeDef.resources.filter((key) => hasEnemyDataAccess(state.player, modeDef, key))
  return unlocked.length > 0 ? renderResources(state, unlocked) : renderLocked()
}

// ─── Espionage Panel ─────────────────────────────────────────────────

/**
 * Espionage panel — surfaces opponent intel the viewer has unlocked via
 * `accessEnemyData` effects. The opponent's full state is already broadcast
 * each tick, so access here is a UI-level gate (`hasEnemyDataAccess`), not a
 * data fetch. Panel visibility itself is still gated by a `panelUnlock`
 * upgrade targeting `'espionage'`; see `getModeUI`.
 */
export const espionagePanel: Panel = {
  id: 'espionage',
  label: 'Espionage',
  icon: '🕵️',

  render(container, state) {
    const html = renderEspionage(state)
    prevHtml = html
    container.innerHTML = `<div class="espionage-list" id="espionage-list">${html}</div>`
  },

  update(state) {
    const html = renderEspionage(state)
    if (html === prevHtml) return
    prevHtml = html
    const list = document.getElementById('espionage-list')
    if (list) list.innerHTML = html
  },
}
