import type { Panel } from '../panels.js'
import { switchToPanel, UPGRADE_TREE_PANEL_INDEX } from '../panels.js'
import type { GameState } from '../../game.js'
import { doClick, toggleHighlight, getClickTarget } from '../../game.js'
import { formatNumber } from '../format-number.js'
import { counterAttr } from '../counters.js'
import { canBuy, escapeAttr, formatUpgradeCost, upgradeTitle } from '../helpers.js'
import { closeUpgradeDetail, openUpgradeDetail, updateUpgradeDetail } from '../upgrade-detail.js'
import {
  getModeDefinition,
  getModeFlavor,
  getResourceIcon,
  getResourceName,
  getUpgradeDescription,
  getUpgradeIcon,
  getUpgradeName,
  isClickUnlocked,
  isHighlightActive,
  isHighlightBatteryActive,
  isMaxed,
  readHighlight,
} from '@game/shared'
import type { ModeDefinition, ModeFlavor, PlayerState, UpgradeDefinition } from '@game/shared'
import { BATTERY_BAR_ID, renderBatteryBar, syncBatteryBar } from './battery-bar.js'

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
        <kbd class="click-card-hotkey" aria-hidden="true"${isTarget ? '' : ' hidden'}>Space</kbd>
        <span class="click-card-emoji" aria-hidden="true">${getResourceIcon(flavor, key)}</span>
        <span class="click-card-name">${getResourceName(flavor, key)}</span>
      </button>`
    })
    .join('')

  return `<div class="click-cards">${showCycleHint ? '<kbd class="click-cards-hotkey" aria-hidden="true">Z to switch</kbd>' : ''}${cards}</div>`
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
  const highlight = readHighlight(state.player)

  const cards = modeDef.resources
    .map((key) => {
      const balance = formatNumber(state.player.resources[key])
      const isHighlighted = highlight === key
      return `
      <button class="currency-card ${isHighlighted ? 'highlighted' : ''}" id="card-${key}" aria-pressed="${isHighlighted}">
        <span class="card-emoji">${getResourceIcon(flavor, key)}</span>
        <span class="card-name">${getResourceName(flavor, key)}</span>
        <span class="card-balance" id="${key}-balance"${counterAttr('own', key)}>${balance}</span>
      </button>`
    })
    .join('')

  return `
    <div class="currency-cards">
      <kbd class="cards-hotkey" aria-hidden="true">Tab</kbd>
      ${cards}
    </div>
  `
}

function renderIdlerContent(state: Readonly<GameState>): string {
  // Wrap in the panel's own stable root (like the other panels' inner lists) so
  // update() has a fixed anchor for the cards it injects/removes — the cards
  // themselves come and go as their gates flip, so they can't be the anchor.
  return `
    <div class="play-content" id="play-content">
      ${renderBatteryBar(state)}
      ${renderCurrencyCards(state)}
      ${renderClickButtons(state)}
      ${renderOpening(state)}
    </div>
  `
}

// ─── Opening (empty state) ──────────────────────────────────────────────
//
// Until something unlocks the panel's own content, point the player at the
// tree: one card per tree root, each opening the same detail popup the tree uses.

const OPENING_ID = 'play-opening'
const OPENING_CARDS_ID = 'opening-cards'

function showsOpening(player: Readonly<PlayerState>, modeDef: ModeDefinition): boolean {
  return (
    modeDef.upgrades.length > 0 &&
    !isClickUnlocked(player, modeDef) &&
    !isHighlightActive(player, modeDef) &&
    !isHighlightBatteryActive(player, modeDef)
  )
}

function openingUpgrades(state: Readonly<GameState>): UpgradeDefinition[] {
  const ids = getModeDefinition(state.mode!).rootUpgradeIds ?? []
  return ids.flatMap((id) => {
    const u = state.upgrades.find((x) => x.id === id)
    if (!u || u.goalType || u.comingSoon) return []
    return isMaxed(u, state.player.upgrades[id] ?? 0) ? [] : [u]
  })
}

function renderOpeningCard(
  state: Readonly<GameState>,
  flavor: ModeFlavor,
  u: UpgradeDefinition,
): string {
  const icon = getUpgradeIcon(flavor, u.id)
  return `
    <button class="opening-card${canBuy(state, u) ? '' : ' blocked'}" data-upgrade="${u.id}">
      <span class="opening-card-icon" aria-hidden="true">${icon}</span>
      <span class="opening-card-name">${escapeAttr(upgradeTitle(getUpgradeName(flavor, u.id), icon))}</span>
      <span class="opening-card-desc">${escapeAttr(getUpgradeDescription(flavor, u.id))}</span>
      <span class="opening-card-cost">${escapeAttr(formatUpgradeCost(state, u, flavor))}</span>
    </button>`
}

function renderOpeningCards(
  state: Readonly<GameState>,
  list: readonly UpgradeDefinition[],
): string {
  const flavor = getModeFlavor(getModeDefinition(state.mode!))
  return list.map((u) => renderOpeningCard(state, flavor, u)).join('')
}

function renderOpening(state: Readonly<GameState>): string {
  if (!showsOpening(state.player, getModeDefinition(state.mode!))) return ''
  const list = openingUpgrades(state)
  return `
    <section class="play-opening" id="${OPENING_ID}" aria-labelledby="play-opening-title">
      <h2 class="play-opening-title" id="play-opening-title">Choose your opening</h2>
      <p class="play-opening-body">Every strategy starts in the Upgrade Tree. Pick a branch. You can expand into the others anytime.</p>
      <div class="opening-cards" id="${OPENING_CARDS_ID}" data-ids="${list.map((u) => u.id).join(' ')}">
        ${renderOpeningCards(state, list)}
      </div>
      <button class="opening-tree-link" id="opening-tree-link">
        Open the Upgrade Tree →<kbd aria-hidden="true">Ctrl+${UPGRADE_TREE_PANEL_INDEX + 1}</kbd>
      </button>
    </section>
  `
}

function bindOpening(): void {
  const section = document.getElementById(OPENING_ID)
  // Delegated, so a rebuilt card grid needs no rebinding.
  section?.addEventListener('click', (e) => {
    const target = e.target as HTMLElement
    const card = target.closest<HTMLElement>('.opening-card')
    if (card?.dataset.upgrade) openUpgradeDetail(card.dataset.upgrade, { host: section })
    else if (target.closest('#opening-tree-link')) switchToPanel(UPGRADE_TREE_PANEL_INDEX)
  })
}

function syncOpening(state: Readonly<GameState>): void {
  const grid = document.getElementById(OPENING_CARDS_ID)
  if (!grid) return
  const list = openingUpgrades(state)
  const ids = list.map((u) => u.id).join(' ')
  if (grid.dataset.ids !== ids) {
    grid.dataset.ids = ids
    grid.innerHTML = renderOpeningCards(state, list)
    return
  }
  const flavor = getModeFlavor(getModeDefinition(state.mode!))
  for (const u of list) {
    const card = grid.querySelector(`[data-upgrade="${u.id}"]`)
    card?.classList.toggle('blocked', !canBuy(state, u))
    const cost = card?.querySelector('.opening-card-cost')
    const label = formatUpgradeCost(state, u, flavor)
    if (cost && cost.textContent !== label) cost.textContent = label
  }
}

/**
 * Attach highlight-select listeners to the currency cards currently in the DOM.
 * Clicking the held card releases the highlight — the only way to get back to
 * "nothing highlighted" with the mouse.
 */
function bindCurrencyCards(modeDef: ModeDefinition): void {
  for (const key of modeDef.resources) {
    document.getElementById(`card-${key}`)?.addEventListener('click', () => {
      toggleHighlight(key)
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
    bindOpening()
  },

  update(state) {
    const modeDef = getModeDefinition(state.mode!)
    const root = document.getElementById('play-content')
    if (!root) return

    // Lantern bar: present only once the battery is unlocked, and always above
    // the selector cards it belongs to. Same inject/remove-on-gate-flip pattern
    // as the cards below.
    const batteryUnlocked = isHighlightBatteryActive(state.player, modeDef)
    const bar = document.getElementById(BATTERY_BAR_ID)
    if (batteryUnlocked && !bar) {
      root.insertAdjacentHTML('afterbegin', renderBatteryBar(state))
    } else if (!batteryUnlocked && bar) {
      bar.remove()
    }
    // Re-anchors the extrapolation from this snapshot and (re)starts its rAF loop.
    syncBatteryBar(state)

    // Highlight selector cards: present only while highlighting is unlocked.
    // Inject/remove on the frame the gate flips (mid-match purchase) so the
    // resource blocks aren't shown until the player can actually highlight them.
    const highlightUnlocked = isHighlightActive(state.player, modeDef)
    let cards = root.querySelector('.currency-cards')
    if (highlightUnlocked && !cards) {
      // Keep DOM order (lantern bar first); fall back to the panel start when the
      // bar is absent (battery still locked).
      const barEl = document.getElementById(BATTERY_BAR_ID)
      if (barEl) barEl.insertAdjacentHTML('afterend', renderCurrencyCards(state))
      else root.insertAdjacentHTML('afterbegin', renderCurrencyCards(state))
      cards = root.querySelector('.currency-cards')
      bindCurrencyCards(modeDef)
    } else if (!highlightUnlocked && cards) {
      cards.remove()
      cards = null
    }
    if (cards) {
      const highlight = readHighlight(state.player)
      for (const key of modeDef.resources) {
        const card = document.getElementById(`card-${key}`)
        card?.classList.toggle('highlighted', highlight === key)
        card?.setAttribute('aria-pressed', String(highlight === key))
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

    // Opening: last in the panel, and only while nothing above it is unlocked.
    const opening = document.getElementById(OPENING_ID)
    const showOpening = showsOpening(state.player, modeDef)
    if (showOpening && !opening) {
      root.insertAdjacentHTML('beforeend', renderOpening(state))
      bindOpening()
    } else if (!showOpening && opening) {
      // The popup is mounted inside the opening; close it before it goes.
      closeUpgradeDetail()
      opening.remove()
    } else if (opening) {
      syncOpening(state)
    }
    updateUpgradeDetail(state)
  },
}
