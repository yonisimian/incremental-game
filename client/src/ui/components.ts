import type { GameState } from '../game.js'
import {
  canAfford,
  isUnlocked,
  formatTime,
  formatScore,
  playerDisplayName,
  opponentDisplayName,
  UPGRADE_HOTKEYS,
} from './helpers.js'
import type { UpgradeDefinition } from '@game/shared'

// ─── Goal Header Components ─────────────────────────────────────────

/** The timer element — styled as a safety-cap timer for non-timed goals. */
export function renderTimer(state: Readonly<GameState>): string {
  const isSafetyCap = state.goal?.type === 'target-score' || state.goal?.type === 'buy-upgrade'
  const cls = isSafetyCap ? 'timer safety-timer' : 'timer'
  return `<div class="${cls}" id="timer">${formatTime(state.timeLeft)}</div>`
}

/**
 * Full-width progress bars with embedded score labels for target-score mode.
 * Returns empty string for timed goals (no bars needed).
 */
export function renderProgressBars(state: Readonly<GameState>): string {
  if (state.goal?.type !== 'target-score') return ''
  const target = state.goal.target
  const playerPct = Math.min(100, (state.player.score / target) * 100)
  const opponentPct = Math.min(100, (state.opponent.score / target) * 100)
  return `
    <div class="target-progress">
      <div class="progress-row you">
        <div class="progress-bar bar-you">
          <div class="progress-fill you" id="player-progress" style="width:${playerPct}%"></div>
          <span class="bar-label">${playerDisplayName(state)}: <span id="player-bar-score">${formatScore(state.player.score, state)}</span></span>
        </div>
      </div>
      <div class="progress-row opponent">
        <div class="progress-bar bar-opponent">
          <div class="progress-fill opponent" id="opponent-progress" style="width:${opponentPct}%"></div>
          <span class="bar-label">${opponentDisplayName(state)}: <span id="opponent-bar-score">${formatScore(state.opponent.score, state)}</span></span>
        </div>
      </div>
    </div>
  `
}

// ─── Upgrades ────────────────────────────────────────────────────────

export function renderClickerUpgrades(state: Readonly<GameState>): string {
  return state.upgrades
    .map((u, i) => {
      const owned = state.player.upgrades[u.id]
      const affordable = canAfford(state, u)
      const disabled = owned || !affordable
      const hotkey = i + 1
      return `
        <button
          class="upgrade-btn ${owned ? 'owned' : ''} ${!affordable && !owned ? 'too-expensive' : ''}"
          data-upgrade="${u.id}"
          ${disabled ? 'disabled' : ''}
        >
          <span class="upgrade-name">${u.name}</span>
          <span class="upgrade-cost">${owned ? '✓' : `$${u.cost}`}</span>
          <span class="upgrade-desc">${u.description}</span>
          <span class="upgrade-hotkey" aria-hidden="true">${hotkey}</span>
        </button>
      `
    })
    .join('')
}

/** Renders play-category idler upgrades only. Tree-category upgrades are rendered by `renderUpgradeTree`. */
export function renderIdlerUpgrades(state: Readonly<GameState>): string {
  return state.upgrades
    .filter((u) => (u.category ?? 'play') === 'play')
    .map((u: UpgradeDefinition, i: number) => {
      const owned = state.player.upgrades[u.id]
      const affordable = canAfford(state, u)
      const disabled = (!u.repeatable && owned) || !affordable
      const emoji = u.costCurrency === 'wood' ? '🪵' : '🍺'
      const count = u.repeatable ? owned || 0 : 0
      const costLabel =
        !u.repeatable && owned ? '✓' : `${u.cost} ${emoji}${count > 0 ? ` (×${count})` : ''}`
      const hotkey = UPGRADE_HOTKEYS.play?.[i] ?? ''
      return `
        <button
          class="upgrade-btn ${!u.repeatable && owned ? 'owned' : ''} ${!affordable && !(owned && !u.repeatable) ? 'too-expensive' : ''}"
          data-upgrade="${u.id}"
          ${disabled ? 'disabled' : ''}
        >
          <span class="upgrade-name">${u.name}</span>
          <span class="upgrade-cost">${costLabel}</span>
          <span class="upgrade-desc">${u.description}</span>
          ${hotkey ? `<span class="upgrade-hotkey" aria-hidden="true">${hotkey}</span>` : ''}
        </button>
      `
    })
    .join('')
}

// ─── Upgrade Tree ────────────────────────────────────────────────────

/** Bounding box of all tree-node positions. Used to size the SVG and seed initial pan. */
export interface TreeBounds {
  readonly minX: number
  readonly maxX: number
  readonly minY: number
  readonly maxY: number
}

