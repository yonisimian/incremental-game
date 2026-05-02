import type { Panel } from '../panels.js'
import type { GameState } from '../../game.js'
import { doBuyGenerator } from '../../game.js'
import {
  type GeneratorDefinition,
  getModeDefinition,
  getGeneratorCost,
  canAffordGenerator,
  getResourceIcon,
} from '@game/shared'

// ─── Helpers ─────────────────────────────────────────────────────────

/** Cache of last rendered HTML to avoid unnecessary DOM churn. */
let prevHtml = ''

function renderGeneratorCard(
  def: GeneratorDefinition,
  owned: number,
  nextCost: number,
  affordable: boolean,
): string {
  const totalRate = def.production.rate * owned
  const rateStr = totalRate % 1 === 0 ? String(totalRate) : totalRate.toFixed(1)
  const prodIcon = getResourceIcon(def.production.resource)
  return `
    <button
      class="generator-card ${!affordable ? 'too-expensive' : ''}"
      data-generator="${def.id}"
      ${!affordable ? 'disabled' : ''}
    >
      <span class="generator-icon">${def.icon}</span>
      <span class="generator-info">
        <span class="generator-name">${def.name}</span>
        <span class="generator-rate">+${rateStr} ${prodIcon}/s</span>
      </span>
      <span class="generator-meta">
        <span class="generator-cost">${getResourceIcon(def.costCurrency)}${nextCost}</span>
        <span class="generator-count">×${owned}</span>
      </span>
    </button>
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
      return renderGeneratorCard(def, owned, nextCost, affordable)
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
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.generator-card')
      if (!btn || btn.disabled) return
      const gid = btn.dataset.generator
      if (gid) doBuyGenerator(gid)
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
