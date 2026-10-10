import type { CostScope, ModeFlavor, UpgradeDefinition } from '@game/shared'
import {
  getResourceIcon,
  getUpgradeName,
  isMaxed,
  isNeutralCostFactors,
  isPrerequisiteSatisfied,
  isUnlimited,
  getUpgradeNextCost,
  NEUTRAL_COST_FACTORS,
  purchaseLockUntilSec,
  upgradeCostFactors,
  TIMER_CENTISECONDS_BELOW_SEC,
} from '@game/shared'
import type { GameState } from '../game.js'
import { doBuy, upgradeBlockReason } from '../game.js'
import { formatNumber } from './format-number.js'
import type { Countdown } from './format-number.js'

// ─── Shared DOM Root ─────────────────────────────────────────────────

// Guarded for non-DOM environments (vitest in node). Production always has #app.
export const app =
  typeof document !== 'undefined'
    ? document.querySelector<HTMLDivElement>('#app')!
    : (null as unknown as HTMLDivElement)

// ─── DOM Helpers ─────────────────────────────────────────────────────

export function setText(id: string, text: string): void {
  const el = document.getElementById(id)
  // Per-frame painters call this with unchanged text most frames.
  if (el && el.textContent !== text) el.textContent = text
}

export function formatTime(seconds: number): string {
  const clamped = Math.max(0, seconds)
  if (clamped < TIMER_CENTISECONDS_BELOW_SEC) {
    const sec = Math.floor(clamped)
    const centi = Math.floor((clamped - sec) * 100)
    return `${sec}:${centi.toString().padStart(2, '0')}`
  }
  return formatDuration(clamped)
}

/** Whole-second `m:ss` for elapsed spans (no centiseconds, unlike the live timer below 10s). */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const min = Math.floor(total / 60)
  const sec = total % 60
  return `${min}:${sec.toString().padStart(2, '0')}`
}

/** The Resign button; frozen with a pending label once a QUIT is in flight. */
export function renderResignButton(state: Readonly<GameState>): string {
  return `<button class="quit-btn" id="resign-btn"${state.resigning ? ' disabled' : ''}>${resignLabel(state)}</button>`
}

/** Keep the rendered Resign button in step with `state.resigning`. */
export function syncResignButton(state: Readonly<GameState>): void {
  const btn = document.getElementById('resign-btn') as HTMLButtonElement | null
  if (btn && btn.disabled !== state.resigning) {
    btn.disabled = state.resigning
    btn.textContent = resignLabel(state)
  }
}

function resignLabel(state: Readonly<GameState>): string {
  return state.resigning ? 'Resigning…' : 'Resign'
}

// ─── Game-Related Helpers ────────────────────────────────────────────

/** Escape HTML-special characters to prevent XSS when interpolating into innerHTML / attributes. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Public alias for escaping untrusted strings inside HTML attribute values. */
export const escapeAttr = escapeHtml

/** Get the display name for the local player ('Player' if empty). */
export function playerDisplayName(state: Readonly<GameState>): string {
  const name = state.playerName.trim()
  return name ? escapeHtml(name) : 'Player'
}

/** Get the display name for the opponent ('Opponent' if empty). */
export function opponentDisplayName(state: Readonly<GameState>): string {
  const name = state.opponentName.trim()
  return name ? escapeHtml(name) : 'Opponent'
}

/** Format a score for the scoreboard (includes target for target-score goal). */
export function formatScore(score: number, state: Readonly<GameState>): string {
  if (state.goal?.type === 'target-score') {
    return `${formatNumber(score)} / ${formatNumber(state.goal.target)}`
  }
  return formatNumber(score)
}

/** Marker appended to a price an opponent's passive attack is inflating. */
export const INFLATED_COST_MARKER = '⬆'
/** Marker appended to a price a pact in force is discounting. */
export const DISCOUNTED_COST_MARKER = '⬇'
/** Price label for an upgrade shown on the tree but not purchasable yet. */
const COMING_SOON_LABEL = '🚧 Coming soon'

/**
 * The marker for a price bent off the authored one: up when the factors in
 * force actually raised it, down when they only lowered it, none when it landed
 * on the tree's own number — a free upgrade, or a growth-only factor on a flat
 * cost, is left unmarked: nothing moved. An inflation and a discount on the
 * same item are marked by where the price landed, since that is the number the
 * player needs explained.
 */
export function costChangeMarker(cost: number, authored: number): string {
  if (cost > authored) return INFLATED_COST_MARKER
  if (cost < authored) return DISCOUNTED_COST_MARKER
  return ''
}

