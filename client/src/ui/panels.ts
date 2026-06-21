// ─── Panel Infrastructure ────────────────────────────────────────────
//
// A 5×2 tab grid that switches between panels. Each panel provides:
//  - render(container, state): full HTML render
//  - update(state): in-place DOM updates (optional)
//
// Only the active panel is rendered. Panels are configured per-mode at
// match start and the tab bar + panel container are injected into the
// playing screen.

import type { GameState } from '../game.js'
import { getState } from '../game.js'

// ─── Types ───────────────────────────────────────────────────────────

export interface Panel {
  /**
   * Stable, mode-agnostic id (e.g. `'generators'`). Matched against the `panel`
   * field of a `panelUnlock` effect to gate this tab; keep the two in sync.
   */
  readonly id: string
  /** Tab label (short — displayed in the grid button). */
  readonly label: string
  /** Tab icon (emoji). */
  readonly icon: string
  /** Render full panel HTML into the container. Called on tab switch. */
  render(container: HTMLElement, state: Readonly<GameState>): void
  /** In-place update while this panel is active. Called on every state change. */
  update?(state: Readonly<GameState>): void
  /** Bind event listeners after render. Called after render(). */
  bind?(state: Readonly<GameState>): void
}

// ─── Registry ────────────────────────────────────────────────────────

const TOTAL_SLOTS = 10

/** A registered slot: its panel plus an optional live unlock gate. */
interface RegisteredSlot {
  readonly panel: Panel
  readonly isUnlocked?: (state: Readonly<GameState>) => boolean
}

const slots: (RegisteredSlot | null)[] = Array.from<RegisteredSlot | null>({
  length: TOTAL_SLOTS,
}).fill(null)
let activeIndex = 0

/** Slot assignment for panel configuration. */
export interface PanelSlot {
  readonly index: number
  readonly panel: Panel
  /**
   * Optional live unlock gate. When provided and it returns false, the tab is
   * registered but rendered as locked (🔒) and is not navigable until it returns
   * true (e.g. an upgrade is purchased). Omit for always-available panels.
   */
  readonly isUnlocked?: (state: Readonly<GameState>) => boolean
}

/**
 * Last-rendered locked state per slot, so `refreshTabLocks` only touches tabs
 * whose state actually changed. Kept in sync by `renderTabGrid` (initial paint)
 * and `refreshTabLocks` (subsequent frames).
 */
const prevLocked: boolean[] = Array.from<boolean>({ length: TOTAL_SLOTS }).fill(false)

/**
 * Slots still able to change locked→unlocked. Unlocks are monotonic, so a slot
 * leaves this set permanently the moment it unlocks (and slots that start
 * unlocked or have no gate are never added). Once empty, `refreshTabLocks` is a
 * single set-size check. Seeded by `renderTabGrid`.
 */
const pendingSlots = new Set<number>()

/** Whether a registered slot is currently locked by its unlock gate. */
function isSlotLocked(index: number, state: Readonly<GameState>): boolean {
  const slot = slots[index]
  return slot?.isUnlocked ? !slot.isUnlocked(state) : false
}

/** Whether a slot holds a panel that is currently navigable (registered and unlocked). */
function isSlotAvailable(index: number, state: Readonly<GameState> = getState()): boolean {
  return slots[index] !== null && !isSlotLocked(index, state)
}

/** Configure panels for the current mode. Clears all slots and resets to first tab. */
export function configurePanels(panelSlots: readonly PanelSlot[]): void {
  slots.fill(null)
  prevLocked.fill(false)
  pendingSlots.clear()
  activeIndex = 0
  for (const { index, panel, isUnlocked } of panelSlots) {
    slots[index] = isUnlocked ? { panel, isUnlocked } : { panel }
  }
}

// ─── Rendering ───────────────────────────────────────────────────────

