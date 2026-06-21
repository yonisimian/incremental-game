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

function renderIdlerContent(state: Readonly<GameState>): string {
  const modeDef = getModeDefinition(state.mode!)
  const flavor = getModeFlavor(modeDef)
  const highlightUnlocked = isHighlightActive(state.player, modeDef)
  const highlight = getHighlight(state)

  const cards = modeDef.resources
    .map((key) => {
      const balance = formatNumber(state.player.resources[key])
      const isHighlighted = highlightUnlocked && highlight === key
      return `
      <button class="currency-card ${isHighlighted ? 'highlighted' : ''}" id="card-${key}"${!highlightUnlocked ? ' disabled' : ''}>
        <span class="card-emoji">${getResourceIcon(flavor, key)}</span>
        <span class="card-name">${getResourceName(flavor, key)}</span>
        <span class="card-balance" id="${key}-balance">${balance}</span>
      </button>`
    })
    .join('')

  return `
    <div class="currency-cards${highlightUnlocked ? '' : ' locked'}">
      ${highlightUnlocked ? '<span class="cards-hotkey" aria-hidden="true">Tab</span>' : ''}
      ${cards}
    </div>
    ${renderClickButtons(state)}
  `
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
    for (const key of modeDef.resources) {
      document.getElementById(`card-${key}`)?.addEventListener('click', () => {
        setHighlight(key)
      })
      document.getElementById(`click-btn-${key}`)?.addEventListener('click', () => {
        doClick(key)
      })
    }
  },

  update(state) {
    const modeDef = getModeDefinition(state.mode!)
    const highlightUnlocked = isHighlightActive(state.player, modeDef)

    for (const key of modeDef.resources) {
      setText(`${key}-balance`, formatNumber(state.player.resources[key]))
    }

    const highlight = getHighlight(state)
    for (const key of modeDef.resources) {
      const card = document.getElementById(`card-${key}`)
      if (card) {
        card.classList.toggle('highlighted', highlightUnlocked && highlight === key)
        ;(card as HTMLButtonElement).disabled = !highlightUnlocked
      }
    }

    // Show/hide Tab hotkey hint and locked state
    const container = document.querySelector('.currency-cards')
    if (container) {
      container.classList.toggle('locked', !highlightUnlocked)
      const hotkey = container.querySelector('.cards-hotkey')
      if (highlightUnlocked && !hotkey) {
        container.insertAdjacentHTML(
          'afterbegin',
          '<span class="cards-hotkey" aria-hidden="true">Tab</span>',
        )
      } else if (!highlightUnlocked && hotkey) {
        hotkey.remove()
      }
    }

    // Move the Space badge to the currently-targeted click card (cycled via Z).
    if (isClickUnlocked(state.player, modeDef)) {
      const clickTarget = getClickTarget(modeDef)
      for (const key of modeDef.resources) {
        const badge = document.querySelector(`#click-btn-${key} .click-card-hotkey`)
        if (badge) (badge as HTMLElement).hidden = key !== clickTarget
      }
    }

    // Inject the click cards the moment clicking is unlocked (mid-match purchase).
    const clickUnlocked = isClickUnlocked(state.player, modeDef)
    const clickCards = document.querySelector('.click-cards')
    if (clickUnlocked && !clickCards && container) {
      container.insertAdjacentHTML('afterend', renderClickButtons(state))
      for (const key of modeDef.resources) {
        document.getElementById(`click-btn-${key}`)?.addEventListener('click', () => {
          doClick(key)
        })
      }
    } else if (!clickUnlocked && clickCards) {
      clickCards.remove()
    }
  },
}
