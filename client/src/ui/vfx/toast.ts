/**
 * Notification toasts — transient banners announcing game events.
 *
 * A standalone overlay mechanism (not tied to the click/combo/shockwave VFX):
 * toasts stack downward from the top of the panel region (or, on wide screens,
 * the gutter beside it), tint by severity, and fade out. GPU-accelerated via the
 * Web Animations API; on dismiss each toast's clipping slot collapses its height,
 * so document flow slides the rest of the stack up together.
 *
 * Where the layer takes the pointer (the wide-screen gutter — see style.css),
 * hovering pauses every timer in the stack and clicking a toast dismisses it.
 * Where it doesn't, those listeners simply never fire.
 */

import { hasDom, getLayer, prefersReducedMotion } from './shared.js'

/** Severity of a toast — tints the border/text. */
export type ToastVariant = 'info' | 'success' | 'warning' | 'danger'

/** Optional per-toast overrides. */
export interface ToastOptions {
  /** Leading icon (emoji), set in its own column before the text. */
  icon?: string
  /**
   * Stay until the caller dismisses it: no auto-dismiss timer, and never evicted
   * by the visible-stack cap — for a notification tied to something still in
   * progress (an inbound attack).
   */
  sticky?: boolean
}

/** A live toast, for the caller of a sticky one to rewrite or dismiss. */
export interface ToastHandle {
  /** Replace the banner's text (the icon, if any, is kept). */
  update(text: string): void
  /** Fade the toast out; a no-op once it is already leaving. */
  dismiss(): void
}

/** The handle returned when there is no DOM to toast into. */
const NO_TOAST: ToastHandle = { update: () => undefined, dismiss: () => undefined }

/** Auto-dismiss delay by severity: bad news is actionable, so it stays longer. */
const TOAST_DURATION_MS: Record<ToastVariant, number> = {
  info: 3000,
  success: 3500,
  warning: 4500,
  danger: 5000,
}
/** Least time a toast gets after the pointer leaves, so it doesn't vanish on the spot. */
const TOAST_RESUME_MIN_MS = 1000
/** Soft cap on visible toasts — a flurry evicts the oldest instead of walling the screen. */
const TOAST_MAX_VISIBLE = 4
/** Entrance slide/expand duration. */
const TOAST_ENTER_MS = 180
/** Exit fade/collapse duration. */
const TOAST_EXIT_MS = 260

interface LayerState {
  paused: boolean
}

interface SlotState {
  /** Time left on the dismiss timer; `null` for a sticky toast, which has none. */
  remainingMs: number | null
  startedAt: number
  timeoutId: ReturnType<typeof setTimeout> | undefined
  /** This toast's node in the screen-reader announcer, if one is mounted. */
  announcement: HTMLElement | null
}

/** Keyed per layer element: the play screen re-creates `#toast-layer` every match. */
const layers = new WeakMap<HTMLElement, LayerState>()
const slots = new WeakMap<HTMLElement, SlotState>()

/**
 * The overlay toasts append to: the play screen's `#toast-layer` (positioned over
 * the panel container) when present, else the global VFX layer as a fallback for
 * tests and non-play screens.
 */
function toastLayer(): HTMLElement {
  return document.getElementById('toast-layer') ?? getLayer()
}

/** The layer's state, binding its hover-pause and click-dismiss listeners on first use. */
function layerState(layer: HTMLElement): LayerState {
  const existing = layers.get(layer)
  if (existing) return existing
  const state: LayerState = { paused: false }
  layers.set(layer, state)
  layer.addEventListener('pointerenter', () => {
    state.paused = true
    for (const slot of layer.querySelectorAll<HTMLElement>('.toast-slot')) pauseTimer(slot)
  })
  layer.addEventListener('pointerleave', () => {
    state.paused = false
    for (const slot of layer.querySelectorAll<HTMLElement>('.toast-slot')) resumeTimer(slot)
  })
  layer.addEventListener('click', (e) => {
    const slot = (e.target as Element).closest('.toast')?.parentElement
    if (slot && layer.contains(slot)) removeToast(slot)
  })
  return state
}

function startTimer(slot: HTMLElement, state: SlotState): void {
  state.startedAt = Date.now()
  state.timeoutId = setTimeout(() => {
    removeToast(slot)
  }, state.remainingMs ?? 0)
}

function pauseTimer(slot: HTMLElement): void {
  const state = slots.get(slot)
  if (state?.timeoutId === undefined) return
  clearTimeout(state.timeoutId)
  state.timeoutId = undefined
  if (state.remainingMs !== null) state.remainingMs -= Date.now() - state.startedAt
}

function resumeTimer(slot: HTMLElement): void {
  const state = slots.get(slot)
  if (state === undefined) return
  if (state.remainingMs === null || state.timeoutId !== undefined || slot.dataset.removing) return
  state.remainingMs = Math.max(state.remainingMs, TOAST_RESUME_MIN_MS)
  startTimer(slot, state)
}

/** Append `text` to the screen-reader announcer, when the play screen mounted one. */
function announce(text: string): HTMLElement | null {
  const announcer = document.getElementById('toast-announcer')
  if (!announcer) return null
  const node = document.createElement('div')
  node.textContent = text
  announcer.appendChild(node)
  return node
}

