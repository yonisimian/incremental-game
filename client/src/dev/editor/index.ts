/**
 * Tree editor — orchestration. Owns the working-copy state, builds the editor
 * pane DOM, wires pan/zoom + node selection + the inspector, and drives
 * import/export. Lives in the dev page (dev-only tooling).
 */

import { parseTreeFile, type TreeFile } from '@game/shared'
import idlerTreeFile from '@game/shared/trees/idler.json'
import { setupPanZoom, type PanZoomHandle, type PanZoomState } from '../../ui/pan-zoom.js'
import {
  cloneTree,
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
} from './model.js'
import { renderCanvas, GRID, type CanvasBounds } from './canvas.js'
import { renderInspector, renderInspectorEmpty, type Currency } from './inspector.js'
import { exportTree, importTreeFromFile } from './io.js'

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

interface EditorState {
  tree: TreeFile
  selectedId: string | null
  dirty: boolean
  panZoom: PanZoomHandle | null
}

function buildLayout(): string {
  return `
    <div class="ed-root">
      <div class="ed-toolbar">
        <button id="ed-add-btn" class="ed-btn">➕ Add node</button>
        <button id="ed-delete-btn" class="ed-btn">🗑 Delete</button>
        <span class="ed-toolbar-sep"></span>
        <button id="ed-import-btn" class="ed-btn">📂 Import</button>
        <input type="file" id="ed-file" accept="application/json,.json" hidden />
        <button id="ed-export-btn" class="ed-btn">💾 Export</button>
        <button id="ed-reset-btn" class="ed-btn">↺ Reset to idler</button>
        <span id="ed-status" class="ed-status"></span>
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

/** Mount the editor into a pane element. Returns a teardown function. */
export function initEditor(pane: HTMLElement): () => void {
  pane.innerHTML = buildLayout()

  const viewport = pane.querySelector<HTMLDivElement>('#ed-viewport')!
  const canvas = pane.querySelector<HTMLDivElement>('#ed-canvas')!
  const inspector = pane.querySelector<HTMLElement>('#ed-inspector')!
  const status = pane.querySelector<HTMLSpanElement>('#ed-status')!
  const addBtn = pane.querySelector<HTMLButtonElement>('#ed-add-btn')!
  const deleteBtn = pane.querySelector<HTMLButtonElement>('#ed-delete-btn')!
  const importBtn = pane.querySelector<HTMLButtonElement>('#ed-import-btn')!
  const exportBtn = pane.querySelector<HTMLButtonElement>('#ed-export-btn')!
  const resetBtn = pane.querySelector<HTMLButtonElement>('#ed-reset-btn')!
  const fileInput = pane.querySelector<HTMLInputElement>('#ed-file')!

  const state: EditorState = {
    tree: cloneTree(parseTreeFile(idlerTreeFile)),
    selectedId: null,
    dirty: false,
    panZoom: null,
  }

  const setStatus = (text: string, isError = false): void => {
    status.textContent = text
    status.classList.toggle('error', isError)
  }

  // Delete acts on the current selection, so it's only enabled when there is one.
  const syncToolbar = (): void => {
    deleteBtn.disabled = state.selectedId === null
  }

  const renderCanvasOnly = (): void => {
    const { edgesSvg, nodes, bounds } = renderCanvas(state.tree, state.selectedId)
    canvas.innerHTML = canvasInnerHtml(edgesSvg, nodes, bounds)
  }

  const renderInspectorOnly = (): void => {
    if (state.selectedId === null) {
      renderInspectorEmpty(inspector)
      syncToolbar()
      return
    }
    const node = findNode(state.tree, state.selectedId)
    if (!node) {
      state.selectedId = null
      renderInspectorEmpty(inspector)
      syncToolbar()
      return
    }
    renderInspector(inspector, {
      node,
      allIds: collectIds(state.tree),
      currencies: treeCurrencies(state.tree),
      parentId: parentOf(state.tree, node.id),
      descendantIds: subtreeIdsOf(state.tree, node.id),
      onReparent: (parentId) => {
        if (!reparentNode(state.tree, node.id, parentId)) return
        state.dirty = true
        setStatus(
          parentId === null ? `Made ${node.id} a root` : `Parented ${node.id} → ${parentId}`,
        )
        renderCanvasOnly()
        renderInspectorOnly()
      },
      onChange: () => {
        state.dirty = true
        setStatus('Unsaved changes')
        renderCanvasOnly()
      },
    })
    syncToolbar()
  }

  // Full remount: rebuild canvas + recenter pan/zoom (on load/reset/import).
  const remount = (): void => {
    state.panZoom?.cleanup()
    renderCanvasOnly()
    state.panZoom = setupPanZoom(viewport, canvas, {
      initialState: centeredState(viewport, renderCanvas(state.tree, state.selectedId).bounds),
      minZoom: MIN_ZOOM,
      maxZoom: MAX_ZOOM,
      // Pan with the right button so the left button is free for selecting,
      // dragging nodes, and double-click-to-create on the grid.
      mousePanButton: 2,
    })
    renderInspectorOnly()
  }

  // ── Selection + drag-to-move (grid-snapped) ──
  // A pointerdown on a node selects it and begins a drag. We stop propagation so
  // the viewport's pan/zoom doesn't also start, and listen on `window` so the
  // drag continues even if the cursor leaves the node. Positions snap to GRID.
  const snap = (v: number): number => Math.round(v / GRID) * GRID

  // Convert a pointer event to world (canvas) coordinates, inverting the
  // pan/zoom transform: `screen = pan + world * zoom` ⇒ `world = (screen - pan) / zoom`.
  const canvasPoint = (e: { clientX: number; clientY: number }): { x: number; y: number } => {
    const pz = state.panZoom?.getState()
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

  const onDragMove = (e: PointerEvent): void => {
    if (!drag) return
    const zoom = state.panZoom?.getState().zoom ?? INITIAL_ZOOM
    const dx = (e.clientX - drag.startClientX) / zoom
    const dy = (e.clientY - drag.startClientY) / zoom
    if (!drag.moved && Math.hypot(dx, dy) > 2) drag.moved = true
    setNodePosition(state.tree, drag.id, snap(drag.startX + dx), snap(drag.startY + dy))
    renderCanvasOnly()
  }

  const onDragEnd = (): void => {
    window.removeEventListener('pointermove', onDragMove)
    window.removeEventListener('pointerup', onDragEnd)
    if (drag?.moved) {
      state.dirty = true
      setStatus(`Moved ${drag.id}`)
    }
    drag = null
  }

  canvas.addEventListener('pointerdown', (e) => {
    const card = (e.target as HTMLElement).closest<HTMLElement>('.ed-node')
    const id = card?.dataset.nodeId
    if (id === undefined) return
    e.stopPropagation() // don't let the viewport start a pan
    const pos = nodePosition(state.tree, id)
    if (!pos) return
    drag = {
      id,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startX: pos.x,
      startY: pos.y,
      moved: false,
    }
    if (state.selectedId !== id) {
      state.selectedId = id
      renderCanvasOnly()
      renderInspectorOnly()
    }
    window.addEventListener('pointermove', onDragMove)
    window.addEventListener('pointerup', onDragEnd)
  })

  // Clicking empty grid deselects. Pan/zoom suppresses the trailing click after
  // a drag, so this only fires on a genuine (stationary) click on the backdrop.
  // Listens on the viewport (not the content-sized canvas) so clicks anywhere
  // in the visible area count.
  viewport.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('.ed-node')) return
    if (state.selectedId === null) return
    state.selectedId = null
    renderCanvasOnly()
    renderInspectorOnly()
  })

  // Double-clicking empty grid creates a new root node at the (snapped) cursor
  // position and selects it for immediate editing.
  viewport.addEventListener('dblclick', (e) => {
    if ((e.target as HTMLElement).closest('.ed-node')) return
    const { x, y } = canvasPoint(e)
    const node = createNode(uniqueId(state.tree), { x: snap(x), y: snap(y) })
    addNode(state.tree, null, node)
    state.selectedId = node.id
    state.dirty = true
    setStatus(`Added ${node.id}`)
    renderCanvasOnly()
    renderInspectorOnly()
  })

  // ── Add / delete nodes ──
  // Add a child of the selected node (placed just below it), or a new root when
  // nothing is selected. The new node is selected so it can be edited at once.
  addBtn.addEventListener('click', () => {
    const node = createNode(uniqueId(state.tree), {
      x: 0,
      y: state.selectedId === null ? 0 : 120,
    })
    addNode(state.tree, state.selectedId, node)
    state.selectedId = node.id
    state.dirty = true
    setStatus(`Added ${node.id}`)
    renderCanvasOnly()
    renderInspectorOnly()
  })

  const deleteSelected = (): void => {
    if (state.selectedId === null) return
    const removed = removeNode(state.tree, state.selectedId)
    if (removed.length === 0) return
    state.selectedId = null
    state.dirty = true
    setStatus(
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
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key !== 'Delete') return
    if (state.selectedId === null) return
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

  // ── Toolbar ──
  importBtn.addEventListener('click', () => {
    fileInput.click()
  })
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0]
    if (!file) return
    void importTreeFromFile(file)
      .then((tree) => {
        state.tree = tree
        state.selectedId = null
        state.dirty = false
        setStatus(`Loaded ${file.name}`)
        remount()
      })
      .catch((err: unknown) => {
        setStatus(err instanceof Error ? err.message : 'Import failed', true)
      })
      .finally(() => {
        fileInput.value = ''
      })
  })

  exportBtn.addEventListener('click', () => {
    exportTree(state.tree)
    state.dirty = false
    setStatus(`Exported ${state.tree.id}.json`)
  })

  resetBtn.addEventListener('click', () => {
    state.tree = cloneTree(parseTreeFile(idlerTreeFile))
    state.selectedId = null
    state.dirty = false
    setStatus('Reset to idler tree')
    remount()
  })

  remount()

  return () => {
    window.removeEventListener('pointermove', onDragMove)
    window.removeEventListener('pointerup', onDragEnd)
    window.removeEventListener('keydown', onKeyDown)
    state.panZoom?.cleanup()
    state.panZoom = null
  }
}
