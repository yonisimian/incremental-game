import type { Panel } from '../panels.js'
import type { GameState } from '../../game.js'
import { roundStats } from '../../stats/round-stats.js'
import { formatMultiplier, formatNumber } from '../format-number.js'
import { setText } from '../helpers.js'
import {
  type ModeDefinition,
  type ModeFlavor,
  type ResourceRateBreakdown,
  batteryFactor,
  collectBatteryParams,
  collectModifiers,
  computeClickIncome,
  computeRateBreakdown,
  getHighlightMultiplier,
  isHighlightBatteryActive,
  readBatteryCharge,
  readHighlight,
  getModeDefinition,
  getModeFlavor,
  getGeneratorIcon,
  getGeneratorName,
  getResourceIcon,
  getResourceName,
} from '@game/shared'

// ─── Helpers ─────────────────────────────────────────────────────────

/** Format a per-second production rate (e.g. "+2/s", "+0.5/s", "-1/s"). */
function formatRate(rate: number): string {
  const decimals = Number.isInteger(rate) ? 0 : 1
  const sign = rate < 0 ? '-' : '+'
  return `${sign}${formatNumber(Math.abs(rate), decimals)}/s`
}

/** Format a rate without a leading sign (for breakdown sub-rows). */
function formatAmount(rate: number): string {
  return formatNumber(rate, Number.isInteger(rate) ? 0 : 1)
}

/**
 * A small quantity rendered faithfully (`0.25`, `9.5`, `20`).
 *
 * Every notation floors below 1000, so `formatNumber` turns a charge of 0.25 into
 * "0" and a drain of 0.73/s into "-0/s" — both actively misleading next to a
 * multiplier that is plainly still paying out. `formatMultiplier` is the existing
 * escape hatch from that flooring; the alias keeps the call sites honest about
 * what they're formatting.
 */
const formatQuantity = formatMultiplier

/** Percentage share of `part` out of `total` (0 when total is 0). */
function share(part: number, total: number): number {
  if (total <= 0) return 0
  return Math.max(0, Math.min(100, (part / total) * 100))
}

/** Generators that produce the given resource, in mode order. */
function generatorsFor(modeDef: ModeDefinition, resource: string) {
  return modeDef.generators.filter((g) => g.production.resource === resource)
}

// ─── Rendering ───────────────────────────────────────────────────────

/** One resource's production + source-breakdown block (stable IDs, filled by update()). */
function renderResourceBlock(
  modeDef: ModeDefinition,
  flavor: ModeFlavor,
  resource: string,
): string {
  const icon = getResourceIcon(flavor, resource)
  const name = getResourceName(flavor, resource)
  const gens = generatorsFor(modeDef, resource)
  const genRows = gens
    .map(
      (g) => `
        <div class="data-gen-row" id="data-gen-row-${resource}-${g.id}">
          <span class="data-gen-name">${getGeneratorIcon(flavor, g.id)} ${getGeneratorName(flavor, g.id)}</span>
          <span class="data-gen-rate" id="data-gen-rate-${resource}-${g.id}">—</span>
        </div>`,
    )
    .join('')

  return `
    <section class="data-resource" data-resource="${resource}">
      <div class="data-resource-head">
        <span class="data-resource-name">${icon} ${name}</span>
        <span class="data-resource-rate" id="data-total-rate-${resource}">—</span>
      </div>
      <div class="data-breakdown">
        <div class="data-bar" role="img" aria-label="Production sources for ${name}">
          <span class="data-bar-seg data-bar-base" id="data-bar-base-${resource}"></span>
          <span class="data-bar-seg data-bar-gen" id="data-bar-gen-${resource}"></span>
          <span class="data-bar-seg data-bar-upg" id="data-bar-upg-${resource}"></span>
        </div>
        <div class="data-source-row">
          <span class="data-source-label"><i class="data-swatch data-swatch-base"></i> Base</span>
          <span id="data-src-base-${resource}">—</span>
        </div>
        <div class="data-source-row">
          <span class="data-source-label"><i class="data-swatch data-swatch-gen"></i> Generators</span>
          <span id="data-src-gen-${resource}">—</span>
        </div>
        <div class="data-source-row">
          <span class="data-source-label"><i class="data-swatch data-swatch-upg"></i> Upgrades</span>
          <span id="data-src-upg-${resource}">—</span>
        </div>
        ${gens.length > 0 ? `<div class="data-gen-list">${genRows}</div>` : ''}
      </div>
    </section>
  `
}