/**
 * Transient banner announcing a game event. Toasts stack downward from the top of
 * the layer and fade out after a severity-dependent delay. `variant` tints the
 * border/text. The visible stack is soft-capped at {@link TOAST_MAX_VISIBLE}: a
 * spawn past the cap evicts the oldest non-sticky toast first (sticky ones may
 * push the stack past the cap rather than vanish early). Sticky toasts sit at the
 * head of the stack, so they hold still while transient ones churn below.
 *
 * Each toast lives in a clipping slot (`.toast-slot`, `overflow: hidden`) whose
 * height animates. On exit the slot collapses to zero and normal document flow
 * slides every toast below it up together — smooth group motion with no
 * per-element bookkeeping, and no content squish since the toast keeps its full
 * size inside the shrinking slot.
 */
export function spawnToast(text: string, variant: ToastVariant, opts?: ToastOptions): ToastHandle {
  if (!hasDom()) return NO_TOAST
  const layer = toastLayer()
  const layerPaused = layerState(layer).paused

  // Evict oldest until under the cap so a burst can't build a wall of banners.
  // Match only slots not already collapsing: removeToast defers the actual
  // node removal to an animation callback, so a removing slot lingers in the
  // DOM — counting it would spin this loop forever (it can never be re-removed).
  const evictable = '.toast-slot:not([data-removing]):not([data-sticky])'
  while (layer.querySelectorAll('.toast-slot:not([data-removing])').length >= TOAST_MAX_VISIBLE) {
    const oldest = layer.querySelector<HTMLElement>(evictable)
    if (!oldest) break
    removeToast(oldest)
  }

  const slot = document.createElement('div')
  slot.className = 'toast-slot'
  if (opts?.sticky) slot.dataset.sticky = 'true'
  const el = document.createElement('div')
  el.className = `toast toast--${variant}`
  if (opts?.icon) {
    const icon = document.createElement('span')
    icon.className = 'toast-icon'
    icon.textContent = opts.icon
    el.appendChild(icon)
  }
  const textEl = document.createElement('span')
  textEl.className = 'toast-text'
  textEl.textContent = text
  el.appendChild(textEl)
  slot.appendChild(el)
  const firstTransient = opts?.sticky
    ? layer.querySelector<HTMLElement>('.toast-slot:not([data-sticky])')
    : null
  layer.insertBefore(slot, firstTransient)

  const reduced = prefersReducedMotion()
  // Entrance: fade/slide the banner in. The slot takes its natural height
  // immediately; the toasts below simply appear in place.
  el.animate(
    reduced
      ? [{ opacity: 0 }, { opacity: 1 }]
      : [
          { opacity: 0, transform: 'translateY(-6px)' },
          { opacity: 1, transform: 'translateY(0)' },
        ],
    { duration: TOAST_ENTER_MS, easing: 'ease-out' },
  )

  const state: SlotState = {
    remainingMs: opts?.sticky ? null : TOAST_DURATION_MS[variant],
    startedAt: 0,
    timeoutId: undefined,
    announcement: announce(opts?.icon ? `${opts.icon} ${text}` : text),
  }
  slots.set(slot, state)
  if (!opts?.sticky && !layerPaused) startTimer(slot, state)

  return {
    // Visual only: the announcer keeps the arrival text, so a countdown isn't re-read.
    update: (next) => {
      textEl.textContent = next
    },
    dismiss: () => {
      removeToast(slot)
    },
  }
}

/**
 * Dismiss a toast: fade/slide the banner out and collapse its slot to zero
 * height. Flow reclaims the space, so every toast below slides up in unison.
 * Under reduced motion it only fades, and the stack closes up without sliding.
 * Idempotent — the cap-eviction, the auto-dismiss timer, a click and the
 * caller's handle can all target the same slot; the first call wins.
 */
function removeToast(slot: HTMLElement): void {
  if (slot.dataset.removing) return
  slot.dataset.removing = 'true'

  const state = slots.get(slot)
  if (state) {
    clearTimeout(state.timeoutId)
    state.announcement?.remove()
  }

  const finish = (): void => {
    const layer = slot.parentElement
    slot.remove()
    // A stack that empties under a still cursor may never see `pointerleave`.
    const emptied = layer && !layer.querySelector('.toast-slot') ? layers.get(layer) : undefined
    if (emptied) emptied.paused = false
  }

  const reduced = prefersReducedMotion()
  const el = slot.firstElementChild as HTMLElement
  const fade = el.animate(
    reduced
      ? [{ opacity: 1 }, { opacity: 0 }]
      : [
          { opacity: 1, transform: 'translateY(0)' },
          { opacity: 0, transform: 'translateY(-8px)' },
        ],
    { duration: TOAST_EXIT_MS, easing: 'ease-in', fill: 'forwards' },
  )
  if (reduced) {
    fade.onfinish = finish
    return
  }
  slot.animate([{ height: `${slot.offsetHeight}px` }, { height: '0px' }], {
    duration: TOAST_EXIT_MS,
    easing: 'ease-in',
    fill: 'forwards',
  }).onfinish = finish
}
