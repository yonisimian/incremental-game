import type { Panel } from '../panels.js'
import type { GameState } from '../../game.js'
import { formatNumber } from '../format-number.js'
import { formatTime } from '../helpers.js'
import { purchaseLockRemainingSec } from '@game/shared'
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
  highlightDebuffFactor,
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
 * A factor as a whole-or-one-decimal percentage change.
 *
 * Rounds to a tenth *before* formatting: `(1 - 0.9) * 100` is 9.999…, which
 * truncates to a wrong-looking "9%". A tenth still reads exactly for a
 * compounded pair (×0.9 × ×0.95 → 14.5%).
 */
function formatPercentChange(factor: number): string {
  const delta = Math.round(Math.abs(factor - 1) * 1000) / 10
  return formatNumber(delta, Number.isInteger(delta) ? 0 : 1)
}

/**
 * One line per cost inflation the opponent's passive attacks inflict, naming
 * what got dearer and by how much. A whole-scope entry reads as "your upgrades";
 * a single-entity one uses its flavor name, so the line matches the card the
 * player sees the price on.
 */
function describeCostInflation(state: Readonly<GameState>, flavor: ModeFlavor): string[] {
  const lines: string[] = []
  for (const entry of state.player.incomingCostFactors ?? []) {
    const what =
      entry.id === undefined
        ? entry.scope === 'upgrade'
          ? 'upgrades'
          : 'generators'
        : entry.scope === 'upgrade'
          ? `${getUpgradeIcon(flavor, entry.id)} ${getUpgradeName(flavor, entry.id)}`
          : `${getGeneratorIcon(flavor, entry.id)} ${getGeneratorName(flavor, entry.id)}`
    // Base-price and growth inflation are separate sentences: they compound
    // differently over a run, so summing them into one percentage would lie.
    if (entry.costFactor !== undefined && entry.costFactor !== 1)
      lines.push(`💸 Your ${what} cost ${formatPercentChange(entry.costFactor)}% more.`)
    if (entry.scalingFactor !== undefined && entry.scalingFactor !== 1)
      lines.push(
        `📈 Your ${what} price growth is ${formatPercentChange(entry.scalingFactor)}% steeper.`,
      )
  }
  return lines
}

/**
 * One line for an enemy purchase lock in force (plan 40), naming what is
 * embargoed and for how much longer. Both scopes locked with the same expiry
 * collapse into one sentence; different expiries get one line each, since the
 * countdowns differ.
 */
function describePurchaseLocks(state: Readonly<GameState>): string[] {
  const upgrades = purchaseLockRemainingSec(state.player, 'upgrade')
  const generators = purchaseLockRemainingSec(state.player, 'generator')
  const span = (sec: number) => `${sec.toFixed(1)}s`
  if (upgrades !== null && generators !== null && upgrades === generators)
    return [`🔒 You cannot buy upgrades or generators for ${span(upgrades)}.`]
  const lines: string[] = []
  if (upgrades !== null) lines.push(`🔒 You cannot buy upgrades for ${span(upgrades)}.`)
  if (generators !== null) lines.push(`🔒 You cannot buy generators for ${span(generators)}.`)
  return lines
}

/**
 * Standing warning about the passive attacks the opponent holds against this
 * player — a weakened highlight factor, inflated prices, or both.
 *
 * Deliberately **ungated and always shown** while an attack is in force, unlike
 * every other section here: the rest of this panel is intel you research, but
 * this is something being done *to* you, and a player who can't see it has no way
 * to explain why their highlight underperforms the number on its own upgrades, or
 * why a card costs more than the tree says. The highlight line also shows while
 * the highlight is released — that's when the warning matters most, since
 * releasing is what dodges the debuff.
 */
function renderIncomingDebuffs(state: Readonly<GameState>, flavor: ModeFlavor): string {
  const factor = highlightDebuffFactor(state.debuffs)
  // Percentage only, no `(×N)` alongside it: `formatMultiplier` rounds to two
  // decimals, so a compounded ×0.855 would print as "14.5% (×0.85)" and read as
  // self-contradictory. The exact factor has its own row under Highlight.
  const lines =
    factor === 1
      ? []
      : [
          `⚔️ Your ✨ highlight factor is reduced by ${formatPercentChange(factor)}% while the enemy holds this attack.`,
        ]
  lines.push(...describeCostInflation(state, flavor))
  lines.push(...describePurchaseLocks(state))
  if (lines.length === 0) return ''
  const body = lines.map((line) => `<p class="espionage-warning">${line}</p>`).join('')
  return `
    <section class="espionage-section">
      <h3 class="espionage-heading">Enemy Attacks</h3>
      ${body}
    </section>
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
  // Stockpiles and per-second rates are projected by the server into the
  // redacted opponent view — only the keys this viewer has unlocked are present
  // (the opponent's full state is never sent), so we read them directly.
  const flavor = getModeFlavor(modeDef)
  // Incoming attacks are not intel — they're reported whether or not any
  // espionage is researched, so they lead, and they survive the locked state.
  const incoming = renderIncomingDebuffs(state, flavor)
  if (rows.length === 0 && !cps && !purchases) return `${incoming}${renderLocked()}`
  const resources =
    rows.length > 0 ? renderResources(state, flavor, rows, state.opponent.rates) : ''
  return `${incoming}${resources}${cps ? renderActivity(state) : ''}${purchases ? renderPurchases(state, flavor) : ''}`
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
