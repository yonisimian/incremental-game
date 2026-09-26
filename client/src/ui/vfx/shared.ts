/** Returns false in test environments where no DOM exists. */
export function hasDom(): boolean {
  return typeof document !== 'undefined'
}

/** Overlay container for floating effects. Created lazily, never removed. */
let layer: HTMLDivElement | null = null

export function getLayer(): HTMLDivElement {
  if (!layer) {
    layer = document.createElement('div')
    layer.className = 'vfx-layer'
    document.body.appendChild(layer)
  }
  return layer
}

/** Whether the user asked the OS to minimise motion. WAAPI ignores the CSS media query. */
export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

// ─── Screen Shake ────────────────────────────────────────────────────

/**
 * Quick micro-shake of the playing screen. Intensity scales with magnitude.
 */
export function shakeScreen(intensity: 'light' | 'medium' | 'heavy' = 'light'): void {
  if (!hasDom() || prefersReducedMotion()) return
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