/** Build the full panel skeleton once (numbers filled by update()). */
function renderSkeleton(modeDef: ModeDefinition, flavor: ModeFlavor, showScore: boolean): string {
  const production = modeDef.resources.map((r) => renderResourceBlock(modeDef, flavor, r)).join('')

  const inventoryRows = modeDef.resources
    .map(
      (r) => `
        <div class="data-stat">
          <span class="data-stat-label">${getResourceIcon(flavor, r)} ${getResourceName(flavor, r)}</span>
          <span class="data-stat-value" id="data-inv-${r}">—</span>
        </div>`,
    )
    .join('')

  const earnedByResource = modeDef.resources
    .map(
      (r) => `
          <div class="data-stat">
            <span class="data-stat-label">${getResourceIcon(flavor, r)} ${getResourceName(flavor, r)} clicked</span>
            <span class="data-stat-value" id="data-click-earned-${r}">—</span>
          </div>`,
    )
    .join('')

  const clicking = modeDef.clicksEnabled
    ? `
      <section class="data-section">
        <h3 class="data-section-title">🖱️ Clicking</h3>
        <div class="data-stat-grid">
          <div class="data-stat">
            <span class="data-stat-label">Per click</span>
            <span class="data-stat-value" id="data-click-income">—</span>
          </div>
          <div class="data-stat">
            <span class="data-stat-label">Peak CPS</span>
            <span class="data-stat-value" id="data-click-peak">—</span>
          </div>
          <div class="data-stat">
            <span class="data-stat-label">Average CPS</span>
            <span class="data-stat-value" id="data-click-avg">—</span>
          </div>
          <div class="data-stat">
            <span class="data-stat-label">Total clicks</span>
            <span class="data-stat-value" id="data-click-total">—</span>
          </div>
          <div class="data-stat">
            <span class="data-stat-label">Earned by clicking</span>
            <span class="data-stat-value" id="data-click-earned">—</span>
          </div>
          ${earnedByResource}
        </div>
      </section>`
    : ''

  const dwellRows = [
    ...modeDef.resources.map(
      (r) => `
          <div class="data-stat">
            <span class="data-stat-label">${getResourceIcon(flavor, r)} ${getResourceName(flavor, r)}</span>
            <span class="data-stat-value" id="data-hl-dwell-${r}">—</span>
          </div>`,
    ),
    // Released time closes the round out: the resource rows plus this one account
    // for the whole clock.
    `
          <div class="data-stat">
            <span class="data-stat-label">🚫 Released</span>
            <span class="data-stat-value" id="data-hl-released">—</span>
          </div>`,
  ].join('')

  // Battery rows live under Highlight rather than in a section of their own: it's
  // one mechanic, and the multiplier above already includes the battery's share.
  // The whole block is `hidden` until the lantern is bought — `update` unhides it,
  // since the skeleton is rendered once per round while the gate can flip mid-round.
  const battery = `
        <div id="data-battery" hidden>
          <p class="data-subhead">🪔 Lantern</p>
          <div class="data-stat-grid">
            <div class="data-stat">
              <span class="data-stat-label">Charge</span>
              <span class="data-stat-value" id="data-bat-charge">—</span>
            </div>
            <div class="data-stat">
              <span class="data-stat-label">Its multiplier</span>
              <span class="data-stat-value" id="data-bat-factor">—</span>
            </div>
            <div class="data-stat">
              <span class="data-stat-label">Net</span>
              <span class="data-stat-value" id="data-bat-net">—</span>
            </div>
            <div class="data-stat">
              <span class="data-stat-label" id="data-bat-eta-label">Runs dry in</span>
              <span class="data-stat-value" id="data-bat-eta">—</span>
            </div>
          </div>
        </div>`

  const highlight = modeDef.highlightEnabled
    ? `
      <section class="data-section">
        <h3 class="data-section-title">✨ Highlight</h3>
        <div class="data-stat-grid">
          <div class="data-stat">
            <span class="data-stat-label">Current</span>
            <span class="data-stat-value" id="data-hl-current">—</span>
          </div>
          <div class="data-stat">
            <span class="data-stat-label">Multiplier</span>
            <span class="data-stat-value" id="data-hl-mult">—</span>
          </div>
        </div>
        ${battery}
        <p class="data-subhead">Time highlighted</p>
        <div class="data-stat-grid">${dwellRows}</div>
      </section>`
    : ''

  return `
    <div class="data-panel">
      <section class="data-section">
        <h3 class="data-section-title">⚙️ Production</h3>
        ${production}
      </section>
      ${clicking}
      ${highlight}
      <section class="data-section">
        <h3 class="data-section-title">📦 Inventory</h3>
        <div class="data-stat-grid">
          ${inventoryRows}
          ${
            showScore
              ? `<div class="data-stat">
            <span class="data-stat-label">🏆 Score</span>
            <span class="data-stat-value" id="data-inv-score">—</span>
          </div>`
              : ''
          }
          <div class="data-stat">
            <span class="data-stat-label">🏭 Generators</span>
            <span class="data-stat-value" id="data-inv-generators">—</span>
          </div>
          <div class="data-stat">
            <span class="data-stat-label">⬆️ Upgrades</span>
            <span class="data-stat-value" id="data-inv-upgrades">—</span>
          </div>
        </div>
      </section>
    </div>
  `
}

