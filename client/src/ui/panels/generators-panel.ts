import type { Panel } from '../panels.js'
import type { GameState } from '../../game.js'
import { doBuyGenerator, doBuyGeneratorMax } from '../../game.js'
import {
  type GeneratorDefinition,
  getModeDefinition,
  getGeneratorCost,
  getGeneratorBulkCost,
  getMaxAffordableGeneratorCount,
  canAffordGenerator,
  getResourceIcon,
  getGeneratorName,
  getGeneratorIcon,
} from '@game/shared'

// ─── Helpers ─────────────────────────────────────────────────────────

/** Cache of last rendered HTML to avoid unnecessary DOM churn. */
let prevHtml = ''

function renderGeneratorCard(
  def: GeneratorDefinition,
  owned: number,
  nextCost: number,
  affordable: boolean,
  maxAffordable: number,
  bulkCost: number,
  state: Readonly<GameState>,
): string {
  const modeDef = getModeDefinition(state.mode!)
  const flavor = modeDef.flavor
  const totalRate = def.production.rate * owned
  const rateStr = totalRate % 1 === 0 ? String(totalRate) : totalRate.toFixed(1)
  const prodIcon = getResourceIcon(flavor, def.production.resource)
  return `
    <article class="generator-card ${!affordable ? 'too-expensive' : ''}" data-generator="${def.id}">
      <div class="generator-summary">
        <span class="generator-icon">${getGeneratorIcon(flavor, def.id)}</span>
        <span class="generator-info">
          <span class="generator-name">${getGeneratorName(flavor, def.id)}</span>
          <span class="generator-rate">+${rateStr} ${prodIcon}/s</span>
        </span>
        <span class="generator-meta">
          <span class="generator-cost">${getResourceIcon(flavor, def.costCurrency)}${nextCost}</span>
          <span class="generator-count">×${owned}</span>
        </span>
      </div>
      <div class="generator-actions">
        <button
          class="generator-buy-button"
          data-action="buy"
          ${!affordable ? 'disabled' : ''}
        >
          Buy
        </button>
        <button
          class="generator-buy-max-button"
          data-action="buy-max"
          ${maxAffordable <= 0 ? 'disabled' : ''}
        >
          Buy Max${maxAffordable > 1 ? ` ×${maxAffordable}` : ''}
        </button>
      </div>
      ${maxAffordable > 0 ? `<div class="generator-buy-max-summary">Total ${getResourceIcon(flavor, def.costCurrency)}${bulkCost}</div>` : ''}
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
    .map((def) => {
      const owned = state.player.generators[def.id] ?? 0
      const nextCost = getGeneratorCost(def, owned)
      const affordable = canAffordGenerator(state.player, def)
      const maxAffordable = getMaxAffordableGeneratorCount(state.player, def)
      const bulkCost = maxAffordable > 0 ? getGeneratorBulkCost(def, owned, maxAffordable) : 0
      return renderGeneratorCard(def, owned, nextCost, affordable, maxAffordable, bulkCost, state)
    })
    .join('')
  return cards
}

// ─── Generators Panel ────────────────────────────────────────────────

export const generatorsPanel: Panel = {
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
      const target = e.target as HTMLElement
      const buyButton = target.closest<HTMLButtonElement>('.generator-buy-button')
      const buyMaxButton = target.closest<HTMLButtonElement>('.generator-buy-max-button')
      const card = target.closest<HTMLElement>('.generator-card')
      if (!card) return
      const gid = card.dataset.generator
      if (!gid) return

      if (buyButton && !buyButton.disabled) {
        doBuyGenerator(gid)
      } else if (buyMaxButton && !buyMaxButton.disabled) {
        doBuyGeneratorMax(gid)
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
