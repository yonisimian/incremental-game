// ─── Tree View ───────────────────────────────────────────────────────
//
// The pan/zoom upgrade tree, mounted the same way by the in-game panel and the
// pre-game tree reader: shell markup, zoom limits, and node-click wiring.

import type { UpgradeTreeRender } from './components.js'
import { setupPanZoom, type PanZoomHandle, type PanZoomState } from './pan-zoom.js'

// ─── Tunables ────────────────────────────────────────────────────────

export const MIN_ZOOM = 0.2
const MAX_ZOOM = 2.5

// ─── Mount ───────────────────────────────────────────────────────────

export interface TreeViewOptions {
  /** Where pan/zoom starts, given the mounted viewport (centering needs its size). */
  readonly initialState: (viewport: HTMLElement) => PanZoomState
  /** A node was clicked. */
  readonly onActivate: (upgradeId: string) => void
}

export interface TreeView {
  /** Overlays the canvas; the detail popup mounts here. */
  readonly viewport: HTMLElement
  /** The transformed layer holding edges and nodes. */
  readonly canvas: HTMLElement
  readonly panZoom: PanZoomHandle
}

/**
 * Size the SVG to every node position; +200px slack covers the nodes' own
 * size. Shift it via left/top when coords go negative, so SVG-local (0,0)
 * stays on canvas (0,0).
 */
function renderShell({ edgesSvg, nodes, bounds }: UpgradeTreeRender): string {
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

/**
 * Replace `container`'s content with the tree, and wire pan/zoom plus node
 * clicks (delegated on the canvas, so nodes patched in place keep working).
 */
export function mountTreeView(
  container: HTMLElement,
  tree: UpgradeTreeRender,
  options: TreeViewOptions,
): TreeView {
  container.innerHTML = renderShell(tree)
  const viewport = container.querySelector<HTMLElement>('.tree-viewport')!
  const canvas = container.querySelector<HTMLElement>('.tree-canvas')!
  const panZoom = setupPanZoom(viewport, canvas, {
    initialState: options.initialState(viewport),
    minZoom: MIN_ZOOM,
    maxZoom: MAX_ZOOM,
  })
  canvas.addEventListener('click', (e) => {
    const id = (e.target as HTMLElement).closest<HTMLElement>('.tree-node')?.dataset.upgrade
    if (id) options.onActivate(id)
  })
  return { viewport, canvas, panZoom }
}
