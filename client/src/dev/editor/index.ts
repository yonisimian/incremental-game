/**
 * Tree editor — orchestration. Owns the working-copy state, builds the editor
 * pane DOM, wires pan/zoom + node selection + the inspector, and drives
 * import/export. Lives in the dev page (dev-only tooling).
 */

import { buildIdlerTreeFile, type TreeFile } from '@game/shared'
import { setupPanZoom, type PanZoomHandle, type PanZoomState } from '../../ui/pan-zoom.js'
import {
  cloneTree,
  findNode,
  collectIds,
  createNode,
  uniqueId,
  addNode,
  removeNode,
} from './model.js'
import { renderCanvas, type CanvasBounds } from './canvas.js'
import { renderInspector, renderInspectorEmpty } from './inspector.js'
import { exportTree, importTreeFromFile } from './io.js'

const INITIAL_ZOOM = 0.6
const MIN_ZOOM = 0.3
const MAX_ZOOM = 2.5

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

/** Size + position an SVG that fully encloses the (possibly negative) bounds. */
function canvasInnerHtml(edgesSvg: string, nodes: string, bounds: CanvasBounds): string {
  const offsetX = Math.min(0, bounds.minX)
  const offsetY = Math.min(0, bounds.minY)
  const width = bounds.maxX - offsetX + 200
  const height = bounds.maxY - offsetY + 200
  return `
    <svg class="ed-edges" width="${width}" height="${height}" overflow="visible"
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
    tree: cloneTree(buildIdlerTreeFile()),
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
    })
    renderInspectorOnly()
  }

  // ── Selection (pan/zoom suppresses the trailing click after a drag) ──
  canvas.addEventListener('click', (e) => {
    const card = (e.target as HTMLElement).closest<HTMLElement>('.ed-node')
    if (!card) return
    state.selectedId = card.dataset.nodeId ?? null
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

  deleteBtn.addEventListener('click', () => {
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
  })

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
    state.tree = cloneTree(buildIdlerTreeFile())
    state.selectedId = null
    state.dirty = false
    setStatus('Reset to idler tree')
    remount()
  })

  remount()

  return () => {
    state.panZoom?.cleanup()
    state.panZoom = null
  }
}