/** {@link costChangeMarker} over a cost map: up if any currency rose, else down if any fell. */
function costMapChangeMarker(
  cost: Readonly<Record<string, number>>,
  authored: Readonly<Record<string, number>>,
): string {
  const marks = Object.entries(cost).map(([currency, amount]) =>
    costChangeMarker(amount, authored[currency] ?? 0),
  )
  if (marks.includes(INFLATED_COST_MARKER)) return INFLATED_COST_MARKER
  if (marks.includes(DISCOUNTED_COST_MARKER)) return DISCOUNTED_COST_MARKER
  return ''
}

/**
 * The next-level price label an upgrade node / detail popup shows: `Maxed`, else
 * the cost map plus the owned count for an unlimited upgrade. A coming-soon
 * upgrade has no price to show, only its label.
 *
 * Priced with the factors in force, so it matches what a buy will actually
 * charge, and marked (see {@link costChangeMarker}) when an opponent's
 * inflation actually raised it or a pact's discount actually lowered it —
 * otherwise a price off the tree's authored number reads as a bug rather than
 * as an attack or a treaty.
 */
export function formatUpgradeCost(
  state: Readonly<GameState>,
  u: UpgradeDefinition,
  flavor: ModeFlavor,
): string {
  if (u.comingSoon) return COMING_SOON_LABEL
  const owned = state.player.upgrades[u.id] ?? 0
  if (isMaxed(u, owned)) return 'Maxed'
  const factors = upgradeCostFactors(state.player, u.id)
  const cost = getUpgradeNextCost(u, owned, factors)
  const countLabel = isUnlimited(u) && owned > 0 ? ` (×${owned})` : ''
  const mark = isNeutralCostFactors(factors)
    ? ''
    : costMapChangeMarker(cost, getUpgradeNextCost(u, owned, NEUTRAL_COST_FACTORS))
  const marker = mark === '' ? '' : ` ${mark}`
  return `${formatCostLabel(cost, flavor)}${countLabel}${marker}`
}

/**
 * Render a cost map as a `"<amount> <icon>"` label, one entry per currency.
 * Module-private: {@link formatUpgradeCost} is the single seam every
 * upgrade price label goes through.
 */
function formatCostLabel(cost: Readonly<Record<string, number>>, flavor: ModeFlavor): string {
  return Object.entries(cost)
    .map(([currency, amount]) => `${formatNumber(amount)} ${getResourceIcon(flavor, currency)}`)
    .join('  ')
}

/** Are this upgrade's prerequisites all owned? Empty / missing prereqs = always unlocked. */
export function isUnlocked(state: Readonly<GameState>, u: UpgradeDefinition): boolean {
  return isPrerequisiteSatisfied(u.prerequisites, state.player)
}

/**
 * The `🔒 Locked Ns` countdown a buy control shows under an enemy purchase lock —
 * one wording for the detail popup and the generator card, so the two agree.
 * `null` when no lock is stamped.
 */
export function purchaseLockCountdown(
  state: Readonly<GameState>,
  scope: CostScope,
  id: string,
): Countdown | null {
  const untilSec = purchaseLockUntilSec(state.player, scope, id)
  return untilSec === null ? null : { template: '🔒 Locked {}s', untilSec }
}

/** Can the player buy this upgrade right now, by the server's own rule? */
export function canBuy(state: Readonly<GameState>, u: UpgradeDefinition): boolean {
  return upgradeBlockReason(state, u.id) === null
}

/** Format purchased upgrade IDs as names with ×N suffix for repeats; preserves first-purchase order; unknown IDs fall back to the raw id. */
export function formatUpgradesPurchased(purchased: readonly string[], flavor: ModeFlavor): string {
  if (purchased.length === 0) return 'none'
  const counts = new Map<string, number>()
  for (const id of purchased) {
    counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  return [...counts]
    .map(([id, n]) => {
      const name = getUpgradeName(flavor, id)
      return n > 1 ? `${name} ×${n}` : name
    })
    .join(', ')
}

/**
 * Bind click handler via event delegation on the given container. Defaults to
 * '#upgrades' and buying directly. Pass `onActivate` to handle node clicks
 * differently (e.g. the tree panel opens a detail popup instead of buying).
 */
export function bindUpgradeEvents(
  containerId = 'upgrades',
  onActivate: (upgradeId: string) => void = doBuy,
): void {
  const container = document.getElementById(containerId)
  if (!container || container.dataset.delegated) return
  container.dataset.delegated = 'true'
  container.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.upgrade-btn')
    if (!btn || btn.disabled) return
    const uid = btn.dataset.upgrade
    if (uid) onActivate(uid)
  })
}
