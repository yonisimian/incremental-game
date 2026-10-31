// ─── Upgrade Tree Reader ─────────────────────────────────────────────
//
// The whole upgrade tree, readable before playing — opened from the About
// dialog. It is the in-game tree (same renderer, pan/zoom and detail popup)
// minus buying: every node draws at full strength, and its popup has Close
// instead of Buy. Costs are a round's starting costs. It shows the full tree
// whatever the tree visibility setting: the player asked to see it.

import {
  DEFAULT_MODE,
  getAvailableModes,
  getModeDefinition,
  getModeFlavor,
  isAvailableMode,
  type GameMode,
} from '@game/shared'
import { type GameState, getState, startingPlayer } from '../game.js'
import { renderUpgradeTree, type TreeBounds } from './components.js'
import { bindUpgradeEvents, escapeAttr } from './helpers.js'
import { openModal } from './modal.js'
import { setupPanZoom, type PanZoomHandle, type PanZoomState } from './pan-zoom.js'
import { MAX_ZOOM, MIN_ZOOM, renderTreeShell } from './panels/upgrade-tree-panel.js'
import { openUpgradeDetail, resetUpgradeDetail } from './upgrade-detail.js'

/** Room kept around the tree when fitting it to the viewport: half a node plus a gap. */
const FIT_MARGIN = 64

let panZoom: PanZoomHandle | null = null

/**
 * `mode`'s tree as a round starts. No goal is chosen yet, so every goal's
 * upgrades show (the Race to Buy trophy among them).
 */
function readerState(mode: GameMode): Readonly<GameState> {
  const modeDef = getModeDefinition(mode)
  return {
    ...getState(),
    mode,
    goal: null,
    upgrades: modeDef.upgrades,
    player: startingPlayer(modeDef),
  }
}

/** Center the tree and zoom so all of it fits, never past 1:1. */
function fitToView(viewport: HTMLElement, bounds: TreeBounds): PanZoomState {
  // client* sizes, not the bounding rect: they ignore the dialog's opening scale.
  const { clientWidth: vw, clientHeight: vh } = viewport
  const fit = Math.min(
    vw / (bounds.maxX - bounds.minX + 2 * FIT_MARGIN),
    vh / (bounds.maxY - bounds.minY + 2 * FIT_MARGIN),
  )
  const zoom = Math.min(1, Math.max(MIN_ZOOM, fit))
  return {
    panX: vw / 2 - ((bounds.minX + bounds.maxX) / 2) * zoom,
    panY: vh / 2 - ((bounds.minY + bounds.maxY) / 2) * zoom,
    zoom,
  }
}

/** Draw `mode`'s tree into the stage, replacing whatever was there. */
function showMode(stage: HTMLElement, mode: GameMode): void {
  panZoom?.cleanup()
  resetUpgradeDetail()
  const state = readerState(mode)
  const { edgesSvg, nodes, bounds } = renderUpgradeTree(state, { plain: true })
  stage.className = `tree-reader-stage ${getModeFlavor(getModeDefinition(mode)).themeClass}`
  stage.innerHTML = renderTreeShell(edgesSvg, nodes, bounds)

  const viewport = stage.querySelector<HTMLElement>('.tree-viewport')!
  const canvas = stage.querySelector<HTMLElement>('.tree-canvas')!
  panZoom = setupPanZoom(viewport, canvas, {
    initialState: fitToView(viewport, bounds),
    minZoom: MIN_ZOOM,
    maxZoom: MAX_ZOOM,
  })
  bindUpgradeEvents(canvas.id, (id) => {
    openUpgradeDetail(id, { state, readOnly: true })
  })
}

/** One chip per mode, like the room's picker; nothing when there's only one. */
function renderModeChips(selected: GameMode): string {
  const modes = getAvailableModes()
  if (modes.length < 2) return ''
  const chips = modes
    .map((m) => {
      const cls = m === selected ? ' selected' : ''
      const name = getModeFlavor(getModeDefinition(m)).displayName
      return `<button class="mode-chip${cls}" data-mode="${m}">${escapeAttr(name)}</button>`
    })
    .join('')
  return `<div class="mode-chips" id="tree-reader-modes">${chips}</div>`
}

export function openTreeReader(): void {
  const overlay = openModal(
    'tree-reader-overlay',
    'Upgrade tree',
    `<div class="modal-body tree-reader-body">
      ${renderModeChips(DEFAULT_MODE)}
      <p class="tree-reader-hint">
        Every upgrade, as a round starts. Open one to read what it does; lines lead
        to the upgrades it unlocks.
      </p>
      <div class="tree-reader-stage" id="tree-reader-stage"></div>
    </div>`,
  )
  if (!overlay) return
  overlay.querySelector('.modal')!.classList.add('modal-wide')

  const stage = overlay.querySelector<HTMLElement>('#tree-reader-stage')!
  showMode(stage, DEFAULT_MODE)

  overlay.querySelectorAll<HTMLButtonElement>('#tree-reader-modes .mode-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const mode = chip.dataset.mode
      if (!isAvailableMode(mode)) return
      overlay.querySelectorAll('#tree-reader-modes .mode-chip').forEach((c) => {
        c.classList.toggle('selected', c === chip)
      })
      showMode(stage, mode)
    })
  })
}
