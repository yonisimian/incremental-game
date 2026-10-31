// ─── Upgrade Tree Reader ─────────────────────────────────────────────
//
// The whole upgrade tree, readable before playing — opened from the About
// dialog. It is the in-game tree (same mount, pan/zoom and detail popup)
// minus buying: nodes are styled only by what gates every player, and the
// popup has Close instead of Buy. Costs are a round's starting costs. It shows
// the full tree whatever the tree visibility setting: the player asked to see it.

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
import { escapeAttr } from './helpers.js'
import { openModal } from './modal.js'
import { centeredPanZoom, type PanZoomHandle, type PanZoomState } from './pan-zoom.js'
import { MIN_ZOOM, mountTreeView } from './tree-view.js'
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
  const fit = Math.min(
    viewport.clientWidth / (bounds.maxX - bounds.minX + 2 * FIT_MARGIN),
    viewport.clientHeight / (bounds.maxY - bounds.minY + 2 * FIT_MARGIN),
  )
  return centeredPanZoom(viewport, bounds, Math.min(1, Math.max(MIN_ZOOM, fit)))
}

/** Drop the current tree's pan/zoom listeners and popup state. */
function teardown(): void {
  panZoom?.cleanup()
  panZoom = null
  resetUpgradeDetail()
}

/** Draw `mode`'s tree into the stage, replacing whatever was there. */
function showMode(stage: HTMLElement, mode: GameMode): void {
  teardown()
  const state = readerState(mode)
  const tree = renderUpgradeTree(state, { plain: true })
  stage.className = `tree-reader-stage ${getModeFlavor(getModeDefinition(mode)).themeClass}`
  const view = mountTreeView(stage, tree, {
    initialState: (viewport) => fitToView(viewport, tree.bounds),
    onActivate: (id) => {
      openUpgradeDetail(id, { state, readOnly: true, host: view.viewport })
    },
  })
  panZoom = view.panZoom
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
    { wide: true, onClose: teardown },
  )
  if (!overlay) return

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
