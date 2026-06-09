import type { GameState } from '../game.js'
import {
  canAfford,
  escapeAttr,
  formatCostLabel,
  isUnlocked,
  formatTime,
  formatScore,
  playerDisplayName,
  opponentDisplayName,
} from './helpers.js'
import {
  getModeDefinition,
  getPrerequisiteUpgradeIds,
  getUpgradeName,
  getUpgradeIcon,
  isChoiceGroupAvailable,
  isMaxed,
  isUnlimited,
  getUpgradeNextCost,
} from '@game/shared'

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

// ─── Upgrade Tree ────────────────────────────────────────────────────

/** Bounding box of all tree-node positions. Used to size the SVG and seed initial pan. */
export interface TreeBounds {
  readonly minX: number
  readonly maxX: number
  readonly minY: number
  readonly maxY: number
}

/** Output of `renderUpgradeTree` — separate edges and nodes layers + bounds. */
interface UpgradeTreeRender {
  readonly edgesSvg: string
  readonly nodes: string
  readonly bounds: TreeBounds
}

/**
 * Render the tree-category upgrades as a graph: SVG `<line>` edges between
 * each prereq → upgrade pair, plus absolutely-positioned `.upgrade-btn.tree-node`
 * buttons. Returns each layer as a string and a bounding box.
 *
 * Nodes are **icon-only**: the upgrade's glyph is the entire button body, with
 * the name exposed via `aria-label`/`title` (plus the cost). Clicking a node
 * opens the detail popup (see `upgrade-detail.ts`) rather than buying directly,
 * so nodes are **never** `disabled` — even locked ones open the popup, which
 * explains why they can't be bought yet.
 *
 * State-class derivation per node (top-down, first match wins):
 *   `.locked`         — !isUnlocked  (overrides everything)
 *   `.owned`          — isUnlocked + reached purchaseLimit
 *   `.too-expensive`  — isUnlocked + !canAfford + not(capped)
 *   (none)            — buyable
 */
export function renderUpgradeTree(state: Readonly<GameState>): UpgradeTreeRender {
  const modeDef = getModeDefinition(state.mode!)
  const flavor = modeDef.flavor
  const tree = state.upgrades

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
    for (const pid of getPrerequisiteUpgradeIds(u.prerequisites)) {
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

  // Nodes — fixed-size, icon-only buttons. Name/cost/description live in the
  // detail popup opened on click; here we only surface the icon plus an
  // accessible label and a hover title (name + cost). No `disabled`: locked
  // nodes are still clickable so the popup can explain why they're locked.
  const nodes = tree
    .map((u) => {
      if (!u.position) return ''
      const owned = state.player.upgrades[u.id] ?? 0
      const unlocked = isUnlocked(state, u)
      const affordable = canAfford(state, u)
      const maxed = isMaxed(u, owned)
      const choiceBlocked = !isChoiceGroupAvailable(u, state.player, modeDef.upgrades)

      // State-class derivation (mutually exclusive, in priority order)
      let stateClass = ''
      if (!unlocked) stateClass = 'locked'
      else if (maxed) stateClass = 'owned'
      else if (choiceBlocked) stateClass = 'locked'
      else if (!affordable) stateClass = 'too-expensive'

      const countLabel = isUnlimited(u) && owned > 0 ? ` (×${owned})` : ''
      const nextCost = getUpgradeNextCost(u, owned)
      const costLabel = maxed ? 'Maxed' : `${formatCostLabel(nextCost, flavor)}${countLabel}`
      const name = getUpgradeName(flavor, u.id)
      const icon = getUpgradeIcon(flavor, u.id)
      // Accessible label / hover title: name + current cost (or Maxed).
      const title = `${name} — ${costLabel}`
      const ownedBadge = maxed ? '<span class="tree-node-badge" aria-hidden="true">✓</span>' : ''

      return `
        <button
          class="upgrade-btn tree-node ${stateClass}"
          data-upgrade="${u.id}"
          style="left: ${u.position.x}px; top: ${u.position.y}px"
          aria-label="${escapeAttr(title)}"
          title="${escapeAttr(title)}"
        >
          <span class="tree-node-icon" aria-hidden="true">${icon}</span>
          ${ownedBadge}
        </button>
      `
    })
    .join('')

  return { edgesSvg, nodes, bounds }
}