/** Output of `renderUpgradeTree` — separate edges and nodes layers + bounds. */
export interface UpgradeTreeRender {
  readonly edgesSvg: string
  readonly nodes: string
  readonly bounds: TreeBounds
}

/**
 * Render the tree-category upgrades as a graph: SVG `<line>` edges between
 * each prereq → upgrade pair, plus absolutely-positioned `.upgrade-btn.tree-node`
 * buttons. Returns each layer as a string and a bounding box.
 *
 * State-class derivation per node (top-down, first match wins):
 *   `.locked`         — !isUnlocked  (overrides everything)
 *   `.owned`          — isUnlocked + owned > 0 + !repeatable
 *   `.too-expensive`  — isUnlocked + !canAfford + not(owned + !repeatable)
 *   (none)            — buyable
 *
 * `disabled` attr is set whenever the node isn't currently buyable. Hotkey
 * label is suppressed only on locked nodes (owned/too-expensive keep it).
 */
export function renderUpgradeTree(state: Readonly<GameState>): UpgradeTreeRender {
  const tree = state.upgrades.filter((u) => u.category === 'tree')

  // Bounds — initialize with sentinels so the first node defines the box (not
  // 0,0). Otherwise a tree whose nodes all sit far from origin gets bogus
  // bounds anchored at (0,0), and the panel's centering math drifts off.
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const u of tree) {
    const p = u.position
    if (!p) continue
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }
  // Empty-tree fallback (no positioned nodes) — collapse to (0,0,0,0).
  if (minX === Infinity) {
    minX = 0
    maxX = 0
    minY = 0
    maxY = 0
  }
  const bounds: TreeBounds = { minX, maxX, minY, maxY }

  // Edges — one `<line>` per prereq → upgrade pair.
  const positionById = new Map<string, { x: number; y: number }>()
  for (const u of tree) {
    if (u.position) positionById.set(u.id, u.position)
  }
  // Pad each line endpoint by this many pixels so lines stop short of node
  // centers and never visually pass "behind" a node body (even when locked
  // styling reduces background opacity).
  const NODE_CLEARANCE = 60
  const edgeLines: string[] = []
  for (const u of tree) {
    if (!u.position) continue
    const childUnlocked = isUnlocked(state, u)
    const cls = childUnlocked ? 'unlocked' : ''
    for (const pid of u.prerequisites ?? []) {
      const parent = positionById.get(pid)
      if (!parent) continue
      const dx = u.position.x - parent.x
      const dy = u.position.y - parent.y
      const len = Math.hypot(dx, dy)
      if (len < 2 * NODE_CLEARANCE) continue // too short — skip rather than render a degenerate stub
      const ux = dx / len
      const uy = dy / len
      const x1 = parent.x + ux * NODE_CLEARANCE
      const y1 = parent.y + uy * NODE_CLEARANCE
      const x2 = u.position.x - ux * NODE_CLEARANCE
      const y2 = u.position.y - uy * NODE_CLEARANCE
      edgeLines.push(
        `<line class="${cls}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" vector-effect="non-scaling-stroke" />`,
      )
    }
  }
  const edgesSvg = edgeLines.join('')

  // Nodes — reuse .upgrade-btn markup with .tree-node + state modifiers.
  // Tree-panel upgrades have no per-index hotkeys (see TODO: generic tree
  // hotkeys like buy-cheapest / buy-all). No `.upgrade-hotkey` span emitted.
  const nodes = tree
    .map((u) => {
      if (!u.position) return ''
      const owned = state.player.upgrades[u.id] ?? 0
      const unlocked = isUnlocked(state, u)
      const affordable = canAfford(state, u)
      const ownedOneShot = owned > 0 && !u.repeatable

      // State-class derivation (mutually exclusive, in priority order)
      let stateClass = ''
      if (!unlocked) stateClass = 'locked'
      else if (ownedOneShot) stateClass = 'owned'
      else if (!affordable) stateClass = 'too-expensive'

      const buyable = unlocked && affordable && !ownedOneShot
      const disabled = !buyable

      const emoji = u.costCurrency === 'wood' ? '🪵' : '🍺'
      const count = u.repeatable ? owned : 0
      const costLabel = ownedOneShot ? '✓' : `${u.cost} ${emoji}${count > 0 ? ` (×${count})` : ''}`

      return `
        <button
          class="upgrade-btn tree-node ${stateClass}"
          data-upgrade="${u.id}"
          style="left: ${u.position.x}px; top: ${u.position.y}px"
          ${disabled ? 'disabled' : ''}
        >
          <span class="upgrade-name">${u.name}</span>
          <span class="upgrade-cost">${costLabel}</span>
          <span class="upgrade-desc">${u.description}</span>
        </button>
      `
    })
    .join('')

  return { edgesSvg, nodes, bounds }
}