/** Render the tab grid HTML (5×2 grid of buttons). */
export function renderTabGrid(state: Readonly<GameState>): string {
  // Seed the locked-state cache first, so the map below is a pure read and
  // `refreshTabLocks` has a correct baseline to diff against. A slot that is both
  // populated and currently locked is the only kind that can still flip, so it's
  // the only kind tracked for future refreshes.
  pendingSlots.clear()
  for (let i = 0; i < TOTAL_SLOTS; i++) {
    prevLocked[i] = !slots[i] || isSlotLocked(i, state)
    if (slots[i] && prevLocked[i]) pendingSlots.add(i)
  }
  return `
    <div class="tab-grid" id="tab-grid" role="tablist" aria-label="Game panels">
      ${slots
        .map((slot, i) => {
          const isActive = i === activeIndex
          const locked = prevLocked[i]
          const label = slot && !locked ? slot.panel.icon : '🔒'
          const classes = `tab-btn${isActive ? ' active' : ''}${locked ? ' locked' : ''}`
          const title = slot
            ? `${slot.panel.label}${locked ? ' — Locked' : ''}`
            : `Tab ${i + 1} — Locked`
          const tabindex = isActive ? '0' : '-1'
          const disabled = locked ? ' aria-disabled="true"' : ''
          return `<button class="${classes}" id="tab-${i}" role="tab" aria-selected="${isActive}" aria-controls="panel-container" tabindex="${tabindex}" data-tab="${i}" title="${title}"${disabled}>${label}</button>`
        })
        .join('')}
    </div>
  `
}

/**
 * Unlock any tab whose gating upgrade was just purchased. Cheap to call every
 * frame: it only inspects slots that are still locked (`pendingSlots`) and, once
 * every gate has opened, is a single set-size check.
 *
 * Relies on unlocks being monotonic (upgrades are permanent, so a panel never
 * re-locks): each slot is handled once, on the frame it unlocks, then dropped
 * from the pending set — so the active tab is never pulled out from under the
 * player.
 */
export function refreshTabLocks(state: Readonly<GameState>): void {
  if (pendingSlots.size === 0) return
  for (const i of pendingSlots) {
    const slot = slots[i]
    if (!slot) {
      pendingSlots.delete(i)
      continue
    }
    if (isSlotLocked(i, state)) continue // still locked; re-check next frame
    // Unlocked — monotonic, so update the DOM once and stop tracking this slot.
    prevLocked[i] = false
    pendingSlots.delete(i)
    const btn = document.getElementById(`tab-${i}`)
    if (!btn) continue
    btn.classList.remove('locked')
    btn.textContent = slot.panel.icon
    btn.setAttribute('title', slot.panel.label)
    btn.removeAttribute('aria-disabled')
  }
}

/** Render the panel container (empty div to be filled by the active panel). */
export function renderPanelContainer(): string {
  return `<div class="panel-container" id="panel-container" role="tabpanel" aria-labelledby="tab-${activeIndex}"></div>`
}

/** Render the active panel's content into the container. */
export function renderActivePanel(state: Readonly<GameState>): void {
  const container = document.getElementById('panel-container')
  if (!container) return

  const panel = slots[activeIndex]?.panel
  if (panel) {
    panel.render(container, state)
    panel.bind?.(state)
  } else {
    container.innerHTML = `
      <div class="panel-placeholder">
        <span class="placeholder-icon">🔒</span>
        <p>Coming soon!</p>
      </div>
    `
  }
}

/** Call the active panel's update() for in-place DOM updates. */
export function updateActivePanel(state: Readonly<GameState>): void {
  slots[activeIndex]?.panel.update?.(state)
}

