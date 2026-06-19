import type { Panel } from '../panels.js'
import type { GameState } from '../../game.js'
import { doClick, setHighlight } from '../../game.js'
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

function renderClickButton(state: Readonly<GameState>): string {
  const modeDef = getModeDefinition(state.mode!)
  if (!isClickUnlocked(state.player, modeDef)) return ''
  const flavor = getModeFlavor(modeDef)
  const icon = getResourceIcon(flavor, modeDef.scoreResource)
  return `
    <button class="click-btn" id="click-btn" aria-label="Click for ${getResourceName(flavor, modeDef.scoreResource)}">
      <span class="click-btn-emoji" aria-hidden="true">${icon}</span>
      <span class="click-btn-hotkey" aria-hidden="true">Space</span>
    </button>`
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
    ${renderClickButton(state)}
  `
}

export const playPanel: Panel = {
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
    }
    document.getElementById('click-btn')?.addEventListener('click', () => {
      doClick()
    })
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

    // Inject the click button the moment clicking is unlocked (mid-match purchase).
    const clickUnlocked = isClickUnlocked(state.player, modeDef)
    const clickBtn = document.getElementById('click-btn')
    if (clickUnlocked && !clickBtn && container) {
      container.insertAdjacentHTML('afterend', renderClickButton(state))
      document.getElementById('click-btn')?.addEventListener('click', () => {
        doClick()
      })
    } else if (!clickUnlocked && clickBtn) {
      clickBtn.remove()
    }
  },
}
