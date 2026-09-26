/**
 * Notification toasts — transient banners announcing game events.
 *
 * A standalone overlay mechanism (not tied to the click/combo/shockwave VFX):
 * toasts stack downward from the top of the panel region, tint by severity, and
 * fade out. Purely cosmetic, no state. GPU-accelerated via the Web Animations
 * API; on dismiss each toast's clipping slot collapses its height, so document
 * flow slides the rest of the stack up together.
 */

import { hasDom, getLayer } from './shared.js'

/** Severity of a toast — tints the border/text. */
export type ToastVariant = 'info' | 'success' | 'warning' | 'danger'

/** Optional per-toast overrides. */
export interface ToastOptions {
  /** Leading icon (emoji), prepended to the text. */
  icon?: string
  /** Auto-dismiss delay in ms. Defaults to {@link TOAST_DEFAULT_MS}. Ignored when `sticky`. */
  durationMs?: number
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

const TOAST_DEFAULT_MS = 2500
/** Soft cap on visible toasts — a flurry evicts the oldest instead of walling the screen. */
const TOAST_MAX_VISIBLE = 4
/** Entrance slide/expand duration. */
const TOAST_ENTER_MS = 180
/** Exit fade/collapse duration. */
const TOAST_EXIT_MS = 260

/**
 * The overlay toasts append to: the play screen's `#toast-layer` (positioned over
 * the panel container) when present, else the global VFX layer as a fallback for
 * tests and non-play screens.
 */
function toastLayer(): HTMLElement {
  return document.getElementById('toast-layer') ?? getLayer()
}

/**
 * Transient banner announcing a game event. Toasts stack downward from the top of
 * the panel region and fade out; purely cosmetic, no state. `variant` tints the
 * border/text. The visible stack is soft-capped at {@link TOAST_MAX_VISIBLE}: a
 * spawn past the cap evicts the oldest non-sticky toast first (sticky ones may
 * push the stack past the cap rather than vanish early).
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
  const render = (t: string): string => (opts?.icon ? `${opts.icon} ${t}` : t)
  el.textContent = render(text)
  slot.appendChild(el)
  layer.appendChild(slot)

  // Entrance: fade/slide the banner in. The slot takes its natural height
  // immediately; the toasts below simply appear in place.
  el.animate(
    [
      { opacity: 0, transform: 'translateY(-6px)' },
      { opacity: 1, transform: 'translateY(0)' },
    ],
    { duration: TOAST_ENTER_MS, easing: 'ease-out' },
  )

  if (!opts?.sticky) {
    setTimeout(() => {
      removeToast(slot)
    }, opts?.durationMs ?? TOAST_DEFAULT_MS)
  }

  return {
    update: (next) => {
      el.textContent = render(next)
    },
    dismiss: () => {
      removeToast(slot)
    },
  }
}

/**
 * Dismiss a toast: fade/slide the banner out and collapse its slot to zero
 * height. Flow reclaims the space, so every toast below slides up in unison.
 * Idempotent — the cap-eviction and the auto-dismiss timer can both target the
 * same slot, so the first call wins and later calls are no-ops.
 */
function removeToast(slot: HTMLElement): void {
  if (slot.dataset.removing) return
  slot.dataset.removing = 'true'

  const el = slot.firstElementChild as HTMLElement | null
  el?.animate(
    [
      { opacity: 1, transform: 'translateY(0)' },
      { opacity: 0, transform: 'translateY(-8px)' },
    ],
    { duration: TOAST_EXIT_MS, easing: 'ease-in', fill: 'forwards' },
  )
  slot.animate([{ height: `${slot.offsetHeight}px` }, { height: '0px' }], {
    duration: TOAST_EXIT_MS,
    easing: 'ease-in',
    fill: 'forwards',
  }).onfinish = () => {
    slot.remove()
  }
}