/** Switch to a given tab index, updating DOM and rendering the panel. */
function switchToTab(idx: number): void {
  if (idx === activeIndex) return
  activeIndex = idx

  // Update ARIA + classes on all tabs, roving tabindex
  document.querySelectorAll<HTMLButtonElement>('.tab-btn').forEach((b) => {
    const tabIdx = Number(b.dataset.tab)
    const isCurrent = tabIdx === idx
    b.classList.toggle('active', isCurrent)
    b.setAttribute('aria-selected', String(isCurrent))
    b.setAttribute('tabindex', isCurrent ? '0' : '-1')
  })

  // Update tabpanel's aria-labelledby to point at the new active tab
  document.getElementById('panel-container')?.setAttribute('aria-labelledby', `tab-${idx}`)

  renderActivePanel(getState())
}

/** Find the next registered panel starting after `start`, stepping by `step`. Returns -1 if none found. */
function findNextPanel(start: number, step: number): number {
  for (let i = 0; i < TOTAL_SLOTS; i++) {
    const idx = (((start + i * step) % TOTAL_SLOTS) + TOTAL_SLOTS) % TOTAL_SLOTS
    if (isSlotAvailable(idx) && idx !== activeIndex) return idx
  }
  return -1
}

/** Return the index of the first available (registered + unlocked) panel, or -1. */
function findFirstPanel(): number {
  for (let i = 0; i < TOTAL_SLOTS; i++) {
    if (isSlotAvailable(i)) return i
  }
  return -1
}

/** Return the index of the last available (registered + unlocked) panel, or -1. */
function findLastPanel(): number {
  for (let i = TOTAL_SLOTS - 1; i >= 0; i--) {
    if (isSlotAvailable(i)) return i
  }
  return -1
}

/** Switch to a specific panel slot (0-indexed). No-ops if locked or already active. */
export function switchToPanel(index: number): void {
  if (index < 0 || index >= TOTAL_SLOTS) return
  if (!isSlotAvailable(index) || index === activeIndex) return
  switchToTab(index)
}

/** Switch to the next (+1) or previous (-1) active panel. */
export function switchToPanelRelative(step: 1 | -1): void {
  const target = findNextPanel(activeIndex + step, step)
  if (target === -1) return
  switchToTab(target)
}

/** Bind tab-switching via click + arrow-key navigation on #tab-grid. */
export function bindTabEvents(): void {
  const grid = document.getElementById('tab-grid')
  if (!grid) return

  // Click / tap delegation
  grid.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.tab-btn')
    if (!btn) return
    if (btn.getAttribute('aria-disabled') === 'true') {
      // Refocus the active tab so arrow-key navigation stays consistent
      document.querySelector<HTMLButtonElement>(`.tab-btn[data-tab="${activeIndex}"]`)?.focus()
      return
    }
    const idx = Number(btn.dataset.tab)
    if (Number.isNaN(idx)) return
    switchToTab(idx)
  })

  // Arrow-key navigation (roving tabindex)
  grid.addEventListener('keydown', (e) => {
    const key = e.key
    const cols = 5
    let delta: number

    switch (key) {
      case 'ArrowRight':
        delta = 1
        break
      case 'ArrowLeft':
        delta = -1
        break
      case 'ArrowDown':
        delta = cols
        break
      case 'ArrowUp':
        delta = -cols
        break
      case 'Home': {
        e.preventDefault()
        const first = findFirstPanel()
        if (first === -1 || first === activeIndex) return
        switchToTab(first)
        document.querySelector<HTMLButtonElement>(`.tab-btn[data-tab="${first}"]`)?.focus()
        return
      }
      case 'End': {
        e.preventDefault()
        const last = findLastPanel()
        if (last === -1 || last === activeIndex) return
        switchToTab(last)
        document.querySelector<HTMLButtonElement>(`.tab-btn[data-tab="${last}"]`)?.focus()
        return
      }
      default:
        return
    }

    e.preventDefault()

    // Left/Right (±1): search sequentially across all slots
    // Up/Down (±cols): search only in the same column
    const target = findNextPanel(activeIndex + delta, delta)
    if (target === -1) return

    switchToTab(target)
    document.querySelector<HTMLButtonElement>(`.tab-btn[data-tab="${target}"]`)?.focus()
  })
}
