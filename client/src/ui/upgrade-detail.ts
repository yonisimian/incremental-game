import type { GameState } from '../game.js'
import { doBuy, getState } from '../game.js'
import {
  getModeDefinition,
  getModeFlavor,
  getUpgradeName,
  getUpgradeIcon,
  getUpgradeDescription,
  isChoiceGroupAvailable,
  isMaxed,
  isUnlimited,
  formatPrerequisiteExpression,
  getUpgradeNextCost,
  type UpgradeDefinition,
} from '@game/shared'
import { canAfford, formatCostLabel, isUnlocked, escapeAttr } from './helpers.js'

// ─── Upgrade Detail Popup ────────────────────────────────────────────
//
// A modal detail view for a single upgrade, opened by clicking a tree node.
// Shows name / cost / description / lock reason with Buy + Cancel actions.
// Mounted inside `#tree-viewport` (which is `position: relative; overflow:
// hidden`), so it overlays the tree and is wiped automatically when the panel
// re-renders. `resetUpgradeDetail()` clears module state for that case.

/** Host element the popup mounts into. The tree viewport overlays the canvas. */
const HOST_ID = 'tree-viewport'

let openId: string | null = null
let lastFocused: HTMLElement | null = null

/** Derived display data for the currently-open upgrade. */
interface DetailView {
  readonly name: string
  readonly icon: string
  readonly costLabel: string
  readonly levelLabel: string
  readonly description: string
  readonly lockReason: string
  readonly buyable: boolean
}

function findUpgrade(state: Readonly<GameState>, id: string): UpgradeDefinition | undefined {
  return state.upgrades.find((u) => u.id === id)
}

function computeView(state: Readonly<GameState>, u: UpgradeDefinition): DetailView {
  const modeDef = getModeDefinition(state.mode!)
  const flavor = getModeFlavor(modeDef)
  const owned = state.player.upgrades[u.id] ?? 0
  const unlocked = isUnlocked(state, u)
  const affordable = canAfford(state, u)
  const maxed = isMaxed(u, owned)
  const choiceBlocked = !isChoiceGroupAvailable(u, state.player, modeDef.upgrades)

  const countLabel = isUnlimited(u) && owned > 0 ? ` (×${owned})` : ''
  const nextCost = getUpgradeNextCost(u, owned)
  const costLabel = maxed ? 'Maxed' : `${formatCostLabel(nextCost, flavor)}${countLabel}`

  const levelLabel =
    u.purchaseLimit > 1 && !isUnlimited(u) && owned > 0 ? `${owned}/${u.purchaseLimit}` : ''

  let lockReason = ''
  if (!unlocked)
    lockReason = `Requires ${formatPrerequisiteExpression(u.prerequisites, (id) => getUpgradeName(flavor, id))}`
  else if (choiceBlocked) lockReason = 'Another choice in this group has already been selected'

  const name = getUpgradeName(flavor, u.id)
  const icon = getUpgradeIcon(flavor, u.id)

  return {
    // The node already shows the icon; strip a duplicate leading glyph from the
    // header name so it isn't rendered twice next to the hero icon.
    name: name.startsWith(icon) ? name.slice(icon.length).trim() : name,
    icon,
    costLabel,
    levelLabel,
    description: getUpgradeDescription(flavor, u.id),
    lockReason,
    buyable: unlocked && !choiceBlocked && affordable && !maxed,
  }
}

function renderMarkup(v: DetailView): string {
  const level = v.levelLabel
    ? `<span class="upgrade-detail-level">${escapeAttr(v.levelLabel)}</span>`
    : ''
  const lock = v.lockReason
    ? `<p class="upgrade-detail-lock" id="upgrade-detail-lock">${escapeAttr(v.lockReason)}</p>`
    : ''
  const buyDisabled = v.buyable ? '' : 'disabled'
  return `
    <div class="upgrade-detail-backdrop" id="upgrade-detail-backdrop">
      <div class="upgrade-detail" id="upgrade-detail" role="dialog" aria-modal="true"
           aria-labelledby="upgrade-detail-name">
        <div class="upgrade-detail-header">
          <span class="upgrade-detail-icon" aria-hidden="true">${v.icon}</span>
          <h3 class="upgrade-detail-name" id="upgrade-detail-name">${escapeAttr(v.name)}</h3>
        </div>
        <div class="upgrade-detail-meta">
          <span class="upgrade-detail-cost" id="upgrade-detail-cost">${escapeAttr(v.costLabel)}</span>
          ${level}
        </div>
        <p class="upgrade-detail-desc">${escapeAttr(v.description)}</p>
        ${lock}
        <div class="upgrade-detail-actions">
          <button class="upgrade-detail-buy" id="upgrade-detail-buy" ${buyDisabled}>Buy</button>
          <button class="upgrade-detail-cancel" id="upgrade-detail-cancel">Cancel</button>
        </div>
      </div>
    </div>
  `
}

function onBackdropKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.stopPropagation()
    closeUpgradeDetail()
    return
  }
  // Focus trap: keep Tab cycling between Buy and Cancel.
  if (e.key === 'Tab') {
    const focusable = [
      document.getElementById('upgrade-detail-buy'),
      document.getElementById('upgrade-detail-cancel'),
    ].filter((el): el is HTMLButtonElement => el !== null && !el.hasAttribute('disabled'))
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    const active = document.activeElement
    if (e.shiftKey && active === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && active === last) {
      e.preventDefault()
      first.focus()
    }
  }
}

/** Open the detail popup for the given upgrade id. No-op if host is absent. */
export function openUpgradeDetail(upgradeId: string): void {
  const host = document.getElementById(HOST_ID)
  if (!host) return
  const state = getState()
  const u = findUpgrade(state, upgradeId)
  if (!u) return

  // Replace any existing popup (e.g. clicking a second node while one is open).
  removePopup()
  openId = upgradeId
  lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null

  host.insertAdjacentHTML('beforeend', renderMarkup(computeView(state, u)))

  const backdrop = document.getElementById('upgrade-detail-backdrop')
  const dialog = document.getElementById('upgrade-detail')
  const buyBtn = document.getElementById('upgrade-detail-buy') as HTMLButtonElement | null
  const cancelBtn = document.getElementById('upgrade-detail-cancel')
  if (!backdrop || !dialog) return

  // Backdrop click closes; clicks inside the dialog don't bubble out to it.
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) closeUpgradeDetail()
  })
  dialog.addEventListener('click', (e) => {
    e.stopPropagation()
  })
  // Stop pan/zoom from reacting to interactions over the popup.
  backdrop.addEventListener('pointerdown', (e) => {
    e.stopPropagation()
  })
  backdrop.addEventListener('wheel', (e) => {
    e.stopPropagation()
  })
  backdrop.addEventListener('keydown', onBackdropKeydown)

  buyBtn?.addEventListener('click', () => {
    if (buyBtn.hasAttribute('disabled')) return
    doBuy(upgradeId)
    closeUpgradeDetail() // close on buy
  })
  cancelBtn?.addEventListener('click', () => {
    closeUpgradeDetail()
  })

  // Focus the primary action (Buy if enabled, else Cancel).
  if (buyBtn && !buyBtn.hasAttribute('disabled')) buyBtn.focus()
  else if (cancelBtn instanceof HTMLElement) cancelBtn.focus()
}

/** Close the popup and restore focus to the originating element. */
export function closeUpgradeDetail(): void {
  if (openId === null) return
  removePopup()
  openId = null
  if (lastFocused && document.contains(lastFocused)) lastFocused.focus()
  lastFocused = null
}

/** Whether the detail popup is currently open. */
export function isUpgradeDetailOpen(): boolean {
  return openId !== null
}

/**
 * Refresh the open popup's live fields (cost + Buy-enabled + lock reason) from
 * current state. Called each tick so affordability tracks passive income.
 */
export function updateUpgradeDetail(state: Readonly<GameState>): void {
  if (openId === null) return
  const u = findUpgrade(state, openId)
  if (!u) return
  const v = computeView(state, u)

  // Only touch the DOM when a value actually changes. Reassigning textContent
  // every tick recreates the text node each frame, which makes static labels
  // (e.g. the lock reason) visibly flicker.
  const costEl = document.getElementById('upgrade-detail-cost')
  if (costEl && costEl.textContent !== v.costLabel) costEl.textContent = v.costLabel

  const buyBtn = document.getElementById('upgrade-detail-buy') as HTMLButtonElement | null
  if (buyBtn && buyBtn.disabled !== !v.buyable) buyBtn.disabled = !v.buyable

  const lockEl = document.getElementById('upgrade-detail-lock')
  if (lockEl && lockEl.textContent !== v.lockReason) lockEl.textContent = v.lockReason
}

/**
 * Clear module state without touching the DOM. Use when the host DOM is wiped
 * externally (panel re-render / match boundary) so we don't try to refresh a
 * popup whose elements no longer exist.
 */
export function resetUpgradeDetail(): void {
  openId = null
  lastFocused = null
}

function removePopup(): void {
  document.getElementById('upgrade-detail-backdrop')?.remove()
}
