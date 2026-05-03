/**
 * Dev-mode performance overlay.
 *
 * Shows three metrics in a small fixed badge:
 *  - **FPS** — browser paint rate (via requestAnimationFrame)
 *  - **Renders/s** — how often the UI render() is called per second
 *  - **Render time** — average duration of each render() call (ms)
 *
 * Toggle with **F6**. Only active when `import.meta.env.DEV` is true
 * (Vite tree-shakes the entire module in production builds).
 */

// ─── State ───────────────────────────────────────────────────────────

let overlay: HTMLDivElement | null = null
let rafId = 0
let visible = false

// FPS tracking (rAF-based)
let frameCount = 0
let lastFpsTime = performance.now()
let fps = 0

// Render tracking
let renderCount = 0
let renderTimeTotal = 0
let rendersPerSec = 0
let avgRenderMs = 0

// ─── Measurement API ─────────────────────────────────────────────────

/** Call at the START of render(). Returns a function to call at the END. */
export function markRender(): () => void {
  const start = performance.now()
  renderCount++
  return () => {
    renderTimeTotal += performance.now() - start
  }
}

// ─── rAF loop (only runs while overlay is visible) ───────────────────

function tick(now: number): void {
  frameCount++

  const elapsed = now - lastFpsTime
  if (elapsed >= 1000) {
    fps = Math.round((frameCount * 1000) / elapsed)
    rendersPerSec = Math.round((renderCount * 1000) / elapsed)
    avgRenderMs = renderCount > 0 ? renderTimeTotal / renderCount : 0

    frameCount = 0
    renderCount = 0
    renderTimeTotal = 0
    lastFpsTime = now

    updateText()
  }

  rafId = requestAnimationFrame(tick)
}

// ─── DOM ─────────────────────────────────────────────────────────────

function createOverlay(): HTMLDivElement {
  const el = document.createElement('div')
  el.id = 'perf-overlay'
  el.style.cssText = [
    'position:fixed',
    'bottom:8px',
    'left:8px',
    'z-index:99999',
    'padding:6px 10px',
    'background:rgba(0,0,0,0.75)',
    'color:#0f0',
    'font:12px/1.4 monospace',
    'border-radius:4px',
    'pointer-events:none',
    'white-space:pre',
    'user-select:none',
  ].join(';')
  document.body.appendChild(el)
  return el
}

function updateText(): void {
  if (!overlay) return
  const renderMs = avgRenderMs < 0.01 ? '<0.01' : avgRenderMs.toFixed(2)
  overlay.textContent = `FPS ${fps}  |  Renders/s ${rendersPerSec}  |  Render ${renderMs}ms`
}

// ─── Toggle ──────────────────────────────────────────────────────────

function show(): void {
  overlay ??= createOverlay()
  overlay.style.display = ''
  visible = true
  lastFpsTime = performance.now()
  frameCount = 0
  renderCount = 0
  renderTimeTotal = 0
  rafId = requestAnimationFrame(tick)
}

function hide(): void {
  if (overlay) overlay.style.display = 'none'
  visible = false
  cancelAnimationFrame(rafId)
}

function toggle(): void {
  if (visible) hide()
  else show()
}

// ─── Init ────────────────────────────────────────────────────────────

export function initPerfOverlay(): void {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'F6') {
      e.preventDefault()
      toggle()
    }
  })
}
