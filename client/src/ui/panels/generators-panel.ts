import type { Panel } from '../panels.js'
import type { GameState } from '../../game.js'
import { doBuyGenerator, doBuyGeneratorMax } from '../../game.js'
import { formatNumber } from '../format-number.js'
import {
  type GeneratorDefinition,
  type ModeFlavor,
  getModeDefinition,
  getModeFlavor,
  getGeneratorCost,
  getGeneratorBulkCost,
  getMaxAffordableGeneratorCount,
  canAffordGenerator,
  isGeneratorUnlocked,
  resolveGeneratorDef,
  getResourceIcon,
  getGeneratorName,
  getGeneratorIcon,
} from '@game/shared'

// ─── Helpers ─────────────────────────────────────────────────────────

/** Cache of last rendered HTML to avoid unnecessary DOM churn. */
let prevHtml = ''

/** Per-card display numbers, computed by the caller from game/preview state. */
export interface GeneratorCardNums {
  readonly owned: number
  readonly nextCost: number
  readonly affordable: boolean
  readonly maxAffordable: number
  readonly bulkCost: number
}

/**
 * Pure generator-card markup from a definition, a resolved flavor, and the
 * already-computed display numbers — no `GameState`, no mode registry lookup.
 * Shared by the in-game panel and the dev editor's generators preview (the
 * editor's working tree is never registered as a mode, so it can't go through
 * `getModeDefinition`).
 */
export function renderGeneratorCardView(
  def: GeneratorDefinition,
  flavor: ModeFlavor,
  nums: GeneratorCardNums,
): string {
  const { owned, nextCost, affordable, maxAffordable, bulkCost } = nums
  const totalRate = def.production.rate * owned
  const rateStr = totalRate % 1 === 0 ? String(totalRate) : totalRate.toFixed(1)
  const prodIcon = getResourceIcon(flavor, def.production.resource)
  const costIcon = getResourceIcon(flavor, def.costCurrency)
  return `
    <article class="generator-card${!affordable ? ' too-expensive' : ''}" data-generator="${def.id}">
      <div class="generator-summary">
        <span class="generator-icon">${getGeneratorIcon(flavor, def.id)}</span>
        <span class="generator-info">
          <span class="generator-name">${getGeneratorName(flavor, def.id)}</span>
          <span class="generator-rate">+${rateStr} ${prodIcon}/s</span>
        </span>
        <span class="generator-count">×${owned}</span>
      </div>
      <div class="generator-actions">
        <button class="generator-buy-btn" data-action="buy" ${!affordable ? 'disabled' : ''}>
          Buy 1 — ${costIcon}${formatNumber(nextCost)}
        </button>
        <button class="generator-buy-btn buy-max" data-action="buy-max" ${maxAffordable <= 1 ? 'disabled' : ''}>
          Buy ×${maxAffordable > 1 ? maxAffordable : 0} — ${costIcon}${maxAffordable > 1 ? formatNumber(bulkCost) : '—'}
        </button>
      </div>
    </article>
  `
}

function renderAllGenerators(state: Readonly<GameState>): string {
  if (!state.mode) return ''
  const modeDef = getModeDefinition(state.mode)
  if (modeDef.generators.length === 0) {
    return `
      <div class="panel-placeholder">
        <span class="placeholder-icon">🏭</span>
        <p>No generators in this mode</p>
      </div>
    `
  }
  const cards = modeDef.generators
    .filter((def) => isGeneratorUnlocked(state.player, def, modeDef))
    .map((def) => {
      const effectiveDef = resolveGeneratorDef(def, state.player, modeDef)
      const owned = state.player.generators[def.id] ?? 0
      const nextCost = getGeneratorCost(effectiveDef, owned)
      const affordable = canAffordGenerator(state.player, effectiveDef)
      const maxAffordable = getMaxAffordableGeneratorCount(state.player, effectiveDef)
      const bulkCost =
        maxAffordable > 0 ? getGeneratorBulkCost(effectiveDef, owned, maxAffordable) : 0
      return renderGeneratorCardView(def, getModeFlavor(modeDef), {
        owned,
        nextCost,
        affordable,
        maxAffordable,
        bulkCost,
      })
    })
    .join('')
  return cards
}

// ─── Generators Panel ────────────────────────────────────────────────

export const generatorsPanel: Panel = {
  id: 'generators',
  label: 'Generators',
  icon: '🏭',

  render(container, state) {
    prevHtml = ''
    const html = renderAllGenerators(state)
    prevHtml = html
    container.innerHTML = `<div class="generator-list" id="generator-list">${html}</div>`
  },

  bind() {
    const list = document.getElementById('generator-list')
    if (!list || list.dataset.delegated) return
    list.dataset.delegated = 'true'
    list.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.generator-buy-btn')
      if (!btn || btn.disabled) return
      const card = btn.closest<HTMLElement>('.generator-card')
      if (!card) return
      const gid = card.dataset.generator
      if (!gid) return

      if (btn.dataset.action === 'buy-max') {
        doBuyGeneratorMax(gid)
      } else {
        doBuyGenerator(gid)
      }
    })
  },

  update(state) {
    const html = renderAllGenerators(state)
    if (html === prevHtml) return
    prevHtml = html
    const list = document.getElementById('generator-list')
    if (list) list.innerHTML = html
  },
}
