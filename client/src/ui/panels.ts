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
const panels: (Panel | null)[] = Array.from<Panel | null>({ length: TOTAL_SLOTS }).fill(null)
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

/** Per-slot unlock gates, parallel to `panels`. */
const slotGate: ((state: Readonly<GameState>) => boolean)[] = Array.from<
  (state: Readonly<GameState>) => boolean
>({ length: TOTAL_SLOTS })
/** Last-rendered locked state per slot, so `refreshTabLocks` only touches changed tabs. */
const prevLocked: boolean[] = Array.from<boolean>({ length: TOTAL_SLOTS }).fill(false)

/** Whether a registered slot is currently locked by its unlock gate. */
function isSlotLocked(index: number, state: Readonly<GameState>): boolean {
  const gate = slotGate[index] as ((s: Readonly<GameState>) => boolean) | undefined
  return gate ? !gate(state) : false
}

/** Whether a slot holds a panel that is currently navigable (registered and unlocked). */
function isSlotAvailable(index: number): boolean {
  return panels[index] !== null && !isSlotLocked(index, getState())
}

/** Configure panels for the current mode. Clears all slots and resets to first tab. */
export function configurePanels(slots: readonly PanelSlot[]): void {
  panels.fill(null)
  slotGate.length = 0
  slotGate.length = TOTAL_SLOTS
  prevLocked.fill(false)
  activeIndex = 0
  for (const { index, panel, isUnlocked } of slots) {
    panels[index] = panel
    if (isUnlocked) slotGate[index] = isUnlocked
  }
}

// ─── Rendering ───────────────────────────────────────────────────────

/** Render the tab grid HTML (5×2 grid of buttons). */
export function renderTabGrid(state: Readonly<GameState>): string {
  return `
    <div class="tab-grid" id="tab-grid" role="tablist" aria-label="Game panels">
      ${panels
        .map((p, i) => {
          const isActive = i === activeIndex
          // A slot is locked if it holds no panel, or its unlock gate is unmet.
          const locked = !p || isSlotLocked(i, state)
          prevLocked[i] = locked
          const label = p && !locked ? p.icon : '🔒'
          const classes = `tab-btn${isActive ? ' active' : ''}${locked ? ' locked' : ''}`
          const title = p ? `${p.label}${locked ? ' — Locked' : ''}` : `Tab ${i + 1} — Locked`
          const tabindex = isActive ? '0' : '-1'
          const disabled = locked ? ' aria-disabled="true"' : ''
          return `<button class="${classes}" id="tab-${i}" role="tab" aria-selected="${isActive}" aria-controls="panel-container" tabindex="${tabindex}" data-tab="${i}" title="${title}"${disabled}>${label}</button>`
        })
        .join('')}
    </div>
  `
}

/**
 * Re-evaluate per-slot unlock gates and update any tab whose locked state changed
 * (e.g. when the unlocking upgrade is purchased mid-match). Cheap to call every
 * frame — it only touches the DOM when a tab actually flips locked↔unlocked.
 */
export function refreshTabLocks(state: Readonly<GameState>): void {
  for (let i = 0; i < TOTAL_SLOTS; i++) {
    const p = panels[i]
    if (!p) continue // empty slots never change
    const locked = isSlotLocked(i, state)
    if (locked === prevLocked[i]) continue
    prevLocked[i] = locked
    const btn = document.getElementById(`tab-${i}`)
    if (!btn) continue
    btn.classList.toggle('locked', locked)
    btn.textContent = locked ? '🔒' : p.icon
    btn.setAttribute('title', `${p.label}${locked ? ' — Locked' : ''}`)
    if (locked) btn.setAttribute('aria-disabled', 'true')
    else btn.removeAttribute('aria-disabled')
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

  const panel = panels[activeIndex]
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
  const panel = panels[activeIndex]
  panel?.update?.(state)
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