/** Push live numbers into the skeleton via setText / style updates. */
function updateNumbers(state: Readonly<GameState>): void {
  if (!state.mode) return
  const modeDef = getModeDefinition(state.mode)

  // Production + source breakdown (debuffs folded in so totals match the header).
  const breakdown = computeRateBreakdown(state.player, modeDef, state.debuffs)
  for (const r of modeDef.resources) {
    const bd: ResourceRateBreakdown = breakdown[r]
    setText(`data-total-rate-${r}`, formatRate(bd.total))
    setText(`data-src-base-${r}`, formatAmount(bd.base))
    setText(`data-src-gen-${r}`, formatAmount(bd.generators))
    setText(`data-src-upg-${r}`, formatAmount(bd.upgrades))

    const total = bd.base + bd.generators + bd.upgrades
    setBarWidth(`data-bar-base-${r}`, share(bd.base, total))
    setBarWidth(`data-bar-gen-${r}`, share(bd.generators, total))
    setBarWidth(`data-bar-upg-${r}`, share(bd.upgrades, total))

    for (const g of generatorsFor(modeDef, r)) {
      const rate = bd.byGenerator[g.id] ?? 0
      const owned = state.player.generators[g.id] ?? 0
      const row = document.getElementById(`data-gen-row-${r}-${g.id}`)
      if (row) row.style.display = owned > 0 ? '' : 'none'
      setText(`data-gen-rate-${r}-${g.id}`, `${formatRate(rate)} ×${owned}`)
    }
  }

  // Clicking (per-click income excludes debuffs, matching the credit applied on click).
  if (modeDef.clicksEnabled) {
    const clickIncome = computeClickIncome(collectModifiers(state.player, modeDef))
    setText('data-click-income', formatNumber(clickIncome, Number.isInteger(clickIncome) ? 0 : 1))
    setText('data-click-peak', formatNumber(roundStats.peakCps, 1))
    setText('data-click-avg', formatNumber(roundStats.averageCps(state.player), 1))
    setText('data-click-total', formatNumber(roundStats.totalClicks))
    setText('data-click-earned', formatNumber(roundStats.totalIncome))
    for (const r of modeDef.resources) {
      setText(`data-click-earned-${r}`, formatNumber(roundStats.incomeByResource[r] ?? 0))
    }
  }

  // Highlight
  if (modeDef.highlightEnabled) {
    const flavor = getModeFlavor(modeDef)
    const current = readHighlight(state.player)
    setText(
      'data-hl-current',
      current === null
        ? 'Released'
        : `${getResourceIcon(flavor, current)} ${getResourceName(flavor, current)}`,
    )
    const mult = getHighlightMultiplier(state.player, modeDef)
    setText('data-hl-mult', `×${formatMultiplier(mult)}`)
    updateBattery(state, modeDef)
    for (const r of modeDef.resources) {
      setText(`data-hl-dwell-${r}`, `${formatNumber(roundStats.dwellByResource[r] ?? 0, 1)}s`)
    }
    setText('data-hl-released', `${formatNumber(roundStats.releasedSec, 1)}s`)
  }

  // Inventory
  for (const r of modeDef.resources) {
    setText(`data-inv-${r}`, formatNumber(state.player.resources[r] ?? 0))
  }
  setText('data-inv-score', formatNumber(state.player.score))
  setText('data-inv-generators', formatNumber(sumCounts(state.player.generators)))
  setText('data-inv-upgrades', formatNumber(sumCounts(state.player.upgrades)))
}

