// ─── Pan / Zoom ──────────────────────────────────────────────────────
//
// Vanilla pointer-event pan/zoom on a viewport (overflow:hidden) → canvas
// (CSS transform). Used by the upgrade-tree panel. Supports:
//  - mouse drag-pan, wheel zoom (anchored at cursor)
//  - touch pan + pinch zoom (anchored at midpoint), simultaneous
//  - click-vs-drag suppression so a finishing pan doesn't fire a click
//
// Coordinates: world coords (x, y) live in canvas/SVG space; screen coords
// use viewport-local pixels (event.clientX - rect.left). Pan/zoom transform:
//   screenX = panX + worldX * zoom
//   panX_new (anchor at C) = Cx - ((Cx - panX) / oldZoom) * newZoom

export interface PanZoomState {
  panX: number
  panY: number
  zoom: number
}

export interface PanZoomOptions {
  /** Default 0.5. */
  readonly minZoom?: number
  /** Default 2.5. */
  readonly maxZoom?: number
  /** Per wheel notch. Default 0.1. */
  readonly zoomStep?: number
  /** Initial pan/zoom. Defaults: panX=0, panY=0, zoom=1.0. */
  readonly initialState?: Partial<PanZoomState>
}

export interface PanZoomHandle {
  /** Tear down all event listeners. Idempotent. */
  cleanup: () => void
  /** Snapshot the current pan/zoom state. */
  getState: () => Readonly<PanZoomState>
}

/** Drag distance threshold in screen pixels — beyond this, suppress the trailing click. */
const DRAG_CLICK_THRESHOLD = 5

/**
 * Wire pan/zoom interaction onto a viewport (overflow:hidden) → canvas
 * (transformed). Returns a cleanup function and a state getter.
 */
