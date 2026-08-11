import type { Panel } from '../panels.js'
import type { GameState } from '../../game.js'
import { roundStats } from '../../stats/round-stats.js'
import { formatNumber } from '../format-number.js'
import { setText } from '../helpers.js'
import {
  type ModeDefinition,
  type ModeFlavor,
  type ResourceRateBreakdown,
  collectModifiers,
  computeClickIncome,
  computeRateBreakdown,
  getHighlightMultiplier,
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
        </div>
        <div class="data-source-row">
          <span class="data-source-label"><i class="data-swatch data-swatch-base"></i> Base</span>
          <span id="data-src-base-${resource}">—</span>
        </div>
        <div class="data-source-row">
          <span class="data-source-label"><i class="data-swatch data-swatch-gen"></i> Generators</span>
          <span id="data-src-gen-${resource}">—</span>
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

  const dwellRows = modeDef.resources
    .map(
      (r) => `
          <div class="data-stat">
            <span class="data-stat-label">${getResourceIcon(flavor, r)} ${getResourceName(flavor, r)}</span>
            <span class="data-stat-value" id="data-hl-dwell-${r}">—</span>
          </div>`,
    )
    .join('')

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

    const total = bd.base + bd.generators
    setBarWidth(`data-bar-base-${r}`, share(bd.base, total))
    setBarWidth(`data-bar-gen-${r}`, share(bd.generators, total))

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
    const current = (state.player.meta.highlight as string | undefined) ?? modeDef.scoreResource
    setText(
      'data-hl-current',
      `${getResourceIcon(flavor, current)} ${getResourceName(flavor, current)}`,
    )
    const mult = getHighlightMultiplier(state.player, modeDef)
    setText('data-hl-mult', `×${formatNumber(mult, Number.isInteger(mult) ? 0 : 2)}`)
    for (const r of modeDef.resources) {
      setText(`data-hl-dwell-${r}`, `${formatNumber(roundStats.dwellByResource[r] ?? 0, 1)}s`)
    }
  }

  // Inventory
  for (const r of modeDef.resources) {
    setText(`data-inv-${r}`, formatNumber(state.player.resources[r] ?? 0))
  }
  setText('data-inv-score', formatNumber(state.player.score))
  setText('data-inv-generators', formatNumber(sumCounts(state.player.generators)))
  setText('data-inv-upgrades', formatNumber(sumCounts(state.player.upgrades)))
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
