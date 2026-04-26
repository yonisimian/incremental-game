import type { Panel } from '../panels.js'
import type { GameState } from '../../game.js'
import { doClick, setHighlight } from '../../game.js'
import { handledByHotkey } from '../hotkeys.js'
import { renderClickerUpgrades, renderIdlerUpgrades } from '../components.js'
import { setText, bindUpgradeEvents } from '../helpers.js'

// ─── Helpers ─────────────────────────────────────────────────────────

function getHighlight(state: Readonly<GameState>): string {
  return (state.player.meta.highlight as string | undefined) ?? 'wood'
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
        <span class="currency-bar" id="currency-bar">💰 <span id="currency">${Math.floor(state.player.resources.currency)}</span></span>
        <span class="upgrades-hotkey"><span class="btn-hotkey" aria-hidden="true">C</span> buy cheapest</span>
      </div>
      <div class="upgrades" id="upgrades">
        ${renderClickerUpgrades(state)}
      </div>
    </div>
  `
}

function renderIdlerContent(state: Readonly<GameState>): string {
  const highlight = getHighlight(state)
  const wood = Math.floor(state.player.resources.wood)
  const ale = Math.floor(state.player.resources.ale)

  return `
    <div class="currency-cards">
      <span class="cards-hotkey" aria-hidden="true">Tab</span>
      <button class="currency-card ${highlight === 'wood' ? 'highlighted' : ''}" id="card-wood">
        <span class="card-emoji">🪵</span>
        <span class="card-name">Wood</span>
        <span class="card-balance" id="wood-balance">${wood}</span>
      </button>
      <button class="currency-card ${highlight === 'ale' ? 'highlighted' : ''}" id="card-ale">
        <span class="card-emoji">🍺</span>
        <span class="card-name">Ale</span>
        <span class="card-balance" id="ale-balance">${ale}</span>
      </button>
    </div>

    <div class="upgrades-wrapper">
      <div class="upgrades-header">
        <span></span>
        <span class="upgrades-hotkey"><span class="btn-hotkey" aria-hidden="true">C</span> buy cheapest</span>
      </div>
      <div class="upgrades" id="upgrades">
        ${renderIdlerUpgrades(state)}
      </div>
    </div>
  `
}

export const playPanel: Panel = {
  label: 'Play',
  icon: '🎮',

  render(container, state) {
    prevUpgradeHtml = ''
    container.innerHTML =
      state.mode === 'idler' ? renderIdlerContent(state) : renderClickerContent(state)
  },

  bind(state) {
    if (state.mode !== 'idler') {
      document.getElementById('click-btn')?.addEventListener('click', () => {
        if (handledByHotkey) return
        doClick()
      })
    } else {
      document.getElementById('card-wood')?.addEventListener('click', () => {
        setHighlight('wood')
      })
      document.getElementById('card-ale')?.addEventListener('click', () => {
        setHighlight('ale')
      })
    }
    bindUpgradeEvents()
  },

  update(state) {
    if (state.mode === 'idler') {
      setText('wood-balance', String(Math.floor(state.player.resources.wood)))
      setText('ale-balance', String(Math.floor(state.player.resources.ale)))

      const highlight = getHighlight(state)
      const woodCard = document.getElementById('card-wood')
      const aleCard = document.getElementById('card-ale')
      if (woodCard) woodCard.classList.toggle('highlighted', highlight === 'wood')
      if (aleCard) aleCard.classList.toggle('highlighted', highlight === 'ale')

      updateUpgradesIfDirty(renderIdlerUpgrades(state))
    } else {
      setText('currency', String(Math.floor(state.player.resources.currency)))
      updateUpgradesIfDirty(renderClickerUpgrades(state))
    }
  },
}
