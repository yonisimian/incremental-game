import type { Panel } from '../panels.js'
import type { GameState } from '../../game.js'
import { doClick, setHighlight } from '../../game.js'
import { handledByHotkey } from '../hotkeys.js'
import { renderClickerUpgrades } from '../components.js'
import { setText, bindUpgradeEvents } from '../helpers.js'
import { getModeDefinition, getResourceIcon, getResourceName } from '@game/shared'

// ─── Helpers ─────────────────────────────────────────────────────────

function getHighlight(state: Readonly<GameState>): string {
  const modeDef = getModeDefinition(state.mode!)
  return (state.player.meta.highlight as string | undefined) ?? modeDef.resources[0]
}

/** Cache of last upgrade HTML to avoid unnecessary DOM churn. */
let prevUpgradeHtml = ''

/** Only replace #upgrades innerHTML when the rendered HTML actually changed. */
function updateUpgradesIfDirty(html: string): void {
  if (html === prevUpgradeHtml) return
  prevUpgradeHtml = html
  const container = document.getElementById('upgrades')
  if (container) container.innerHTML = html
}

// ─── Play Panel ──────────────────────────────────────────────────────

function renderClickerContent(state: Readonly<GameState>): string {
  return `
    <button class="click-button" id="click-btn">CLICK<span class="btn-hotkey" aria-hidden="true">Space</span></button>

    <div class="upgrades-wrapper">
      <div class="upgrades-header">
        <span class="upgrades-hotkey"><span class="btn-hotkey" aria-hidden="true">C</span> buy cheapest</span>
      </div>
      <div class="upgrades" id="upgrades">
        ${renderClickerUpgrades(state)}
      </div>
    </div>
  `
}

function renderIdlerContent(state: Readonly<GameState>): string {
  const modeDef = getModeDefinition(state.mode!)
  const flavor = modeDef.flavor
  const highlight = getHighlight(state)

  const cards = modeDef.resources
    .map((key) => {
      const balance = Math.floor(state.player.resources[key])
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

export const playPanel: Panel = {
  label: 'Play',
  icon: '🎮',

  render(container, state) {
    prevUpgradeHtml = ''
    const modeDef = getModeDefinition(state.mode!)
    container.innerHTML = modeDef.clicksEnabled
      ? renderClickerContent(state)
      : renderIdlerContent(state)
  },

  bind(state) {
    const modeDef = getModeDefinition(state.mode!)
    if (modeDef.clicksEnabled) {
      document.getElementById('click-btn')?.addEventListener('click', () => {
        if (handledByHotkey) return
        doClick()
      })
      bindUpgradeEvents()
    } else {
      for (const key of modeDef.resources) {
        document.getElementById(`card-${key}`)?.addEventListener('click', () => {
          setHighlight(key)
        })
      }
    }
  },

  update(state) {
    const modeDef = getModeDefinition(state.mode!)
    if (!modeDef.clicksEnabled) {
      for (const key of modeDef.resources) {
        setText(`${key}-balance`, String(Math.floor(state.player.resources[key])))
      }

      const highlight = getHighlight(state)
      for (const key of modeDef.resources) {
        const card = document.getElementById(`card-${key}`)
        if (card) card.classList.toggle('highlighted', highlight === key)
      }
    } else {
      updateUpgradesIfDirty(renderClickerUpgrades(state))
    }
  },
}
