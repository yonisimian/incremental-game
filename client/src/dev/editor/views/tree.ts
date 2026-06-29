/**
 * Upgrade-tree section — the canvas + inspector editor. Extracted verbatim from
 * the original editor body; the only change is that it now implements
 * {@link EditorView} (mount/unmount) and reports through the shell's
 * {@link EditorContext} instead of owning the file-level toolbar.
 *
 * Owns the selection, pan/zoom, node drag, and add/delete behavior. The canvas
 * must mount while its host is visible so pan/zoom sees real dimensions — the
 * shell guarantees this by mounting on section-switch.
 */

import type { TreeFile } from '@game/shared'
import { setupPanZoom, type PanZoomHandle, type PanZoomState } from '../../../ui/pan-zoom.js'
import {
  findNode,
  collectIds,
  createNode,
  uniqueId,
  addNode,
  removeNode,
  nodePosition,
  setNodePosition,
  parentOf,
  subtreeIdsOf,
  reparentNode,
} from '../model.js'
import { renderCanvas, GRID, type CanvasBounds } from '../canvas.js'
import { renderInspector, renderInspectorEmpty, type Currency } from '../inspector.js'
import type { EditorContext, EditorView } from './types.js'

const INITIAL_ZOOM = 0.6
const MIN_ZOOM = 0.3
const MAX_ZOOM = 2.5

/**
 * The tree's cost currencies, labelled with the default flavor's icon + name
 * (e.g. `🪵 Wood (r0)`), falling back to the bare resource key.
 */
function treeCurrencies(tree: TreeFile): Currency[] {
  const flavor = new Map((tree.flavors[0]?.resources ?? []).map((r) => [r.key, r]))
  return tree.resources.map((key) => {
    const f = flavor.get(key)
    return { key, label: f ? `${f.icon} ${f.displayName} (${key})` : key }
  })
}

function buildLayout(): string {
  return `
    <div class="ed-tree-root">
      <div class="ed-tree-toolbar">
        <button id="ed-add-btn" class="ed-btn">➕ Add node</button>
        <button id="ed-delete-btn" class="ed-btn">🗑 Delete</button>
      </div>
      <div class="ed-body">
        <div class="ed-canvas-viewport" id="ed-viewport">
          <div class="ed-canvas" id="ed-canvas"></div>
        </div>
        <aside class="ed-inspector" id="ed-inspector"></aside>
      </div>
    </div>`
}

/** Size + position the grid + SVG that fully enclose the (possibly negative) bounds. */
function canvasInnerHtml(edgesSvg: string, nodes: string, bounds: CanvasBounds): string {
  const offsetX = Math.min(0, bounds.minX)
  const offsetY = Math.min(0, bounds.minY)
  const width = bounds.maxX - offsetX + 200
  const height = bounds.maxY - offsetY + 200
  // Shift the grid pattern so its lines fall on world multiples of GRID, which
  // is exactly where dragged nodes snap to.
  const gridX = (((-offsetX % GRID) + GRID) % GRID).toFixed(2)
  const gridY = (((-offsetY % GRID) + GRID) % GRID).toFixed(2)
  return `
    <div class="ed-grid"
         style="left:${offsetX}px; top:${offsetY}px; width:${width}px; height:${height}px;
                background-size:${GRID}px ${GRID}px; background-position:${gridX}px ${gridY}px"></div>
    <svg class="ed-edges" width="${width}" height="${height}" overflow="visible"
         viewBox="${offsetX} ${offsetY} ${width} ${height}"
         style="left:${offsetX}px; top:${offsetY}px">
      ${edgesSvg}
    </svg>
    ${nodes}`
}

function centeredState(viewport: HTMLElement, bounds: CanvasBounds): PanZoomState {
  const cx = (bounds.minX + bounds.maxX) / 2
  const cy = (bounds.minY + bounds.maxY) / 2
  const rect = viewport.getBoundingClientRect()
  return {
    panX: rect.width / 2 - cx * INITIAL_ZOOM,
    panY: rect.height / 2 - cy * INITIAL_ZOOM,
    zoom: INITIAL_ZOOM,
  }
}

