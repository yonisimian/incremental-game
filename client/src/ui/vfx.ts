/**
 * Visual effects module — all GPU-accelerated via the Web Animations API.
 * No canvas, no libraries; just DOM elements + WAAPI.
 */

import type { UpgradeId } from '@game/shared'

// ─── Environment Guard ───────────────────────────────────────────────

/** Returns false in test environments where no DOM exists. */
function hasDom(): boolean {
  return typeof document !== 'undefined'
}

// ─── VFX Layer ───────────────────────────────────────────────────────

/** Overlay container for floating effects. Created lazily, never removed. */
let layer: HTMLDivElement | null = null

function getLayer(): HTMLDivElement {
  if (!layer) {
    layer = document.createElement('div')
    layer.className = 'vfx-layer'
    document.body.appendChild(layer)
  }
  return layer
}

// ─── Click Popup (+1, +2, etc.) ──────────────────────────────────────

/**
 * Spawn a floating "+N" text that drifts up and fades out from the click button.
 * Uses randomized horizontal offset for visual variety.
 */
export function spawnClickPopup(income: number): void {
  if (!hasDom()) return
  const btn = document.getElementById('click-btn')
  if (!btn) return

  const rect = btn.getBoundingClientRect()
  const el = document.createElement('span')
  el.className = 'vfx-popup'
  el.textContent = `+${income}`

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
export function spawnClickRipple(): void {
  if (!hasDom()) return
  const btn = document.getElementById('click-btn')
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
export function pulseClickButton(): void {
  if (!hasDom()) return
  const btn = document.getElementById('click-btn')
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
export function flashPurchase(upgradeId: UpgradeId): void {
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

  // Also flash the currency bar briefly
  const currencyBar =
    document.getElementById('currency-bar') ??
    document.getElementById('wood-balance')?.parentElement
  if (currencyBar) {
    currencyBar.animate(
      [{ color: 'var(--gold)' }, { color: 'var(--danger)', offset: 0.3 }, { color: 'var(--gold)' }],
      { duration: 400, easing: 'ease-out' },
    )
  }
}

// ─── Screen Shake ────────────────────────────────────────────────────

/**
 * Quick micro-shake of the playing screen. Intensity scales with magnitude.
 */
export function shakeScreen(intensity: 'light' | 'medium' | 'heavy' = 'light'): void {
  if (!hasDom()) return
  const screen = document.querySelector<HTMLElement>('.playing-screen')
  if (!screen) return

  const px = intensity === 'heavy' ? 8 : intensity === 'medium' ? 5 : 3

  screen.animate(
    [
      { transform: 'translate(0, 0)' },
      { transform: `translate(${px}px, -${px * 0.6}px)` },
      { transform: `translate(-${px}px, ${px * 0.4}px)` },
      { transform: `translate(${px * 0.6}px, -${px * 0.3}px)` },
      { transform: `translate(-${px * 0.3}px, ${px * 0.15}px)` },
      { transform: 'translate(0, 0)' },
    ],
    { duration: intensity === 'heavy' ? 500 : 300, easing: 'ease-out' },
  )
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
  const btn = document.getElementById('click-btn')
  if (btn) {
    const rect = btn.getBoundingClientRect()
    el.style.left = `${rect.right + 12}px`
    el.style.top = `${rect.top + rect.height / 2}px`
  }

  el.textContent = `${count}× combo!`
  el.style.display = 'block'

  // Scale-pop on each increment
  el.animate(
    [
      { transform: 'translateY(-50%) scale(1.3)', opacity: 1 },
      { transform: 'translateY(-50%) scale(1)', opacity: 1 },
    ],
    { duration: 150, easing: 'ease-out', fill: 'forwards' },
  )

  // Bigger combos get more intense color
  if (count >= 15) {
    el.style.color = 'var(--gold)'
  } else if (count >= 8) {
    el.style.color = 'var(--success)'
  } else {
    el.style.color = 'var(--accent)'
  }
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

// ─── Milestone Celebration ───────────────────────────────────────────

/**
 * Brief full-screen flash for hitting a milestone (e.g., target-score reached).
 */
export function celebrateMilestone(): void {
  if (!hasDom()) return
  const el = document.createElement('div')
  el.className = 'vfx-milestone-flash'
  getLayer().appendChild(el)

  el.animate([{ opacity: 0.4 }, { opacity: 0 }], {
    duration: 600,
    easing: 'ease-out',
    fill: 'forwards',
  }).onfinish = () => {
    el.remove()
  }
}