export function setupPanZoom(
  viewport: HTMLElement,
  canvas: HTMLElement,
  options: PanZoomOptions = {},
): PanZoomHandle {
  const minZoom = options.minZoom ?? 0.5
  const maxZoom = options.maxZoom ?? 2.5
  const zoomStep = options.zoomStep ?? 0.1
  const init = options.initialState ?? {}

  const state: PanZoomState = {
    panX: init.panX ?? 0,
    panY: init.panY ?? 0,
    zoom: clamp(init.zoom ?? 1.0, minZoom, maxZoom),
  }

  // Active pointers, viewport-local
  const pointers = new Map<number, { x: number; y: number }>()

  // Pan tracking (for single-pointer drag)
  let dragStartPanX = 0
  let dragStartPanY = 0
  let dragStartX = 0
  let dragStartY = 0
  let dragMaxDist = 0 // max distance traveled, for click-vs-drag

  // Pinch tracking (for two-pointer zoom + midpoint pan)
  let lastPinchDist = 0
  let lastMidX = 0
  let lastMidY = 0

  applyTransform()

  // ─── Helpers ─────────────────────────────────────────────────────

  function applyTransform(): void {
    canvas.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.zoom})`
  }

  function viewportLocal(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const rect = viewport.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  function applyZoomAt(newZoom: number, anchorX: number, anchorY: number): void {
    const z0 = state.zoom
    const z1 = clamp(newZoom, minZoom, maxZoom)
    if (z1 === z0) return
    // Keep world coord under (anchorX, anchorY) fixed.
    state.panX = anchorX - ((anchorX - state.panX) / z0) * z1
    state.panY = anchorY - ((anchorY - state.panY) / z0) * z1
    state.zoom = z1
  }

  function pinchDistance(): number {
    const pts = [...pointers.values()]
    const dx = pts[0].x - pts[1].x
    const dy = pts[0].y - pts[1].y
    return Math.hypot(dx, dy)
  }

  function pinchMidpoint(): { x: number; y: number } {
    const pts = [...pointers.values()]
    return { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 }
  }

  function suppressNextClick(): void {
    // Capture-phase: intercept the bubbled click that follows pointerup so a
    // drag finishing on a node doesn't accidentally buy it. We can't rely on
    // `once: true` alone — if no click ever fires (e.g. pointer lifted off
    // any element), the listener leaks and the next *legitimate* click could
    // get swallowed. Auto-remove after a short window to bound the lifetime.
    const swallow = (e: Event): void => {
      e.stopPropagation()
    }
    window.addEventListener('click', swallow, { capture: true, once: true })
    setTimeout(() => {
      window.removeEventListener('click', swallow, { capture: true })
    }, 100)
  }

  // While dragging we listen on document so the drag continues even if the
  // cursor leaves the viewport. We deliberately DO NOT setPointerCapture on
  // the viewport — capture would redirect the synthesized `click` event to
  // the viewport, breaking the delegated click listener that buys upgrades
  // when you tap a node.
  let documentListenersActive = false

  function attachDocumentListeners(): void {
    if (documentListenersActive) return
    documentListenersActive = true
    document.addEventListener('pointermove', onPointerMove)
    document.addEventListener('pointerup', onPointerUp)
    document.addEventListener('pointercancel', onPointerUp)
  }

  function detachDocumentListeners(): void {
    if (!documentListenersActive) return
    documentListenersActive = false
    document.removeEventListener('pointermove', onPointerMove)
    document.removeEventListener('pointerup', onPointerUp)
    document.removeEventListener('pointercancel', onPointerUp)
  }

  // ─── Event handlers ──────────────────────────────────────────────

  function onPointerDown(e: PointerEvent): void {
    const local = viewportLocal(e)
    pointers.set(e.pointerId, local)

    if (pointers.size === 1) {
      // Begin pan
      dragStartPanX = state.panX
      dragStartPanY = state.panY
      dragStartX = local.x
      dragStartY = local.y
      dragMaxDist = 0
      viewport.classList.add('panning')
      attachDocumentListeners()
    } else if (pointers.size === 2) {
      // Begin pinch — initialize tracking
      lastPinchDist = pinchDistance()
      const m = pinchMidpoint()
      lastMidX = m.x
      lastMidY = m.y
    }
  }

  function onPointerMove(e: PointerEvent): void {
    if (!pointers.has(e.pointerId)) return
    const local = viewportLocal(e)
    pointers.set(e.pointerId, local)

    if (pointers.size === 1) {
      // Pan
      state.panX = dragStartPanX + (local.x - dragStartX)
      state.panY = dragStartPanY + (local.y - dragStartY)
      const dx = local.x - dragStartX
      const dy = local.y - dragStartY
      const dist = Math.hypot(dx, dy)
      if (dist > dragMaxDist) dragMaxDist = dist
      applyTransform()
    } else if (pointers.size === 2) {
      // Pinch: distance change → zoom; midpoint movement → pan
      const newDist = pinchDistance()
      const mid = pinchMidpoint()
      if (lastPinchDist > 0) {
        const ratio = newDist / lastPinchDist
        applyZoomAt(state.zoom * ratio, mid.x, mid.y)
      }
      // Midpoint pan
      state.panX += mid.x - lastMidX
      state.panY += mid.y - lastMidY
      lastPinchDist = newDist
      lastMidX = mid.x
      lastMidY = mid.y
      applyTransform()
    }
  }

  function onPointerUp(e: PointerEvent): void {
    if (!pointers.has(e.pointerId)) return
    pointers.delete(e.pointerId)

    if (pointers.size === 0) {
      viewport.classList.remove('panning')
      detachDocumentListeners()
      // Suppress the click that browsers fire after a drag, so a long pan
      // ending on a node doesn't accidentally buy it.
      if (dragMaxDist > DRAG_CLICK_THRESHOLD) suppressNextClick()
      dragMaxDist = 0
    } else if (pointers.size === 1) {
      // Falling back from pinch to pan — re-baseline single-pointer drag tracking.
      const remaining = [...pointers.values()][0]
      dragStartPanX = state.panX
      dragStartPanY = state.panY
      dragStartX = remaining.x
      dragStartY = remaining.y
    }
  }

  function onWheel(e: WheelEvent): void {
    e.preventDefault()
    const local = viewportLocal(e)
    const direction = e.deltaY > 0 ? -1 : 1
    applyZoomAt(state.zoom + direction * zoomStep, local.x, local.y)
    applyTransform()
  }

  // ─── Wire up ─────────────────────────────────────────────────────

  viewport.addEventListener('pointerdown', onPointerDown)
  viewport.addEventListener('wheel', onWheel, { passive: false })

  let cleanedUp = false
  return {
    cleanup() {
      if (cleanedUp) return
      cleanedUp = true
      viewport.removeEventListener('pointerdown', onPointerDown)
      viewport.removeEventListener('wheel', onWheel)
      detachDocumentListeners()
      viewport.classList.remove('panning')
      pointers.clear()
    },
    getState() {
      return state
    },
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}
