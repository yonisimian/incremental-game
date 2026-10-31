/**
 * Upgrade-tree section — the canvas + inspector editor. Owns the selection,
 * pan/zoom, node drag, add/delete behavior, and the category being edited. The
 * canvas must mount while its host is visible so pan/zoom sees real dimensions
 * — the shell guarantees this by mounting on section-switch.
 *
 * Like the game with categories on, the canvas shows one category at a time,
 * stepped through with arrows; "All" shows the whole tree, as the game does
 * with categories off.
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
  walkPositioned,
  categoryOf,
  listCategories,
  addCategory,
  renameCategory,
  setCategoryIcon,
  DEFAULT_CATEGORY_ICON,
  moveCategory,
  removeCategory,
  moveToCategory,
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
      <div class="ed-tree-toolbar ed-category-bar">
        <button id="ed-cat-prev" class="ed-btn" title="Previous category">◀</button>
        <input id="ed-cat-icon" class="ed-input ed-category-icon" type="text"
               aria-label="Category icon" />
        <input id="ed-cat-name" class="ed-input ed-category-name" type="text"
               aria-label="Category name" />
        <button id="ed-cat-next" class="ed-btn" title="Next category">▶</button>
        <label class="ed-checkbox"><input id="ed-cat-all" type="checkbox" /> All</label>
        <button id="ed-cat-add" class="ed-btn">➕ Category</button>
        <button id="ed-cat-earlier" class="ed-btn" title="Move this category earlier">⇠ Move</button>
        <button id="ed-cat-later" class="ed-btn" title="Move this category later">Move ⇢</button>
        <button id="ed-cat-delete" class="ed-btn" title="Delete this (empty) category">🗑 Category</button>
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
  // The category on the canvas, or `null` for All. `lastCategory` is where the
  // All toggle returns to. Both survive a re-mount when the category still exists.
  let categoryId: string | null = null
  let lastCategory: string | null = null
  // The first mount opens on the first category rather than All.
  let mounted = false
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
      const catPrev = host.querySelector<HTMLButtonElement>('#ed-cat-prev')!
      const catNext = host.querySelector<HTMLButtonElement>('#ed-cat-next')!
      const catIcon = host.querySelector<HTMLInputElement>('#ed-cat-icon')!
      const catName = host.querySelector<HTMLInputElement>('#ed-cat-name')!
      const catAll = host.querySelector<HTMLInputElement>('#ed-cat-all')!
      const catAdd = host.querySelector<HTMLButtonElement>('#ed-cat-add')!
      const catEarlier = host.querySelector<HTMLButtonElement>('#ed-cat-earlier')!
      const catLater = host.querySelector<HTMLButtonElement>('#ed-cat-later')!
      const catDelete = host.querySelector<HTMLButtonElement>('#ed-cat-delete')!

      // Keep the shown category valid across a re-mount (import / reset).
      const ids = (): string[] => tree.categories.map((c) => c.id)
      if (lastCategory === null || !ids().includes(lastCategory)) lastCategory = ids()[0]
      if (categoryId !== null && !ids().includes(categoryId)) categoryId = lastCategory

      // Delete acts on the current selection, so it's only enabled when there is
      // one. A new root needs a category to go in, so Add with nothing selected
      // is off in All.
      const syncToolbar = (): void => {
        deleteBtn.disabled = selectedId === null
        addBtn.disabled = categoryId === null && selectedId === null
      }

      const syncCategoryBar = (): void => {
        const rows = listCategories(tree)
        const i = rows.findIndex((r) => r.id === categoryId)
        const row = i >= 0 ? rows[i] : null
        catAll.checked = categoryId === null
        catName.disabled = catIcon.disabled = row === null
        catName.value = row ? row.name : 'All categories'
        catIcon.value = row ? row.icon : ''
        catPrev.disabled = catNext.disabled = row === null || rows.length < 2
        catEarlier.disabled = row === null || i === 0
        catLater.disabled = row === null || i === rows.length - 1
        catDelete.disabled = row === null || row.size > 0 || rows.length < 2
        catDelete.title =
          row !== null && row.size > 0
            ? 'Move or delete its nodes first'
            : 'Delete this (empty) category'
      }

      const renderCanvasOnly = (): void => {
        const { edgesSvg, nodes, bounds } = renderCanvas(tree, selectedId, categoryId)
        canvas.innerHTML = canvasInnerHtml(edgesSvg, nodes, bounds)
      }

      // Center pan/zoom on what's shown. The handle can't be moved, so it's rebuilt.
      const recenter = (): void => {
        panZoom?.cleanup()
        panZoom = setupPanZoom(viewport, canvas, {
          initialState: centeredState(viewport, renderCanvas(tree, null, categoryId).bounds),
          minZoom: MIN_ZOOM,
          maxZoom: MAX_ZOOM,
          // Pan with the right button so the left button is free for selecting,
          // dragging nodes, and double-click-to-create on the grid.
          mousePanButton: 2,
        })
      }

      /** Show `next` (a category id, or `null` for All), dropping a selection it hides. */
      const showCategory = (next: string | null): void => {
        categoryId = next
        if (next !== null) lastCategory = next
        if (next !== null && selectedId !== null && categoryOf(tree, selectedId) !== next) {
          selectedId = null
        }
        syncCategoryBar()
        renderCanvasOnly()
        recenter()
        renderInspectorOnly()
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
          categories: listCategories(tree),
          categoryById: new Map(walkPositioned(tree).map((p) => [p.node.id, p.category])),
          onMoveCategory: (target) => {
            if (!moveToCategory(tree, node.id, target)) return
            ctx.markDirty()
            ctx.setStatus(`Moved ${node.id} to ${target}`)
            // Follow the node unless the whole tree is on screen.
            if (categoryId === null) {
              syncCategoryBar()
              renderCanvasOnly()
              renderInspectorOnly()
            } else {
              showCategory(target)
            }
          },
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
      if (!mounted) {
        categoryId = lastCategory
        mounted = true
      }
      syncCategoryBar()
      renderCanvasOnly()
      recenter()
      renderInspectorOnly()

      // ── Categories ──
      const step = (by: 1 | -1): void => {
        if (categoryId === null) return
        const all = ids()
        showCategory(all[(all.indexOf(categoryId) + by + all.length) % all.length])
      }
      catPrev.addEventListener('click', () => {
        step(-1)
      })
      catNext.addEventListener('click', () => {
        step(1)
      })
      catAll.addEventListener('change', () => {
        showCategory(catAll.checked ? null : lastCategory)
      })

      catName.addEventListener('change', () => {
        if (categoryId === null) return
        renameCategory(tree, categoryId, catName.value.trim() || categoryId)
        ctx.markDirty()
        ctx.setStatus(`Renamed ${categoryId}`)
        syncCategoryBar()
      })

      catIcon.addEventListener('change', () => {
        if (categoryId === null) return
        setCategoryIcon(tree, categoryId, catIcon.value.trim() || DEFAULT_CATEGORY_ICON)
        ctx.markDirty()
        ctx.setStatus(`Set ${categoryId}'s icon`)
        syncCategoryBar()
      })

      catAdd.addEventListener('click', () => {
        const id = addCategory(tree)
        ctx.markDirty()
        ctx.setStatus(`Added category ${id}`)
        showCategory(id)
        catName.select()
      })

      const move = (by: 1 | -1): void => {
        if (categoryId === null || !moveCategory(tree, categoryId, by)) return
        ctx.markDirty()
        ctx.setStatus(`Moved category ${categoryId}`)
        syncCategoryBar()
      }
      catEarlier.addEventListener('click', () => {
        move(-1)
      })
      catLater.addEventListener('click', () => {
        move(1)
      })

      catDelete.addEventListener('click', () => {
        if (categoryId === null) return
        const i = ids().indexOf(categoryId)
        const result = removeCategory(tree, categoryId)
        if (!result.ok) {
          ctx.setStatus(result.reason, true)
          return
        }
        ctx.markDirty()
        ctx.setStatus(`Deleted category ${categoryId}`)
        const left = ids()
        showCategory(left[Math.min(i, left.length - 1)])
      })

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
        if (categoryId === null) {
          ctx.setStatus('Pick a category to add a root node', true)
          return
        }
        const { x, y } = canvasPoint(e)
        const node = createNode(uniqueId(tree), { x: snap(x), y: snap(y) })
        addNode(tree, null, node, categoryId)
        selectedId = node.id
        ctx.markDirty()
        ctx.setStatus(`Added ${node.id}`)
        syncCategoryBar()
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
        addNode(tree, selectedId, node, categoryId ?? undefined)
        selectedId = node.id
        ctx.markDirty()
        ctx.setStatus(`Added ${node.id}`)
        syncCategoryBar()
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
        syncCategoryBar()
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
