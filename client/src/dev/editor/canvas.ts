/**
 * Editor canvas rendering — turns the working tree into positioned node cards
 * plus prerequisite edges. Pure string building; the pan/zoom shell and event
 * wiring live in `index.ts`.
 */

import type { TreeFile } from '@game/shared'
import { walkPositioned, prerequisiteRefs, type PositionedNode } from './model.js'

/**
 * Node footprint, in world coordinates. Square + icon-only to mirror the
 * production tree node; positions are the node *center* (CSS translate -50%).
 */
export const NODE_SIZE = 64

/** World-space grid step that dragged node positions snap to. */
export const GRID = 24

/** Glyph shown for nodes with no flavor icon (e.g. freshly-added nodes). */
const DEFAULT_ICON = '❓'

export interface CanvasBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export interface CanvasRender {
  readonly edgesSvg: string
  readonly nodes: string
  readonly bounds: CanvasBounds
}

const EMPTY_BOUNDS: CanvasBounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 }

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Short, human-readable summary of a cost map (e.g. `r0:15 · r1:5`). */
function costSummary(cost: Record<string, number>): string {
  const entries = Object.entries(cost)
  if (entries.length === 0) return 'free'
  return entries.map(([k, v]) => `${k}:${v}`).join(' · ')
}

function computeBounds(positioned: readonly PositionedNode[]): CanvasBounds {
  if (positioned.length === 0) return EMPTY_BOUNDS
  const half = NODE_SIZE / 2
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const { x, y } of positioned) {
    minX = Math.min(minX, x - half)
    minY = Math.min(minY, y - half)
    maxX = Math.max(maxX, x + half)
    maxY = Math.max(maxY, y + half)
  }
  return { minX, minY, maxX, maxY }
}

/** Map of upgrade id → icon glyph, taken from the tree's default flavor. */
function iconMap(tree: TreeFile): Map<string, string> {
  const upgrades = tree.flavors[0]?.upgrades ?? []
  return new Map(upgrades.map((u) => [u.id, u.icon]))
}

function renderNode(
  p: PositionedNode,
  selectedId: string | null,
  icons: Map<string, string>,
): string {
  const { node, x, y } = p
  const selected = node.id === selectedId ? ' selected' : ''
  const icon = icons.get(node.id) ?? DEFAULT_ICON
  const limit = node.purchaseLimit === null ? '∞' : String(node.purchaseLimit)
  // Visible body is icon-only (matches production); id/cost/limit live in the
  // hover title here and in the inspector.
  const title = `${node.id} — ${costSummary(node.cost)} · ×${limit}`
  return `
    <div class="ed-node${selected}" data-node-id="${escapeHtml(node.id)}"
         style="left:${x}px; top:${y}px" title="${escapeHtml(title)}">
      <span class="ed-node-icon" aria-hidden="true">${escapeHtml(icon)}</span>
    </div>`
}

function renderEdges(positioned: readonly PositionedNode[]): string {
  const byId = new Map(positioned.map((p) => [p.node.id, p]))
  const lines: string[] = []
  for (const target of positioned) {
    for (const refId of prerequisiteRefs(target.node)) {
      const source = byId.get(refId)
      if (!source) continue
      // Positions are node centers, so edges connect coords directly.
      lines.push(
        `<line class="ed-edge" x1="${source.x}" y1="${source.y}" x2="${target.x}" y2="${target.y}" />`,
      )
    }
  }
  return lines.join('')
}

/** Build the canvas inner content (edges + node cards) and its bounds. */
export function renderCanvas(tree: TreeFile, selectedId: string | null): CanvasRender {
  const positioned = walkPositioned(tree)
  const icons = iconMap(tree)
  return {
    edgesSvg: renderEdges(positioned),
    nodes: positioned.map((p) => renderNode(p, selectedId, icons)).join(''),
    bounds: computeBounds(positioned),
  }
}