/**
 * Fill the lantern rows, or hide the block while the lantern is locked (the
 * skeleton is rendered once per round, but the gate can flip mid-round).
 *
 * Reads the authoritative charge rather than the play panel's animated
 * prediction: this is the diagnostics panel, so it should agree with the server
 * even if that means stepping once per snapshot.
 */
function updateBattery(state: Readonly<GameState>, modeDef: ModeDefinition): void {
  const block = document.getElementById('data-battery')
  if (!block) return
  const charge = readBatteryCharge(state.player)
  const active = charge !== null && isHighlightBatteryActive(state.player, modeDef)
  block.hidden = !active
  if (charge === null || !active) return

  const params = collectBatteryParams(state.player, modeDef)
  const held = readHighlight(state.player) !== null
  setText('data-bat-charge', `${formatQuantity(charge)} / ${formatQuantity(params.maxCharge)}`)
  // The battery's own share, not the combined highlight multiplier above.
  setText('data-bat-factor', `×${formatMultiplier(batteryFactor(state.player, modeDef))}`)
  const net = held ? -params.drainRate : params.chargeRate
  setText('data-bat-net', `${net < 0 ? '-' : '+'}${formatQuantity(Math.abs(net))}/s`)

  // Which direction it's heading is the number a player plans against.
  const rate = held ? params.drainRate : params.chargeRate
  const remaining = held ? charge : params.maxCharge - charge
  setText('data-bat-eta-label', held ? 'Runs dry in' : 'Full in')
  setText(
    'data-bat-eta',
    rate <= 0 || remaining <= 0 ? '—' : `${formatNumber(Math.ceil(remaining / rate))}s`,
  )
}

/** Set a breakdown-bar segment's width as a percentage. */
function setBarWidth(id: string, pct: number): void {
  const el = document.getElementById(id)
  if (el) el.style.width = `${pct}%`
}

/** Sum the values of a count map (generators owned, upgrades owned). */
function sumCounts(counts: Readonly<Record<string, number>>): number {
  let total = 0
  for (const n of Object.values(counts)) total += n
  return total
}

// ─── Panel ───────────────────────────────────────────────────────────

export const dataPanel: Panel = {
  id: 'data',
  label: 'Data',
  icon: '📊',

  render(container, state) {
    if (!state.mode) {
      container.innerHTML = ''
      return
    }
    const modeDef = getModeDefinition(state.mode)
    // Race-to-buy hides scores entirely (the opponent's is never revealed), so
    // the score stat is meaningless there — omit it.
    const showScore = state.goal?.type !== 'buy-upgrade'
    container.innerHTML = renderSkeleton(modeDef, getModeFlavor(modeDef), showScore)
    updateNumbers(state)
  },

  update(state) {
    updateNumbers(state)
  },
}
