import { getCategoryName, getModeDefinition, getModeFlavor } from '@game/shared'
import { type Panel, renderActivePanel } from '../panels.js'
import { type GameState, getState, startingPlayer } from '../../game.js'
import { renderUpgradeTree, type TreeBounds } from '../components.js'
import { getTreeVisibility, unlockedUpgradeIds, visibleUpgradeIds } from '../tree-visibility.js'
import { fitZoom, getTreeCategories, roundCategories, stepCategory } from '../tree-categories.js'
import { bindUpgradeEvents, escapeAttr } from '../helpers.js'
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

// A category opens zoomed to fit the viewport, but no closer than
// `FIT_MAX_ZOOM`, so a one-node category isn't blown up. `FIT_MARGIN` is the
// world-space room around the nodes' centers: half a node plus some air.
const FIT_MAX_ZOOM = 1
const FIT_MARGIN = 64

/** The reveal animation that always runs (reduced motion too); its end clears the pulse. */
const REVEAL_RING_ANIMATION = 'tree-reveal-ring'

// ─── Module-local pan/zoom state ─────────────────────────────────────
//
// Persists pan/zoom across tab switches within a match (good UX), and resets
// on match boundary (avoid stale state leaking into a fresh run).

let panZoomHandle: PanZoomHandle | null = null
let lastPanZoomState: PanZoomState | null = null
let lastMatchId: string | null = null
let prevHtml = ''

// ─── Module-local reveal state ───────────────────────────────────────
//
// Upgrades the player has already seen this match, and the ones whose reveal
// pulse is still playing. Seeded with what the round's starting state shows,
// so round-start nodes never pulse, but a reveal that happened while another
// tab was open still pulses when the tree first renders.
//
// Seen upgrades stay drawn for the rest of the match, so a node never vanishes
// when the server rejects the optimistic purchase that revealed it. It reads as
// locked instead, as in Peek.
//
// A pulse ends on the ring animation's `animationend` (see bind()), so its
// length lives only in the CSS. Until then every render keeps the `revealed`
// class, because `syncNodes` copies attributes from fresh markup.

let seenIds = new Set<string>()
const pulsing = new Set<string>()

// ─── Module-local category state ─────────────────────────────────────
//
// The category on screen when the player shows one at a time. Reset to the
// round's first at the match boundary and kept across tab switches, like
// pan/zoom. `recenter` makes the next render center on a newly picked category
// instead of restoring the previous one's pan/zoom.

let currentCategory: string | null = null
let recenter = false

// ─── Helpers ─────────────────────────────────────────────────────────

/** The round's non-empty categories when the player shows one at a time, else `null`. */
function shownCategories(state: Readonly<GameState>): readonly string[] | null {
  if (!getTreeCategories()) return null
  const ids = roundCategories(getModeDefinition(state.mode!), state.upgrades)
  return ids.length > 0 ? ids : null
}

/**
 * The ids of the upgrades in the category on screen, or `undefined` for the
 * whole tree. Falls back to the round's first category when none is picked yet.
 */
function categoryScope(state: Readonly<GameState>): ReadonlySet<string> | undefined {
  const ids = shownCategories(state)
  if (!ids) return undefined
  if (currentCategory === null || !ids.includes(currentCategory)) currentCategory = ids[0]
  return new Set(state.upgrades.filter((u) => u.category === currentCategory).map((u) => u.id))
}

/** Record upgrades that became visible since the last render; each starts a pulse. */
function trackReveals(visible: ReadonlySet<string>): void {
  for (const id of visible) {
    if (seenIds.has(id)) continue
    seenIds.add(id)
    pulsing.add(id)
  }
}

/**
 * Render the tree as the player's visibility setting shows it, plus anything
 * already shown this match. On a new match, what the round started with counts
 * as already seen, so it never pulses. Full mode can't hide or pulse anything,
 * so it renders the plain tree.
 */
function renderVisibleTree(state: Readonly<GameState>, newMatch = false) {
  const mode = getTreeVisibility()
  if (newMatch) {
    const start = {
      upgrades: state.upgrades,
      player: startingPlayer(getModeDefinition(state.mode!)),
    }
    seenIds = new Set(visibleUpgradeIds(start, mode))
    pulsing.clear()
  }
  const scope = categoryScope(state)
  if (mode === 'full') return renderUpgradeTree(state, { scope })

  // Reveals are tracked over the whole round, not just the category on screen:
  // a node revealed in another category keeps its pulse until that category is
  // drawn, since only a drawn node's animation can end it.
  const unlocked = unlockedUpgradeIds(state)
  trackReveals(visibleUpgradeIds(state, mode, unlocked))
  return renderUpgradeTree(state, {
    // A superset of what's visible now: everything shown this match stays shown.
    visible: seenIds,
    stubs: mode === 'hidden',
    pulsing,
    unlocked,
    scope,
  })
}

/** End a node's reveal pulse when its ring animation finishes. */
function endPulse(e: AnimationEvent): void {
  if (e.animationName !== REVEAL_RING_ANIMATION) return
  const node = e.target as HTMLElement
  const id = node.dataset.upgrade
  if (id) pulsing.delete(id)
  node.classList.remove('revealed')
}

/**
 * The bar above the tree when categories are on: the category's name as the
 * title, with an arrow to each neighbour (wrapping around) and that neighbour's
 * name above it. No arrows when the round has one category. Call after
 * `renderVisibleTree`, which settles `currentCategory`.
 */
