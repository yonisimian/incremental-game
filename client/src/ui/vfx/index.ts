/**
 * Visual effects module — all GPU-accelerated via the Web Animations API.
 * No canvas, no libraries; just DOM elements + WAAPI.
 */

import { hasDom, getLayer } from './shared.js'
import { formatNumber } from '../format-number.js'

// Re-export shared utilities used by external consumers
export { shakeScreen } from './shared.js'

// Re-export the toast overlay
export { spawnToast } from './toast.js'
export type { ToastHandle } from './toast.js'

/**
 * Resolve the click button to anchor an effect to: the one with `anchorId` if
 * present, otherwise the first click card.
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

  const size = rect.width
  el.style.width = `${size}px`
  el.style.height = `${size}px`
  el.style.left = `${rect.left + rect.width / 2 - size / 2}px`
  el.style.top = `${rect.top + rect.height / 2 - size / 2}px`

  getLayer().appendChild(el)

  el.animate(
    [
      { transform: 'scale(0.4)', opacity: 0.7 },
      { transform: 'scale(1.3)', opacity: 0 },
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
