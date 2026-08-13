/**
 * The highlight-battery ("lantern") bar shown above the highlight selector.
 *
 * The charge is authoritative server state (`meta.hlCharge`) arriving on each
 * `STATE_UPDATE` — every 500 ms. A meter redrawn only on those snapshots visibly
 * steps twice a second, and unlike a resource counter the whole point of this one
 * is continuous motion, so the bar **extrapolates between snapshots**: anchor the
 * last authoritative charge with a timestamp, then advance it at the collected
 * charge/drain rate on a rAF loop. Same anchor-and-predict shape the round timer
 * uses in `playing.ts`.
 *
 * The extrapolation is display-only. Nothing reads it back, and every snapshot
 * resnaps the anchor, so a mispredicted frame can't accumulate or influence a
 * purchase decision.
 */

import {
  collectBatteryParams,
  getModeDefinition,
  isHighlightBatteryActive,
  readBatteryCharge,
  readHighlight,
} from '@game/shared'
import type { BatteryParams } from '@game/shared'
import type { GameState } from '../../game.js'
import { formatNumber } from '../format-number.js'
import { setText } from '../helpers.js'

/** Stable id of the bar's root, so the play panel can find/inject/remove it. */
export const BATTERY_BAR_ID = 'battery-bar'

/** The last authoritative charge, plus what it was doing at that moment. */
export interface ChargeAnchor {
  charge: number
  atMs: number
  /** Whether a resource was held (draining) rather than released (charging). */
  held: boolean
  paused: boolean
  params: BatteryParams
}

let anchor: ChargeAnchor | null = null
let rafId: number | null = null

/** Markup for the bar. Empty when the battery isn't unlocked yet. */
export function renderBatteryBar(state: Readonly<GameState>): string {
  const modeDef = getModeDefinition(state.mode!)
  if (!isHighlightBatteryActive(state.player, modeDef)) return ''
  return `
    <div class="battery-bar" id="${BATTERY_BAR_ID}">
      <span class="battery-bar-icon" aria-hidden="true">🪔</span>
      <div
        class="battery-bar-track"
        role="meter"
        aria-label="Lantern charge"
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow="0"
        id="battery-bar-track"
      >
        <div class="battery-bar-fill" id="battery-bar-fill"></div>
      </div>
      <span class="battery-bar-value" id="battery-bar-value">—</span>
    </div>
  `
}

/**
 * Re-anchor from an authoritative snapshot. Called from the panel's `update`, so
 * it runs on every `STATE_UPDATE` and on every local action.
 */
export function syncBatteryBar(state: Readonly<GameState>): void {
  const modeDef = getModeDefinition(state.mode!)
  const charge = readBatteryCharge(state.player)
  if (charge === null || !isHighlightBatteryActive(state.player, modeDef)) {
    stopBatteryBar()
    return
  }
  anchor = {
    charge,
    atMs: performance.now(),
    held: readHighlight(state.player) !== null,
    paused: state.paused,
    params: collectBatteryParams(state.player, modeDef),
  }
  paint()
  // A paused round stops the server's tick, so the charge is frozen — no point
  // animating, and predicting through the pause would drift.
  if (state.paused) stopBatteryBar()
  else rafId ??= requestAnimationFrame(loop)
}

/**
 * Stop animating and forget the anchor. Reached when the battery is gone, the
 * round pauses, or the bar leaves the DOM (tab switch, screen change, re-render)
 * — the last of which the loop detects for itself, since `Panel` has no unmount
 * hook to hang a teardown on.
 */
function stopBatteryBar(): void {
  if (rafId !== null) cancelAnimationFrame(rafId)
  rafId = null
  anchor = null
}

/**
 * An anchored charge advanced to `nowMs`, clamped to the tank. Pure, so the
 * prediction is testable without a DOM (the client test env has none).
 */
export function predictCharge(a: ChargeAnchor, nowMs: number): number {
  const rate = a.held ? -a.params.drainRate : a.params.chargeRate
  const advanced = a.charge + rate * ((nowMs - a.atMs) / 1000)
  return Math.min(a.params.maxCharge, Math.max(0, advanced))
}

/**
 * The text beside the bar. Seconds left (or to full) is what a player actually
 * plans against — raw charge units mean nothing without knowing the rates.
 *
 * Rounded **up**, so a bar with any charge left never reads `0s left` and a full
 * tank reads its whole duration. (Don't reach for `formatNumber`'s `decimals`
 * here: the default notation is scientific, which ignores it and floors instead —
 * 9.99 units at 1/sec would have read `9s left`.)
 */
export function batteryBarLabel(charge: number, params: BatteryParams, held: boolean): string {
  if (held) {
    if (charge <= 0) return 'empty'
    return `${formatNumber(Math.ceil(charge / params.drainRate))}s left`
  }
  if (charge >= params.maxCharge) return 'full'
  return `${formatNumber(Math.ceil((params.maxCharge - charge) / params.chargeRate))}s to full`
}

function paint(): void {
  if (!anchor) return
  const { params, held } = anchor
  const charge = predictCharge(anchor, performance.now())
  const pct = (charge / params.maxCharge) * 100

  const fill = document.getElementById('battery-bar-fill')
  if (fill) fill.style.width = `${pct}%`

  const track = document.getElementById('battery-bar-track')
  if (track) {
    track.setAttribute('aria-valuenow', String(Math.round(pct)))
    // Empty is the state worth noticing — it's when the bonus is gone.
    track.classList.toggle('empty', charge <= 0)
    track.classList.toggle('draining', held && charge > 0)
  }

  setText('battery-bar-value', batteryBarLabel(charge, params, held))
}

function loop(): void {
  // The bar leaving the DOM is the panel's unmount signal: keep animating and
  // we'd burn a frame forever painting into nothing.
  if (!anchor || anchor.paused || !document.getElementById(BATTERY_BAR_ID)) {
    rafId = null
    anchor = null
    return
  }
  paint()
  rafId = requestAnimationFrame(loop)
}
