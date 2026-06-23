import type { Panel } from '../panels.js'
import type { GameState } from '../../game.js'
import { doClick, setHighlight, getClickTarget } from '../../game.js'
import { setText } from '../helpers.js'
import { formatNumber } from '../format-number.js'
import {
  getModeDefinition,
  getModeFlavor,
  getResourceIcon,
  getResourceName,
  isClickUnlocked,
  isHighlightActive,
} from '@game/shared'
import type { ModeDefinition } from '@game/shared'

// ─── Helpers ─────────────────────────────────────────────────────────

function getHighlight(state: Readonly<GameState>): string {
  const modeDef = getModeDefinition(state.mode!)
  return (state.player.meta.highlight as string | undefined) ?? modeDef.resources[0]
}

// ─── Play Panel ────────────────────────────────────────────────

function renderClickButtons(state: Readonly<GameState>): string {
  const modeDef = getModeDefinition(state.mode!)
  if (!isClickUnlocked(state.player, modeDef)) return ''
  const flavor = getModeFlavor(modeDef)

  const clickTarget = getClickTarget(modeDef)
  // The Space hotkey clicks one resource at a time; Z cycles which one. Show the
  // Space badge on the active target, and a Z hint only when there's a choice.
  const showCycleHint = modeDef.resources.length > 1

  const cards = modeDef.resources
    .map((key) => {
      const isTarget = key === clickTarget
      return `
      <button class="click-card" id="click-btn-${key}" aria-label="Click for ${getResourceName(flavor, key)}">
        <span class="click-card-hotkey" aria-hidden="true"${isTarget ? '' : ' hidden'}>Space</span>
        <span class="click-card-emoji" aria-hidden="true">${getResourceIcon(flavor, key)}</span>
        <span class="click-card-name">${getResourceName(flavor, key)}</span>
      </button>`
    })
    .join('')

  return `<div class="click-cards">${showCycleHint ? '<span class="click-cards-hotkey" aria-hidden="true">Z to switch</span>' : ''}${cards}</div>`
}

/**
 * The highlight selector cards (one per resource). They exist only while
 * highlighting is unlocked — before that the player sees nothing here, since
 * resource balances live in the always-on header resource bar. Returns '' when
 * highlighting is locked.
 */
function renderCurrencyCards(state: Readonly<GameState>): string {
  const modeDef = getModeDefinition(state.mode!)
  if (!isHighlightActive(state.player, modeDef)) return ''
  const flavor = getModeFlavor(modeDef)
  const highlight = getHighlight(state)

  const cards = modeDef.resources
    .map((key) => {
      const balance = formatNumber(state.player.resources[key])
      const isHighlighted = highlight === key
      return `
      <button class="currency-card ${isHighlighted ? 'highlighted' : ''}" id="card-${key}">
        <span class="card-emoji">${getResourceIcon(flavor, key)}</span>
        <span class="card-name">${getResourceName(flavor, key)}</span>
        <span class="card-balance" id="${key}-balance">${balance}</span>
      </button>`
    })
    .join('')

  return `
    <div class="currency-cards">
      <span class="cards-hotkey" aria-hidden="true">Tab</span>
      ${cards}
    </div>
  `
}

function renderIdlerContent(state: Readonly<GameState>): string {
  return `
    ${renderCurrencyCards(state)}
    ${renderClickButtons(state)}
  `
}

/** Attach highlight-select listeners to the currency cards currently in the DOM. */
function bindCurrencyCards(modeDef: ModeDefinition): void {
  for (const key of modeDef.resources) {
    document.getElementById(`card-${key}`)?.addEventListener('click', () => {
      setHighlight(key)
    })
  }
}

/** Attach click listeners to the click cards currently in the DOM. */
function bindClickCards(modeDef: ModeDefinition): void {
  for (const key of modeDef.resources) {
    document.getElementById(`click-btn-${key}`)?.addEventListener('click', () => {
      doClick(key)
    })
  }
}

export const playPanel: Panel = {
  id: 'play',
  label: 'Play',
  icon: '🎮',

  render(container, state) {
    container.innerHTML = renderIdlerContent(state)
  },

  bind(state) {
    const modeDef = getModeDefinition(state.mode!)
    bindCurrencyCards(modeDef)
    bindClickCards(modeDef)
  },

  update(state) {
    const modeDef = getModeDefinition(state.mode!)
    const root = document.getElementById('panel-container')
    if (!root) return

    // Highlight selector cards: present only while highlighting is unlocked.
    // Inject/remove on the frame the gate flips (mid-match purchase) so the
    // resource blocks aren't shown until the player can actually highlight them.
    const highlightUnlocked = isHighlightActive(state.player, modeDef)
    let cards = root.querySelector('.currency-cards')
    if (highlightUnlocked && !cards) {
      root.insertAdjacentHTML('afterbegin', renderCurrencyCards(state))
      cards = root.querySelector('.currency-cards')
      bindCurrencyCards(modeDef)
    } else if (!highlightUnlocked && cards) {
      cards.remove()
      cards = null
    }
    if (cards) {
      const highlight = getHighlight(state)
      for (const key of modeDef.resources) {
        setText(`${key}-balance`, formatNumber(state.player.resources[key]))
        document.getElementById(`card-${key}`)?.classList.toggle('highlighted', highlight === key)
      }
    }

    // Click cards: present only while clicking is unlocked, independent of the
    // selector cards above.
    const clickUnlocked = isClickUnlocked(state.player, modeDef)
    const clickCards = root.querySelector('.click-cards')
    if (clickUnlocked && !clickCards) {
      // Keep DOM order (selector cards first); fall back to the panel end when
      // the selector cards are absent (highlighting still locked).
      if (cards) cards.insertAdjacentHTML('afterend', renderClickButtons(state))
      else root.insertAdjacentHTML('beforeend', renderClickButtons(state))
      bindClickCards(modeDef)
    } else if (!clickUnlocked && clickCards) {
      clickCards.remove()
    } else if (clickUnlocked && clickCards) {
      // Move the Space badge to the currently-targeted click card (cycled via Z).
      const clickTarget = getClickTarget(modeDef)
      for (const key of modeDef.resources) {
        const badge = document.querySelector(`#click-btn-${key} .click-card-hotkey`)
        if (badge) (badge as HTMLElement).hidden = key !== clickTarget
      }
    }
  },
}
