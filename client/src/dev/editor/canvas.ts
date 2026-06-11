/**
 * Editor canvas rendering — turns the working tree into positioned node cards
 * plus prerequisite edges. Pure string building; the pan/zoom shell and event
 * wiring live in `index.ts`.
 */

import type { TreeFile } from '@game/shared'
import { walkPositioned, prerequisiteRefs, type PositionedNode } from './model.js'

/** Node card footprint, in world coordinates (used to center edges). */
export const NODE_W = 132
export const NODE_H = 60

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
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const { x, y } of positioned) {
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x + NODE_W)
    maxY = Math.max(maxY, y + NODE_H)
  }
  return { minX, minY, maxX, maxY }
}

function renderNode(p: PositionedNode, selectedId: string | null): string {
  const { node, x, y } = p
  const selected = node.id === selectedId ? ' selected' : ''
  const limit = node.purchaseLimit === null ? '∞' : String(node.purchaseLimit)
  return `
    <div class="ed-node${selected}" data-node-id="${escapeHtml(node.id)}"
         style="left:${x}px; top:${y}px; width:${NODE_W}px; height:${NODE_H}px">
      <span class="ed-node-id">${escapeHtml(node.id)}</span>
      <span class="ed-node-cost">${escapeHtml(costSummary(node.cost))}</span>
      <span class="ed-node-limit">×${limit}</span>
    </div>`
}

function renderEdges(positioned: readonly PositionedNode[]): string {
  const byId = new Map(positioned.map((p) => [p.node.id, p]))
  const lines: string[] = []
  for (const target of positioned) {
    for (const refId of prerequisiteRefs(target.node)) {
      const source = byId.get(refId)
      if (!source) continue
      const x1 = source.x + NODE_W / 2
      const y1 = source.y + NODE_H / 2
      const x2 = target.x + NODE_W / 2
      const y2 = target.y + NODE_H / 2
      lines.push(`<line class="ed-edge" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" />`)
    }
  }
  return lines.join('')
}

/** Build the canvas inner content (edges + node cards) and its bounds. */
export function renderCanvas(tree: TreeFile, selectedId: string | null): CanvasRender {
  const positioned = walkPositioned(tree)
  return {
    edgesSvg: renderEdges(positioned),
    nodes: positioned.map((p) => renderNode(p, selectedId)).join(''),
    bounds: computeBounds(positioned),
  }
}