/** The upgrade-tree editor section. */
export function createTreeView(): EditorView {
  let panZoom: PanZoomHandle | null = null
  let selectedId: string | null = null
  let onKeyDown: ((e: KeyboardEvent) => void) | null = null
  let onDragMove: ((e: PointerEvent) => void) | null = null
  let onDragEnd: (() => void) | null = null

  return {
    mount(host: HTMLElement, ctx: EditorContext): void {
      const tree = ctx.tree
      host.innerHTML = buildLayout()

      const viewport = host.querySelector<HTMLDivElement>('#ed-viewport')!
      const canvas = host.querySelector<HTMLDivElement>('#ed-canvas')!
      const inspector = host.querySelector<HTMLElement>('#ed-inspector')!
      const addBtn = host.querySelector<HTMLButtonElement>('#ed-add-btn')!
      const deleteBtn = host.querySelector<HTMLButtonElement>('#ed-delete-btn')!

      // Delete acts on the current selection, so it's only enabled when there is one.
      const syncToolbar = (): void => {
        deleteBtn.disabled = selectedId === null
      }

      const renderCanvasOnly = (): void => {
        const { edgesSvg, nodes, bounds } = renderCanvas(tree, selectedId)
        canvas.innerHTML = canvasInnerHtml(edgesSvg, nodes, bounds)
      }

      const renderInspectorOnly = (): void => {
        if (selectedId === null) {
          renderInspectorEmpty(inspector)
          syncToolbar()
          return
        }
        const node = findNode(tree, selectedId)
        if (!node) {
          selectedId = null
          renderInspectorEmpty(inspector)
          syncToolbar()
          return
        }
        renderInspector(inspector, {
          tree,
          node,
          allIds: collectIds(tree),
          currencies: treeCurrencies(tree),
          parentId: parentOf(tree, node.id),
          descendantIds: subtreeIdsOf(tree, node.id),
          onReparent: (parentId) => {
            if (!reparentNode(tree, node.id, parentId)) return
            ctx.markDirty()
            ctx.setStatus(
              parentId === null ? `Made ${node.id} a root` : `Parented ${node.id} → ${parentId}`,
            )
            renderCanvasOnly()
            renderInspectorOnly()
          },
          onChange: () => {
            ctx.markDirty()
            ctx.setStatus('Unsaved changes')
            renderCanvasOnly()
          },
        })
        syncToolbar()
      }

      // Full mount: rebuild canvas + center pan/zoom.
      panZoom?.cleanup()
      renderCanvasOnly()
      panZoom = setupPanZoom(viewport, canvas, {
        initialState: centeredState(viewport, renderCanvas(tree, selectedId).bounds),
        minZoom: MIN_ZOOM,
        maxZoom: MAX_ZOOM,
        // Pan with the right button so the left button is free for selecting,
        // dragging nodes, and double-click-to-create on the grid.
        mousePanButton: 2,
      })
      renderInspectorOnly()

      // ── Selection + drag-to-move (grid-snapped) ──
      // A pointerdown on a node selects it and begins a drag. We stop propagation
      // so the viewport's pan/zoom doesn't also start, and listen on `window` so
      // the drag continues even if the cursor leaves the node. Positions snap to
      // GRID.
      const snap = (v: number): number => Math.round(v / GRID) * GRID

      // Convert a pointer event to world (canvas) coordinates, inverting the
      // pan/zoom transform: `screen = pan + world * zoom` ⇒ `world = (screen - pan) / zoom`.
      const canvasPoint = (e: { clientX: number; clientY: number }): { x: number; y: number } => {
        const pz = panZoom?.getState()
        const rect = viewport.getBoundingClientRect()
        const zoom = pz?.zoom ?? INITIAL_ZOOM
        const panX = pz?.panX ?? 0
        const panY = pz?.panY ?? 0
        return {
          x: (e.clientX - rect.left - panX) / zoom,
          y: (e.clientY - rect.top - panY) / zoom,
        }
      }

      let drag: {
        id: string
        startClientX: number
        startClientY: number
        startX: number
        startY: number
        moved: boolean
      } | null = null

      onDragMove = (e: PointerEvent): void => {
        if (!drag) return
        const zoom = panZoom?.getState().zoom ?? INITIAL_ZOOM
        const dx = (e.clientX - drag.startClientX) / zoom
        const dy = (e.clientY - drag.startClientY) / zoom
        if (!drag.moved && Math.hypot(dx, dy) > 2) drag.moved = true
        setNodePosition(tree, drag.id, snap(drag.startX + dx), snap(drag.startY + dy))
        renderCanvasOnly()
      }

      onDragEnd = (): void => {
        window.removeEventListener('pointermove', onDragMove!)
        window.removeEventListener('pointerup', onDragEnd!)
        if (drag?.moved) {
          ctx.markDirty()
          ctx.setStatus(`Moved ${drag.id}`)
        }
        drag = null
      }

      canvas.addEventListener('pointerdown', (e) => {
        const card = (e.target as HTMLElement).closest<HTMLElement>('.ed-node')
        const id = card?.dataset.nodeId
        if (id === undefined) return
        e.stopPropagation() // don't let the viewport start a pan
        const pos = nodePosition(tree, id)
        if (!pos) return
        drag = {
          id,
          startClientX: e.clientX,
          startClientY: e.clientY,
          startX: pos.x,
          startY: pos.y,
          moved: false,
        }
        if (selectedId !== id) {
          selectedId = id
          renderCanvasOnly()
          renderInspectorOnly()
        }
        window.addEventListener('pointermove', onDragMove!)
        window.addEventListener('pointerup', onDragEnd!)
      })

      // Clicking empty grid deselects. Pan/zoom suppresses the trailing click
      // after a drag, so this only fires on a genuine (stationary) click on the
      // backdrop. Listens on the viewport (not the content-sized canvas) so
      // clicks anywhere in the visible area count.
      viewport.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('.ed-node')) return
        if (selectedId === null) return
        selectedId = null
        renderCanvasOnly()
        renderInspectorOnly()
      })

      // Double-clicking empty grid creates a new root node at the (snapped)
      // cursor position and selects it for immediate editing.
      viewport.addEventListener('dblclick', (e) => {
        if ((e.target as HTMLElement).closest('.ed-node')) return
        const { x, y } = canvasPoint(e)
        const node = createNode(uniqueId(tree), { x: snap(x), y: snap(y) })
        addNode(tree, null, node)
        selectedId = node.id
        ctx.markDirty()
        ctx.setStatus(`Added ${node.id}`)
        renderCanvasOnly()
        renderInspectorOnly()
      })

      // ── Add / delete nodes ──
      // Add a child of the selected node (placed just below it), or a new root
      // when nothing is selected. The new node is selected so it can be edited
      // at once.
      addBtn.addEventListener('click', () => {
        const node = createNode(uniqueId(tree), {
          x: 0,
          y: selectedId === null ? 0 : 120,
        })
        addNode(tree, selectedId, node)
        selectedId = node.id
        ctx.markDirty()
        ctx.setStatus(`Added ${node.id}`)
        renderCanvasOnly()
        renderInspectorOnly()
      })

      const deleteSelected = (): void => {
        if (selectedId === null) return
        const removed = removeNode(tree, selectedId)
        if (removed.length === 0) return
        selectedId = null
        ctx.markDirty()
        ctx.setStatus(
          removed.length === 1
            ? `Deleted ${removed[0]}`
            : `Deleted ${removed[0]} (+${removed.length - 1} descendant${removed.length > 2 ? 's' : ''})`,
        )
        renderCanvasOnly()
        renderInspectorOnly()
      }

      deleteBtn.addEventListener('click', deleteSelected)

      // Delete key removes the selection — but not while typing in an inspector
      // field, where Delete should edit text as usual.
      onKeyDown = (e: KeyboardEvent): void => {
        if (e.key !== 'Delete') return
        if (selectedId === null) return
        const active = document.activeElement
        if (
          active instanceof HTMLInputElement ||
          active instanceof HTMLTextAreaElement ||
          active instanceof HTMLSelectElement
        ) {
          return
        }
        e.preventDefault()
        deleteSelected()
      }
      window.addEventListener('keydown', onKeyDown)
    },

    unmount(): void {
      if (onDragMove) window.removeEventListener('pointermove', onDragMove)
      if (onDragEnd) window.removeEventListener('pointerup', onDragEnd)
      if (onKeyDown) window.removeEventListener('keydown', onKeyDown)
      onDragMove = onDragEnd = onKeyDown = null
      panZoom?.cleanup()
      panZoom = null
    },
  }
}
