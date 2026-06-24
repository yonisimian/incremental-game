import type { Panel } from '../panels.js'
import type { GameState } from '../../game.js'
import { formatNumber } from '../format-number.js'
import {
  collectModifiers,
  computePassiveRates,
  enemyDataKeysFor,
  getModeDefinition,
  getModeFlavor,
  getResourceIcon,
  getResourceName,
  hasEnemyDataAccess,
} from '@game/shared'
import type { ModeFlavor } from '@game/shared'

// ─── Helpers ─────────────────────────────────────────────────────────

/** Cache of last rendered HTML to avoid unnecessary DOM churn on update(). */
let prevHtml = ''

/** Masks a cell whose specific intel the viewer hasn't unlocked yet. */
const LOCKED_CELL = '🔒'

/** One resource row's unlock state: which of its metrics the viewer can see. */
interface ResourceIntel {
  readonly key: string
  /** Stockpile unlocked via `accessEnemyData: <key>`. */
  readonly amount: boolean
  /** Per-second rate unlocked via `accessEnemyData: <key>:rate`. */
  readonly rate: boolean
}

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
 * A table of the opponent's resources — current stockpile and per-second
 * production — limited to the metrics the viewer has unlocked via
 * `accessEnemyData`. Each cell is masked until its specific grant is owned, so
 * the table fills in as espionage is researched (main/Wood, secondary/Ale, then
 * their per-sec rates).
 */
function renderResources(
  state: Readonly<GameState>,
  flavor: ModeFlavor,
  rows: readonly ResourceIntel[],
  rates: Record<string, number>,
): string {
  const body = rows
    .map(({ key, amount, rate }) => {
      const amountCell = amount ? formatNumber(state.opponent.resources[key] ?? 0) : LOCKED_CELL
      const rateCell = rate ? `${formatNumber(rates[key] ?? 0, 1)}/s` : LOCKED_CELL
      return `
        <tr>
          <td class="espionage-res-name">${getResourceIcon(flavor, key)} ${getResourceName(flavor, key)}</td>
          <td class="espionage-res-value">${amountCell}</td>
          <td class="espionage-res-value">${rateCell}</td>
        </tr>
      `
    })
    .join('')
  return `
    <section class="espionage-section">
      <h3 class="espionage-heading">Enemy Resources</h3>
      <table class="espionage-table">
        <thead>
          <tr>
            <th class="espionage-res-name">Resource</th>
            <th class="espionage-res-value">Amount</th>
            <th class="espionage-res-value">Per sec</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </section>
  `
}

function renderEspionage(state: Readonly<GameState>): string {
  if (!state.mode) return ''
  const modeDef = getModeDefinition(state.mode)
  // In the mode's declared order, keep resources the viewer has any intel on.
  const rows: ResourceIntel[] = modeDef.resources
    .map((key) => {
      const [amountKey, rateKey] = enemyDataKeysFor(key)
      return {
        key,
        amount: hasEnemyDataAccess(state.player, modeDef, amountKey),
        rate: hasEnemyDataAccess(state.player, modeDef, rateKey),
      }
    })
    .filter((r) => r.amount || r.rate)
  if (rows.length === 0) return renderLocked()
  // Production is derived from the opponent's own state, broadcast each tick —
  // the same pipeline the local player uses (no extra data needed). Only needed
  // when a per-second metric is actually unlocked.
  const rates = rows.some((r) => r.rate)
    ? computePassiveRates(collectModifiers(state.opponent, modeDef), modeDef.resources)
    : {}
  return renderResources(state, getModeFlavor(modeDef), rows, rates)
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
