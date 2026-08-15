/**
 * Visual effects module — all GPU-accelerated via the Web Animations API.
 * No canvas, no libraries; just DOM elements + WAAPI.
 */

import { hasDom, getLayer } from './shared.js'
import { formatNumber } from '../format-number.js'

// Re-export shared utilities used by external consumers
export { shakeScreen } from './shared.js'

// Re-export the shockwave effect
export { shockwave } from './shockwave.js'

/**
 * Resolve the click button to anchor an effect to: the one with `anchorId` if
 * present, otherwise the first click card (covers score-milestone effects that
 * aren't tied to a specific button).
 */
function resolveClickButton(anchorId?: string): HTMLElement | null {
  return (
    (anchorId ? document.getElementById(anchorId) : null) ??
    document.querySelector<HTMLElement>('.click-card')
  )
}

// ─── Click Popup (+1, +2, etc.) ──────────────────────────────────────

/**
 * Spawn a floating "+N" text that drifts up and fades out from the click button.
 * Uses randomized horizontal offset for visual variety.
 */
export function spawnClickPopup(income: number, anchorId?: string): void {
  if (!hasDom()) return
  const btn = resolveClickButton(anchorId)
  if (!btn) return

  const rect = btn.getBoundingClientRect()
  const el = document.createElement('span')
  el.className = 'vfx-popup'
  // Show up to 2 decimals for fractional gains (avoids float noise like
  // 7.260000000000002), but keep whole-number gains clean ("+1", not "+1.00").
  const isWhole = Math.abs(income - Math.round(income)) < 1e-9
  el.textContent = `+${formatNumber(income, isWhole ? 0 : 2)}`

  // Position above the button center with random horizontal jitter
  const jitterX = (Math.random() - 0.5) * 80
  el.style.left = `${rect.left + rect.width / 2 + jitterX}px`
  el.style.top = `${rect.top - 10}px`

  getLayer().appendChild(el)

  el.animate(
    [
      { transform: 'translateY(0) scale(1.2)', opacity: 1 },
      { transform: 'translateY(-60px) scale(1.4)', opacity: 0.9, offset: 0.25 },
      { transform: 'translateY(-120px) scale(0.9)', opacity: 0 },
    ],
    { duration: 800, easing: 'ease-out', fill: 'forwards' },
  ).onfinish = () => {
    el.remove()
  }
}

// ─── Click Ripple ────────────────────────────────────────────────────

/**
 * Expanding ring ripple from the center of the click button.
 */
export function spawnClickRipple(anchorId?: string): void {
  if (!hasDom()) return
  const btn = resolveClickButton(anchorId)
  if (!btn) return

  const rect = btn.getBoundingClientRect()
  const el = document.createElement('div')
  el.className = 'vfx-ripple'

  const size = rect.width * 1.2
  el.style.width = `${size}px`
  el.style.height = `${size}px`
  el.style.left = `${rect.left + rect.width / 2 - size / 2}px`
  el.style.top = `${rect.top + rect.height / 2 - size / 2}px`

  getLayer().appendChild(el)

  el.animate(
    [
      { transform: 'scale(0.3)', opacity: 0.8 },
      { transform: 'scale(2)', opacity: 0 },
    ],
    { duration: 500, easing: 'ease-out', fill: 'forwards' },
  ).onfinish = () => {
    el.remove()
  }
}

// ─── Button Pulse ────────────────────────────────────────────────────

/**
 * Punchy scale pulse on the click button — squash on press, bounce on release.
 */
export function pulseClickButton(anchorId?: string): void {
  if (!hasDom()) return
  const btn = resolveClickButton(anchorId)
  if (!btn) return

  btn.animate(
    [
      { transform: 'scale(1)', boxShadow: '0 0 0px var(--accent)' },
      { transform: 'scale(0.88)', boxShadow: '0 0 0px var(--accent)', offset: 0.15 },
      { transform: 'scale(1.08)', boxShadow: '0 0 24px var(--accent)', offset: 0.5 },
      { transform: 'scale(1)', boxShadow: '0 0 0px var(--accent)' },
    ],
    { duration: 250, easing: 'ease-out' },
  )
}

// ─── Purchase Flash ──────────────────────────────────────────────────

/**
 * Flash + glow on the purchased upgrade button, then a brief screen shake.
 */
