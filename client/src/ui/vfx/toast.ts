/**
 * Notification toasts — transient banners announcing game events.
 *
 * A standalone overlay mechanism (not tied to the click/combo/shockwave VFX):
 * toasts stack downward from the top of the panel region, tint by severity, and
 * fade out. Purely cosmetic, no state. GPU-accelerated via the Web Animations
 * API; the dismiss uses a FLIP transform so the stack glides rather than jumps.
 */

import { hasDom, getLayer } from './shared.js'

/** Severity of a toast — tints the border/text. */
export type ToastVariant = 'info' | 'success' | 'warning' | 'danger'

/** Optional per-toast overrides. */
export interface ToastOptions {
  /** Leading icon (emoji), prepended to the text. */
  icon?: string
  /** Auto-dismiss delay in ms. Defaults to {@link TOAST_DEFAULT_MS}. */
  durationMs?: number
}

const TOAST_DEFAULT_MS = 2500
/** Soft cap on visible toasts — a flurry evicts the oldest instead of walling the screen. */
const TOAST_MAX_VISIBLE = 4

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
 * spawn past the cap evicts the oldest first.
 */
export function spawnToast(text: string, variant: ToastVariant, opts?: ToastOptions): void {
  if (!hasDom()) return
  const layer = toastLayer()

  // Evict oldest until under the cap so a burst can't build a wall of banners.
  while (layer.querySelectorAll('.toast').length >= TOAST_MAX_VISIBLE) {
    const oldest = layer.querySelector<HTMLElement>('.toast')
    if (!oldest) break
    removeToast(oldest)
  }

  const el = document.createElement('div')
  el.className = `toast toast--${variant}`
  el.textContent = opts?.icon ? `${opts.icon} ${text}` : text
  layer.appendChild(el)

  el.animate(
    [
      { transform: 'translateY(-12px)', opacity: 0 },
      { transform: 'translateY(0)', opacity: 1, offset: 0.12 },
      { transform: 'translateY(0)', opacity: 1, offset: 0.82 },
      { transform: 'translateY(-8px)', opacity: 0 },
    ],
    { duration: opts?.durationMs ?? TOAST_DEFAULT_MS, easing: 'ease-out', fill: 'forwards' },
  ).onfinish = () => {
    removeToast(el)
  }
}

/**
 * Remove a toast and glide the ones below it up into place with a FLIP
 * (First-Last-Invert-Play) transform, so the stack slides smoothly instead of
 * snapping when a banner leaves the flex column.
 */
function removeToast(el: HTMLElement): void {
  const layer = el.parentElement
  if (!layer) {
    el.remove()
    return
  }

  // First: record each toast's position before the layout changes.
  const survivors = Array.from(layer.querySelectorAll<HTMLElement>('.toast')).filter(
    (t) => t !== el,
  )
  const beforeTop = new Map<HTMLElement, number>()
  for (const t of survivors) beforeTop.set(t, t.offsetTop)

  el.remove()

  // Last + Invert + Play: start each survivor at its old offset and animate the
  // delta back to zero, so nothing ever jumps to its new position.
  for (const t of survivors) {
    const delta = (beforeTop.get(t) ?? 0) - t.offsetTop
    if (delta === 0) continue
    t.animate([{ transform: `translateY(${delta}px)` }, { transform: 'translateY(0)' }], {
      duration: 750,
      easing: 'ease-out',
    })
  }
}
