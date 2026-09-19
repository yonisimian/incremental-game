// The header's attack-alert badge (plan 41): an always-visible countdown to the
// soonest enemy strike inside the player's alert lead, sitting under the Quit
// button. Owns its own interpolation — the server broadcasts every 500ms, and a
// badge stepping in half-seconds beside the header's smooth timer would look
// like a different clock — so it anchors to each snapshot's `meta.gameSec` and
// counts forward on `performance.now()`, frozen while paused, exactly as the
// timer does. Display-only: nothing reads the interpolated value back.

import type { GameState } from '../game.js'
import type { IncomingAttack, ModeFlavor } from '@game/shared'
import { getAttackIcon, getAttackName } from '@game/shared'

/** Under this many seconds the badge pulses — the strike is about to land. */
const IMMINENT_SEC = 2

/** What the badge shows for the soonest inbound strike, or `null` for none. */
export interface AttackAlertView {
  /** The strike's name when revealed, else a generic label. */
  readonly label: string
  /** Seconds until it lands, floored at zero. */
  readonly remainingSec: number
  /** How many *other* strikes are also inside the lead. */
  readonly others: number
}

/** The soonest inbound strike, or `null` when nothing is in the lead. */
function soonest(list: readonly IncomingAttack[]): IncomingAttack | null {
  let best: IncomingAttack | null = null
  for (const a of list) if (best === null || a.readyAtSec < best.readyAtSec) best = a
  return best
}

/**
 * Resolve the badge's content at `gameSec` — the interpolated game clock, or a
 * snapshot's value when no interpolation is wanted. Pure, so the countdown's
 * arithmetic and the label are testable without a DOM.
 */
export function attackAlertView(
  state: Readonly<GameState>,
  flavor: ModeFlavor,
  gameSec: number,
): AttackAlertView | null {
  const next = soonest(state.incomingAttacks)
  if (!next) return null
  const label = next.attack
    ? `${getAttackIcon(flavor, next.attack)} ${getAttackName(flavor, next.attack)}`
    : 'Incoming attack'
  return {
    label,
    remainingSec: Math.max(0, next.readyAtSec - gameSec),
    others: state.incomingAttacks.length - 1,
  }
}

/** The countdown text: tenths while counting, `now!` once the strike is due. */
export function formatAlertRemaining(remainingSec: number): string {
  return remainingSec > 0 ? `${remainingSec.toFixed(1)}s` : 'now!'
}

/** The badge's markup, hidden until a strike is inside the lead. */
export function renderAttackAlertBadge(): string {
  return `
    <div class="attack-alert" id="attack-alert" role="status" hidden>
      <span class="attack-alert-icon">⚠️</span>
      <span class="attack-alert-name" id="attack-alert-name"></span>
      <span class="attack-alert-time" id="attack-alert-time"></span>
    </div>
  `
}

// ─── Interpolation ───────────────────────────────────────────────────

let anchorGameSec = Number.NaN
let anchorPerf = 0
let rafId: number | null = null
/** The state and flavor the rAF loop reads between snapshots. */
let current: { state: Readonly<GameState>; flavor: ModeFlavor } | null = null

/** The game clock now: the last snapshot's `meta.gameSec` plus time since, frozen while paused. */
function predictedGameSec(state: Readonly<GameState>): number {
  const snapshot = (state.player.meta.gameSec as number | undefined) ?? 0
  if (state.paused || Number.isNaN(anchorGameSec)) return snapshot
  return anchorGameSec + (performance.now() - anchorPerf) / 1000
}

/**
 * Re-anchor whenever the authoritative `meta.gameSec` changes (a fresh snapshot)
 * so interpolation only ever counts forward from a known-good value. A local
 * click also notifies the UI but leaves `gameSec` alone, so it re-anchors nothing.
 */
function syncAnchor(state: Readonly<GameState>): void {
  const snapshot = (state.player.meta.gameSec as number | undefined) ?? 0
  if (snapshot !== anchorGameSec) {
    anchorGameSec = snapshot
    anchorPerf = performance.now()
  }
}

/** Paint the badge from a resolved view (or hide it). */
function paint(view: AttackAlertView | null): void {
  const badge = document.getElementById('attack-alert')
  if (!badge) return
  badge.hidden = view === null
  if (!view) return
  const name = document.getElementById('attack-alert-name')
  const time = document.getElementById('attack-alert-time')
  if (name) name.textContent = view.others > 0 ? `${view.label} +${view.others}` : view.label
  if (time) time.textContent = formatAlertRemaining(view.remainingSec)
  badge.classList.toggle('attack-alert--imminent', view.remainingSec < IMMINENT_SEC)
}

function tick(): void {
  rafId = null
  if (!current) return
  const { state, flavor } = current
  if (state.screen !== 'playing' || state.paused || state.incomingAttacks.length === 0) return
  paint(attackAlertView(state, flavor, predictedGameSec(state)))
  rafId = requestAnimationFrame(tick)
}

/**
 * Refresh the badge for `state` — called from the playing screen's in-place
 * update on every state change. Re-anchors on a fresh snapshot, paints the
 * current view, and keeps a rAF loop alive only while a strike is inbound and
 * the match is running, so a quiet round costs no frames.
 */
export function updateAttackAlertBadge(state: Readonly<GameState>, flavor: ModeFlavor): void {
  syncAnchor(state)
  current = { state, flavor }
  paint(attackAlertView(state, flavor, predictedGameSec(state)))
  const live = state.screen === 'playing' && !state.paused && state.incomingAttacks.length > 0
  if (live && rafId === null && typeof requestAnimationFrame === 'function') {
    rafId = requestAnimationFrame(tick)
  }
}

/** Forget the anchor and the held state — for a fresh screen or a test. */
export function resetAttackAlertBadge(): void {
  anchorGameSec = Number.NaN
  anchorPerf = 0
  current = null
  if (rafId !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafId)
  rafId = null
}