export function flashPurchase(upgradeId: string): void {
  if (!hasDom()) return
  const btn = document.querySelector<HTMLButtonElement>(`.upgrade-btn[data-upgrade="${upgradeId}"]`)
  if (!btn) return

  // Bright flash overlay
  btn.animate(
    [
      { boxShadow: '0 0 0px var(--accent)', filter: 'brightness(1)' },
      {
        boxShadow: '0 0 30px var(--accent), 0 0 60px var(--accent)',
        filter: 'brightness(2)',
        offset: 0.2,
      },
      { boxShadow: '0 0 8px var(--accent)', filter: 'brightness(1.2)', offset: 0.6 },
      { boxShadow: '0 0 0px var(--accent)', filter: 'brightness(1)' },
    ],
    { duration: 600, easing: 'ease-out' },
  )

  // Also flash the resource bar briefly
  const currencyBar =
    document.getElementById('resource-bar') ??
    document.getElementById('wood-balance')?.parentElement
  if (currencyBar) {
    currencyBar.animate(
      [{ color: 'var(--gold)' }, { color: 'var(--danger)', offset: 0.3 }, { color: 'var(--gold)' }],
      { duration: 400, easing: 'ease-out' },
    )
  }
}

// ─── Toasts ──────────────────────────────────────────────────────────

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

// ─── Combo Counter ───────────────────────────────────────────────────

let comboCount = 0
let comboTimer: ReturnType<typeof setTimeout> | null = null
const COMBO_WINDOW_MS = 500

/**
 * Track rapid clicks and show a combo indicator.
 * Returns the current combo count after this click.
 */
export function trackCombo(): number {
  comboCount++

  if (comboTimer) clearTimeout(comboTimer)
  comboTimer = setTimeout(() => {
    hideCombo()
    comboCount = 0
  }, COMBO_WINDOW_MS)

  if (comboCount >= 3) {
    showCombo(comboCount)
  }

  return comboCount
}

/** Reset combo (e.g., on screen change). */
export function resetCombo(): void {
  comboCount = 0
  if (comboTimer) {
    clearTimeout(comboTimer)
    comboTimer = null
  }
  hideCombo()
}

/** Half-life constant — combo reaches 50% intensity at count 3 + K. */
const COMBO_HALF_LIFE = 12

/** Continuous intensity: 0 at combo 3, approaches 1 asymptotically. */
function comboIntensity(count: number): number {
  const n = Math.max(count - 3, 0)
  return n / (n + COMBO_HALF_LIFE)
}

function showCombo(count: number): void {
  if (!hasDom()) return
  let el = document.getElementById('vfx-combo')
  if (!el) {
    el = document.createElement('div')
    el.id = 'vfx-combo'
    el.className = 'vfx-combo'
    getLayer().appendChild(el)
  }

  // Position near the click button
  const btn = resolveClickButton()
  if (btn) {
    const rect = btn.getBoundingClientRect()
    el.style.left = `${rect.right + 12}px`
    el.style.top = `${rect.top + rect.height / 2}px`
  }

  el.textContent = `${count}× combo!`
  el.style.display = 'block'

  // ── Continuous intensity (0 → 1 asymptotically) ─────────────
  const t = comboIntensity(count)

  // Color: cyan (190°) → red (0°), increasingly vivid
  const hue = Math.round(190 * (1 - t))
  const sat = Math.round(80 + 20 * t)
  const lit = Math.round(65 - 10 * t)
  el.style.color = `hsl(${hue}, ${sat}%, ${lit}%)`

  // Glow: color-matched, radius grows with intensity
  const glowAlpha = 0.2 + 0.3 * t
  const glowSpread = Math.round(6 + 10 * t)
  el.style.textShadow =
    `0 0 ${glowSpread}px hsla(${hue}, ${sat}%, ${lit}%, ${glowAlpha.toFixed(2)}), ` +
    `0 0 ${glowSpread * 2}px hsla(${hue}, ${sat}%, ${lit}%, ${(glowAlpha * 0.5).toFixed(2)})`

  // Scale: base grows with t, pop animation overshoots then settles
  const base = 1 + 0.25 * t
  const pop = base * 1.2
  el.animate(
    [
      { transform: `translateY(-50%) scale(${pop.toFixed(2)})`, opacity: 1 },
      { transform: `translateY(-50%) scale(${base.toFixed(2)})`, opacity: 1 },
    ],
    { duration: 150, easing: 'ease-out', fill: 'forwards' },
  )
}

function hideCombo(): void {
  if (!hasDom()) return
  const el = document.getElementById('vfx-combo')
  if (el) {
    el.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: 200,
      fill: 'forwards',
    }).onfinish = () => {
      el.style.display = 'none'
    }
  }
}

// ─── Score Bump ──────────────────────────────────────────────────────

/**
 * Quick scale-bump on a score element when it changes.
 */
export function bumpScore(elementId: string): void {
  if (!hasDom()) return
  const el = document.getElementById(elementId)
  if (!el) return

  el.animate(
    [
      { transform: 'scale(1.3)', color: 'var(--gold)' },
      { transform: 'scale(1)', color: '' },
    ],
    { duration: 300, easing: 'ease-out' },
  )
}
