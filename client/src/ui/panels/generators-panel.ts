import type { Panel } from '../panels.js'
import type { GameState } from '../../game.js'
import { doBuyGenerator, doBuyGeneratorMax, doSellGenerator } from '../../game.js'
import { formatNumber } from '../format-number.js'
import {
  type GeneratorDefinition,
  type ModeFlavor,
  getModeDefinition,
  getModeFlavor,
  generatorCostCurrency,
  getGeneratorCost,
  getGeneratorBulkCost,
  getGeneratorSellRefund,
  getMaxAffordableGeneratorCount,
  canAffordGenerator,
  canSellGenerator,
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
  readonly sellRefund: number
  readonly canSell: boolean
  /**
   * The card is shown for a generator this player hasn't unlocked — only
   * possible when copies were stolen from an opponent who had. Buying is barred
   * until the unlocking upgrade is owned, so the buy buttons say so instead of
   * quoting a price that can't be paid. Defaults to unlocked.
   */
  readonly locked?: boolean
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
  const { owned, nextCost, affordable, maxAffordable, bulkCost, sellRefund, canSell } = nums
  const locked = nums.locked === true
  const totalRate = def.production.rate * owned
  const rateStr = totalRate % 1 === 0 ? String(totalRate) : totalRate.toFixed(1)
  const prodIcon = getResourceIcon(flavor, def.production.resource)
  const costIcon = getResourceIcon(flavor, generatorCostCurrency(def))
  const inert = !affordable && !canSell // Dim when we can't buy and can't sell the card.
  return `
    <article class="generator-card${inert ? ' too-expensive' : ''}" data-generator="${def.id}">
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
          ${locked ? '🔒 Locked' : `Buy 1 — ${costIcon}${formatNumber(nextCost)}`}
        </button>
        <button class="generator-buy-btn buy-max" data-action="buy-max" ${maxAffordable <= 1 ? 'disabled' : ''}>
          ${
            locked
              ? '🔒 Locked'
              : `Buy ×${maxAffordable > 1 ? maxAffordable : 0} — ${costIcon}${maxAffordable > 1 ? formatNumber(bulkCost) : '—'}`
          }
        </button>
      </div>
      <div class="generator-actions">
        <button class="generator-buy-btn generator-sell-btn" data-action="sell" ${!canSell ? 'disabled' : ''}>
          Sell 1 — +${costIcon}${formatNumber(sellRefund)}
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
  // A generator shows once it's unlocked *or* once copies are held: an attack
  // can hand over copies of a generator this player never unlocked, and those
  // produce (`collectModifiers` reads owned counts, not gates), so hiding the
  // card would hide live income. Buying more still needs the unlock — hence the
  // per-card `unlocked` gate on the buy buttons below.
  const cards = modeDef.generators
    .filter(
      (def) =>
        isGeneratorUnlocked(state.player, def, modeDef) ||
        (state.player.generators[def.id] ?? 0) > 0,
    )
    .map((def) => {
      const effectiveDef = resolveGeneratorDef(def, state.player, modeDef)
      const owned = state.player.generators[def.id] ?? 0
      const unlocked = isGeneratorUnlocked(state.player, def, modeDef)
      const nextCost = getGeneratorCost(effectiveDef, owned)
      const affordable = unlocked && canAffordGenerator(state.player, effectiveDef)
      const maxAffordable = unlocked
        ? getMaxAffordableGeneratorCount(state.player, effectiveDef)
        : 0
      const bulkCost =
        maxAffordable > 0 ? getGeneratorBulkCost(effectiveDef, owned, maxAffordable) : 0
      const sellRefund = getGeneratorSellRefund(effectiveDef, owned)
      const canSell = canSellGenerator(state.player, effectiveDef)
      return renderGeneratorCardView(def, getModeFlavor(modeDef), {
        owned,
        nextCost,
        affordable,
        maxAffordable,
        bulkCost,
        sellRefund,
        canSell,
        locked: !unlocked,
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
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]')
      if (!btn || btn.disabled) return
      const card = btn.closest<HTMLElement>('.generator-card')
      if (!card) return
      const gid = card.dataset.generator
      if (!gid) return

      switch (btn.dataset.action) {
        case 'buy-max':
          doBuyGeneratorMax(gid)
          break
        case 'sell':
          doSellGenerator(gid)
          break
        default:
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
