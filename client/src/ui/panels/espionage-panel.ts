import type { Panel } from '../panels.js'
import type { GameState } from '../../game.js'
import { formatNumber } from '../format-number.js'
import { formatTime } from '../helpers.js'
import {
  enemyDataKeysFor,
  ENEMY_DATA_CPS_KEY,
  ENEMY_DATA_PURCHASES_KEY,
  getModeDefinition,
  getModeFlavor,
  getGeneratorIcon,
  getGeneratorName,
  getResourceIcon,
  getResourceName,
  getUpgradeIcon,
  getUpgradeName,
  hasEnemyDataAccess,
} from '@game/shared'
import type { ModeFlavor, PurchaseEvent } from '@game/shared'

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

/**
 * Peak clicks-per-second, unlocked via `accessEnemyData: peakCps`. The label is
 * hardcoded (not flavor-derived) because CPS is a real, flavor-independent
 * metric — unlike resources, it carries no themed name/icon.
 */
function renderActivity(state: Readonly<GameState>): string {
  return `
    <section class="espionage-section">
      <h3 class="espionage-heading">Enemy Activity</h3>
      <table class="espionage-table">
        <tbody>
          <tr>
            <td class="espionage-res-name">🖱️ Max CPS</td>
            <td class="espionage-res-value">${formatNumber(state.opponent.peakCps ?? 0)}</td>
          </tr>
        </tbody>
      </table>
    </section>
  `
}

/**
 * The feed row's text for one purchase, gated by how much intel the viewer has
 * unlocked. The server only sends the fields each tier permits, so we render the
 * most specific form the event carries:
 * - `id` present → the named item (resolved to icon/name via the flavor), from
 *   `purchaseUpgradeId` / `purchaseGeneratorId`.
 * - `kind` only → "an upgrade" / "a generator", from `purchaseKind`.
 * - neither → generic "made a purchase", the base `purchases` tier.
 */
function purchaseLabel(p: PurchaseEvent, flavor: ModeFlavor): string {
  if (p.kind && p.id) {
    const [icon, name] =
      p.kind === 'upgrade'
        ? [getUpgradeIcon(flavor, p.id), getUpgradeName(flavor, p.id)]
        : [getGeneratorIcon(flavor, p.id), getGeneratorName(flavor, p.id)]
    return `🛒 Enemy bought ${icon} ${name}`
  }
  if (p.kind) return `🛒 Enemy bought ${p.kind === 'upgrade' ? 'an upgrade' : 'a generator'}`
  return `🛒 Enemy made a purchase`
}

/**
 * Feed of the opponent's recent purchases, unlocked via `accessEnemyData:
 * purchases` (base). Each row is stamped with the round time, newest first. How
 * much each row says depends on the deeper intel tiers the viewer has unlocked
 * (kind, then the specific upgrade/generator) — see {@link purchaseLabel}.
 */
function renderPurchases(state: Readonly<GameState>, flavor: ModeFlavor): string {
  const purchases = state.opponentPurchaseFeed
  const body =
    purchases.length === 0
      ? `<p class="espionage-feed-empty">No purchases observed yet.</p>`
      : purchases
          .slice()
          .reverse()
          .map(
            (p) => `
              <li class="espionage-feed-item">
                <span class="espionage-feed-time">${formatTime(p.t)}</span>
                <span class="espionage-feed-text">${purchaseLabel(p, flavor)}</span>
              </li>
            `,
          )
          .join('')
  return `
    <section class="espionage-section">
      <h3 class="espionage-heading">Recent Purchases</h3>
      <ul class="espionage-feed">${body}</ul>
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
  const cps = hasEnemyDataAccess(state.player, modeDef, ENEMY_DATA_CPS_KEY)
  const purchases = hasEnemyDataAccess(state.player, modeDef, ENEMY_DATA_PURCHASES_KEY)
  if (rows.length === 0 && !cps && !purchases) return renderLocked()
  // Stockpiles and per-second rates are projected by the server into the
  // redacted opponent view — only the keys this viewer has unlocked are present
  // (the opponent's full state is never sent), so we read them directly.
  const flavor = getModeFlavor(modeDef)
  const resources =
    rows.length > 0 ? renderResources(state, flavor, rows, state.opponent.rates) : ''
  return `${resources}${cps ? renderActivity(state) : ''}${purchases ? renderPurchases(state, flavor) : ''}`
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
