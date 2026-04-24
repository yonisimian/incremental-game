/**
 * Shockwave VFX — cohesive "energy nova" erupting from a focal point.
 *
 * Colors shift dynamically as layers expand (white → cyan → gold → magenta).
 *
 * Visual narrative (center → outward, fast → slow):
 * 1. Core flash — bright origin point with color sweep
 * 2. Expanding ring — thick ring that shifts color as it grows
 * 3. Radial streaks — elongated energy rays with individual color cycles
 * 4. Soft glow — large diffuse pulse with color progression
 * 5. Popup text — celebratory label (appears after flash clears)
 */

import { hasDom, getLayer, shakeScreen } from './shared.js'

/**
 * Spawn a full shockwave effect centered on the click button.
 * @param label - Text displayed in the popup (e.g., "100!", "200!")
 */
export function shockwave(label: string): void {
  if (!hasDom()) return
  const btn = document.getElementById('click-btn')
  if (!btn) return

  const rect = btn.getBoundingClientRect()
  const cx = rect.left + rect.width / 2
  const cy = rect.top + rect.height / 2
  const vfx = getLayer()

  // ── Layer 1: Core flash (the origin everything radiates from) ─
  const coreSize = 60
  const core = document.createElement('div')
  core.className = 'vfx-shockwave-core'
  core.style.left = `${cx - coreSize / 2}px`
  core.style.top = `${cy - coreSize / 2}px`
  vfx.appendChild(core)

  core.animate(
    [
      { transform: 'scale(0)', opacity: 0, filter: 'hue-rotate(0deg) brightness(2)' },
      { transform: 'scale(1)', opacity: 1, filter: 'hue-rotate(0deg) brightness(2)', offset: 0.1 },
      {
        transform: 'scale(2.5)',
        opacity: 0.9,
        filter: 'hue-rotate(40deg) brightness(1.5)',
        offset: 0.3,
      },
      { transform: 'scale(4)', opacity: 0, filter: 'hue-rotate(90deg) brightness(1)' },
    ],
    { duration: 500, easing: 'ease-out', fill: 'forwards' },
  ).onfinish = () => {
    core.remove()
  }

  // ── Layer 2: Expanding ring (color shifts as it grows) ────────
  const ringSize = 200
  const ring = document.createElement('div')
  ring.className = 'vfx-shockwave-ring'
  ring.style.left = `${cx - ringSize / 2}px`
  ring.style.top = `${cy - ringSize / 2}px`
  vfx.appendChild(ring)

  ring.animate(
    [
      { transform: 'scale(0)', opacity: 1, filter: 'hue-rotate(0deg)' },
      { transform: 'scale(1.2)', opacity: 0.8, filter: 'hue-rotate(60deg)', offset: 0.3 },
      { transform: 'scale(2)', opacity: 0.5, filter: 'hue-rotate(140deg)', offset: 0.65 },
      { transform: 'scale(3)', opacity: 0, filter: 'hue-rotate(200deg)' },
    ],
    { duration: 700, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'both', delay: 40 },
  ).onfinish = () => {
    ring.remove()
  }

  // ── Layer 3: Radial streaks (elongated energy rays) ───────────
  const streakCount = 12 + Math.floor(Math.random() * 4)
  for (let i = 0; i < streakCount; i++) {
    const streak = document.createElement('div')
    streak.className = 'vfx-streak'

    const angle = (Math.PI * 2 * i) / streakCount + (Math.random() - 0.5) * 0.4
    const dist = 100 + Math.random() * 100
    // Orient streak along its travel direction
    const deg = (angle * 180) / Math.PI + 90
    const len = 12 + Math.random() * 16

    streak.style.width = '3px'
    streak.style.height = `${len}px`
    streak.style.left = `${cx - 1.5}px`
    streak.style.top = `${cy - len / 2}px`

    // Alternate accent / gold for subtle color variety within a unified palette
    if (i % 3 === 0) streak.style.background = 'var(--gold)'

    vfx.appendChild(streak)

    // Each streak gets a random hue offset so the spray is multicolored
    const hueStart = Math.floor(Math.random() * 60)
    const hueEnd = hueStart + 120 + Math.floor(Math.random() * 80)
    const hueMid = (hueStart + hueEnd) / 2
    const rot = `rotate(${deg}deg)`
    const stagger = 30 + Math.random() * 80

    const streakFrames: Keyframe[] = [
      {
        transform: `${rot} translate(0, 0) scaleY(0.3)`,
        opacity: 1,
        filter: `hue-rotate(${hueStart}deg)`,
      },
      {
        transform: `${rot} translate(0, -${dist * 0.4}px) scaleY(1)`,
        opacity: 0.9,
        filter: `hue-rotate(${hueMid}deg)`,
        offset: 0.25,
      },
      {
        transform: `${rot} translate(0, -${dist}px) scaleY(0.5)`,
        opacity: 0,
        filter: `hue-rotate(${hueEnd}deg)`,
      },
    ]

    streak.animate(streakFrames, {
      duration: 450 + Math.random() * 200,
      easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
      fill: 'both',
      delay: stagger,
    }).onfinish = () => {
      streak.remove()
    }
  }

  // ── Layer 4: Soft glow (diffuse energy behind everything) ─────
  const glowSize = 300
  const glow = document.createElement('div')
  glow.className = 'vfx-shockwave-glow'
  glow.style.left = `${cx - glowSize / 2}px`
  glow.style.top = `${cy - glowSize / 2}px`
  vfx.appendChild(glow)

  glow.animate(
    [
      { transform: 'scale(0.5)', opacity: 0, filter: 'hue-rotate(0deg)' },
      { transform: 'scale(1)', opacity: 0.6, filter: 'hue-rotate(30deg)', offset: 0.15 },
      { transform: 'scale(1.8)', opacity: 0.3, filter: 'hue-rotate(100deg)', offset: 0.5 },
      { transform: 'scale(2.5)', opacity: 0, filter: 'hue-rotate(180deg)' },
    ],
    { duration: 800, easing: 'ease-out', fill: 'forwards' },
  ).onfinish = () => {
    glow.remove()
  }

  // ── Layer 5: Popup text (delayed until flash clears) ──────────
  const popup = document.createElement('div')
  popup.className = 'vfx-shockwave-text'
  popup.textContent = label
  popup.style.left = `${cx}px`
  popup.style.top = `${rect.top - 20}px`
  vfx.appendChild(popup)

  popup.animate(
    [
      { transform: 'translate(-50%, 0) scale(0.5)', opacity: 0 },
      { transform: 'translate(-50%, 0) scale(1.3)', opacity: 1, offset: 0.2 },
      { transform: 'translate(-50%, -40px) scale(1)', opacity: 1, offset: 0.6 },
      { transform: 'translate(-50%, -70px) scale(0.8)', opacity: 0 },
    ],
    { duration: 1200, easing: 'ease-out', fill: 'both', delay: 200 },
  ).onfinish = () => {
    popup.remove()
  }

  // Screen shake — immediate
  shakeScreen('heavy')
}