function renderCategoryBar(state: Readonly<GameState>): string {
  const ids = shownCategories(state)
  const current = currentCategory
  if (!ids || current === null) return ''
  const flavor = getModeFlavor(getModeDefinition(state.mode!))
  const name = (id: string) => escapeAttr(getCategoryName(flavor, id))
  const arrow = (step: 1 | -1) => {
    const target = name(stepCategory(ids, current, step))
    const glyph = step === 1 ? '▶' : '◀'
    return `
      <button class="tree-category-arrow" type="button" data-category-step="${step}"
              aria-label="${step === 1 ? 'Next' : 'Previous'} category: ${target}">
        <span class="tree-category-target">${target}</span>
        <span class="tree-category-glyph" aria-hidden="true">${glyph}</span>
      </button>`
  }
  const arrows = ids.length > 1
  return `
    <div class="tree-category-bar">
      ${arrows ? arrow(-1) : ''}
      <h3 class="tree-category-title">${name(current)}</h3>
      ${arrows ? arrow(1) : ''}
    </div>`
}

/** Show the neighbouring category the clicked arrow points at. */
function onCategoryArrow(e: Event): void {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-category-step]')
  if (!btn || currentCategory === null) return
  const state = getState()
  const ids = shownCategories(state)
  if (!ids) return
  // Future: hotkeys and swipe (on mobile) could step categories the same way.
  currentCategory = stepCategory(ids, currentCategory, btn.dataset.categoryStep === '1' ? 1 : -1)
  recenter = true
  renderActivePanel(state)
}

/**
 * Compute centered initial pan so the tree's bounding-box center aligns with
 * viewport center. The whole tree starts at INITIAL_ZOOM; a category is zoomed
 * to fit.
 */
function computeCenteredInitialState(
  viewport: HTMLElement,
  bounds: TreeBounds,
  fit: boolean,
): PanZoomState {
  const treeCx = (bounds.minX + bounds.maxX) / 2
  const treeCy = (bounds.minY + bounds.maxY) / 2
  const vp = viewport.getBoundingClientRect()
  const content = {
    width: bounds.maxX - bounds.minX + 2 * FIT_MARGIN,
    height: bounds.maxY - bounds.minY + 2 * FIT_MARGIN,
  }
  const zoom = fit ? fitZoom(content, vp, INITIAL_ZOOM, FIT_MAX_ZOOM) : INITIAL_ZOOM
  return {
    panX: vp.width / 2 - treeCx * zoom,
    panY: vp.height / 2 - treeCy * zoom,
    zoom,
  }
}

/** Build the static markup wrapper. Inner edges+nodes are recomputed on update(). */
function renderShell(
  edgesSvg: string,
  nodes: string,
  bounds: TreeBounds,
  categoryBar: string,
): string {
  // Size SVG to encompass all node positions; +200px slack handles bounding-box edges.
  // Shift via CSS left/top if any coords go negative so SVG-local (0,0) aligns with canvas (0,0).
  const svgOffsetX = Math.min(0, bounds.minX)
  const svgOffsetY = Math.min(0, bounds.minY)
  const svgW = bounds.maxX - svgOffsetX + 200
  const svgH = bounds.maxY - svgOffsetY + 200
  return `
    ${categoryBar}
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
    //    to centered defaults at the start of every new game, and the reveal
    //    tracking re-seeds in renderVisibleTree.
    //    A newly picked category also starts centered.
    const newMatch = state.matchId !== lastMatchId
    if (newMatch) {
      lastMatchId = state.matchId
      currentCategory = null
    }
    if (newMatch || recenter) {
      lastPanZoomState = null
      recenter = false
    }

    // 3. Build fresh DOM. Re-rendering wipes the container (and any open detail
    //    popup mounted inside the viewport), so clear popup state to match.
    resetUpgradeDetail()
    const { edgesSvg, nodes, bounds } = renderVisibleTree(state, newMatch)
    prevHtml = edgesSvg + nodes
    container.innerHTML = renderShell(edgesSvg, nodes, bounds, renderCategoryBar(state))

    // 4. Wire pan/zoom on the new DOM, seeded from saved state or centered defaults.
    const viewport = document.getElementById('tree-viewport')
    const canvas = document.getElementById('tree-canvas')
    if (viewport && canvas) {
      const fit = shownCategories(state) !== null
      const initialState = lastPanZoomState ?? computeCenteredInitialState(viewport, bounds, fit)
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
    document.getElementById('tree-canvas')?.addEventListener('animationend', endPulse)
    document.querySelector('.tree-category-bar')?.addEventListener('click', onCategoryArrow)
  },

  update(state) {
    // Keep the open detail popup's live fields (cost / Buy-enabled) in sync.
    updateUpgradeDetail(state)
    const { edgesSvg, nodes } = renderVisibleTree(state)
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
 * would drop any click whose pointerdown landed on the old button. A node that
 * wasn't there before (a reveal in the Hidden / Peek modes) goes in at its tree
 * position, so DOM order still matches a full render.
 */
function syncNodes(canvas: HTMLElement, nodesHtml: string): void {
  const template = document.createElement('template')
  template.innerHTML = nodesHtml
  const current = new Map<string, HTMLButtonElement>()
  for (const node of canvas.querySelectorAll<HTMLButtonElement>('.tree-node')) {
    current.set(node.dataset.upgrade ?? '', node)
  }
  // The element the next new node goes after: the edges layer, then each node in turn.
  let prev: Element | null = canvas.querySelector('.tree-edges')
  for (const next of template.content.querySelectorAll<HTMLButtonElement>('.tree-node')) {
    const id = next.dataset.upgrade ?? ''
    const node = current.get(id)
    current.delete(id)
    if (!node) {
      if (prev) prev.after(next)
      else canvas.prepend(next)
      prev = next
      continue
    }
    prev = node
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
