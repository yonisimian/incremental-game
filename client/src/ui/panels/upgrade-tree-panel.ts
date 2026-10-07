import type { Panel } from '../panels.js'
import { renderUpgradeTree, type TreeBounds } from '../components.js'
import { bindUpgradeEvents } from '../helpers.js'
import { openUpgradeDetail, updateUpgradeDetail, resetUpgradeDetail } from '../upgrade-detail.js'
import { setupPanZoom, type PanZoomHandle, type PanZoomState } from '../pan-zoom.js'

// ─── Tunables ────────────────────────────────────────────────────────
//
// Tweak these to change how the tree starts and how far the user can zoom.
// `INITIAL_ZOOM` is clamped to [MIN_ZOOM, MAX_ZOOM], so make sure it sits
// inside the range or it'll snap to the nearest bound on mount.

const MIN_ZOOM = 0.2
const MAX_ZOOM = 2.5
const INITIAL_ZOOM = MIN_ZOOM

// ─── Module-local pan/zoom state ─────────────────────────────────────
//
// Persists pan/zoom across tab switches within a match (good UX), and resets
// on match boundary (avoid stale state leaking into a fresh run).

let panZoomHandle: PanZoomHandle | null = null
let lastPanZoomState: PanZoomState | null = null
let lastMatchId: string | null = null
let prevHtml = ''

// ─── Helpers ─────────────────────────────────────────────────────────

/** Compute centered initial pan so the tree's bounding-box center aligns with viewport center at INITIAL_ZOOM. */
function computeCenteredInitialState(viewport: HTMLElement, bounds: TreeBounds): PanZoomState {
  const treeCx = (bounds.minX + bounds.maxX) / 2
  const treeCy = (bounds.minY + bounds.maxY) / 2
  const vp = viewport.getBoundingClientRect()
  return {
    panX: vp.width / 2 - treeCx * INITIAL_ZOOM,
    panY: vp.height / 2 - treeCy * INITIAL_ZOOM,
    zoom: INITIAL_ZOOM,
  }
}

/** Build the static markup wrapper. Inner edges+nodes are recomputed on update(). */
function renderShell(edgesSvg: string, nodes: string, bounds: TreeBounds): string {
  // Size SVG to encompass all node positions; +200px slack handles bounding-box edges.
  // Shift via CSS left/top if any coords go negative so SVG-local (0,0) aligns with canvas (0,0).
  const svgOffsetX = Math.min(0, bounds.minX)
  const svgOffsetY = Math.min(0, bounds.minY)
  const svgW = bounds.maxX - svgOffsetX + 200
  const svgH = bounds.maxY - svgOffsetY + 200
  return `
    <div class="tree-viewport" id="tree-viewport">
      <div class="tree-canvas" id="tree-canvas">
        <svg class="tree-edges" width="${svgW}" height="${svgH}" overflow="visible"
             style="left: ${svgOffsetX}px; top: ${svgOffsetY}px">
          ${edgesSvg}
        </svg>
        ${nodes}
      </div>
    </div>
  `
}

// ─── Panel ───────────────────────────────────────────────────────────

export const upgradeTreePanel: Panel = {
  id: 'upgrades',
  label: 'Upgrades',
  icon: '🌳',

  render(container, state) {
    // 1. Snapshot the previous incarnation's pan/zoom BEFORE tearing it down.
    //    (Order matters: must come before the match-boundary reset, otherwise
    //    a fresh match would receive the previous match's pan/zoom.)
    if (panZoomHandle) {
      lastPanZoomState = { ...panZoomHandle.getState() }
      panZoomHandle.cleanup()
      panZoomHandle = null
    }

    // 2. Match boundary → discard the snapshot we just took. Pan/zoom resets
    //    to centered defaults at the start of every new game.
    if (state.matchId !== lastMatchId) {
      lastPanZoomState = null
      lastMatchId = state.matchId
    }

    // 3. Build fresh DOM. Re-rendering wipes the container (and any open detail
    //    popup mounted inside the viewport), so clear popup state to match.
    resetUpgradeDetail()
    const { edgesSvg, nodes, bounds } = renderUpgradeTree(state)
    prevHtml = edgesSvg + nodes
    container.innerHTML = renderShell(edgesSvg, nodes, bounds)

    // 4. Wire pan/zoom on the new DOM, seeded from saved state or centered defaults.
    const viewport = document.getElementById('tree-viewport')
    const canvas = document.getElementById('tree-canvas')
    if (viewport && canvas) {
      const initialState = lastPanZoomState ?? computeCenteredInitialState(viewport, bounds)
      panZoomHandle = setupPanZoom(viewport, canvas, {
        initialState,
        minZoom: MIN_ZOOM,
        maxZoom: MAX_ZOOM,
      })
    }
  },

  bind() {
    // Tree nodes open a detail popup (with Buy/Cancel) instead of buying on click.
    bindUpgradeEvents('tree-canvas', openUpgradeDetail)
  },

  update(state) {
    // Keep the open detail popup's live fields (cost / Buy-enabled) in sync.
    updateUpgradeDetail(state)
    const { edgesSvg, nodes } = renderUpgradeTree(state)
    const html = edgesSvg + nodes
    if (html === prevHtml) return
    prevHtml = html
    const canvas = document.getElementById('tree-canvas')
    if (!canvas) return
    // Refresh the SVG + nodes but keep the canvas element itself
    // (its inline `transform` style is the live pan/zoom and must persist).
    const svg = canvas.querySelector<SVGSVGElement>('.tree-edges')
    if (svg) svg.innerHTML = edgesSvg
    syncNodes(canvas, nodes)
  },
}

/**
 * Patch the node buttons in place from freshly rendered markup. Replacing them
 * would drop any click whose pointerdown landed on the old button.
 */
function syncNodes(canvas: HTMLElement, nodesHtml: string): void {
  const template = document.createElement('template')
  template.innerHTML = nodesHtml
  const current = new Map<string, HTMLButtonElement>()
  for (const node of canvas.querySelectorAll<HTMLButtonElement>('.tree-node')) {
    current.set(node.dataset.upgrade ?? '', node)
  }
  for (const next of template.content.querySelectorAll<HTMLButtonElement>('.tree-node')) {
    const id = next.dataset.upgrade ?? ''
    const node = current.get(id)
    current.delete(id)
    if (!node) {
      canvas.append(next)
      continue
    }
    for (const { name } of [...node.attributes]) {
      if (!next.hasAttribute(name)) node.removeAttribute(name)
    }
    for (const { name, value } of next.attributes) {
      if (node.getAttribute(name) !== value) node.setAttribute(name, value)
    }
    if (node.innerHTML !== next.innerHTML) node.innerHTML = next.innerHTML
  }
  for (const stale of current.values()) stale.remove()
}
