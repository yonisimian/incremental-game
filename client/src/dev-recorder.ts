/**
 * DevRecorder — thin bridge between the game and the dev panel.
 *
 * When enabled, posts a snapshot to a BroadcastChannel on every
 * state update, allowing the dev panel (in a separate tab) to
 * render live charts of real gameplay data.
 *
 * Activation: the game page loads with `?dev` in the URL, or
 * `localStorage.setItem('dev-recorder', '1')`.
 *
 * Cost when inactive: one boolean check per state-update. No
 * additional dependencies — BroadcastChannel is a native browser API.
 */

import type { GameMode, PlayerState } from '@game/shared'
import { collectModifiers, computePassiveRates, getModeDefinition } from '@game/shared'

// ─── Channel name (shared with dev panel listener) ───────────────────
export const DEV_CHANNEL = 'dev-panel'

// ─── Snapshot shape posted over the channel ──────────────────────────

export interface LiveSnapshot {
  /** Elapsed seconds since round start. */
  timeSec: number
  /** Player score. */
  score: number
  /** Player resources. */
  resources: Record<string, number>
  /** Passive income rates per resource. */
  incomePerSec: Record<string, number>
  /** Owned upgrade counts (keyed by upgrade id). */
  upgrades: Record<string, number>
  /** Owned generator counts (keyed by generator id). */
  generators: Record<string, number>
  /** Current game mode. */
  mode: GameMode
  /** Round duration. */
  roundDurationSec: number
}

/** @public */
export interface LiveRoundStart {
  kind: 'round-start'
  mode: GameMode
  roundDurationSec: number
}

/** @public */
export interface LiveTick {
  kind: 'tick'
  snapshot: LiveSnapshot
}

/** @public */
export interface LiveRoundEnd {
  kind: 'round-end'
  finalScore: number
}

export type DevMessage = LiveRoundStart | LiveTick | LiveRoundEnd

// ─── Recorder state ─────────────────────────────────────────────────

let channel: BroadcastChannel | null = null
let enabled = false
let currentMode: GameMode | null = null
let currentRoundDurationSec = 0

// ─── Public API ──────────────────────────────────────────────────────

/** Check activation flags and open channel if needed. */
export function initDevRecorder(): void {
  const params = new URLSearchParams(window.location.search)
  const flagParam = params.has('dev')
  let flagStorage = false
  try {
    flagStorage = localStorage.getItem('dev-recorder') === '1'
  } catch {
    /* localStorage unavailable */
  }

  if (flagParam || flagStorage) {
    enabled = true
    channel = new BroadcastChannel(DEV_CHANNEL)
  }
}

/** Call when a new round starts. */
export function recorderRoundStart(mode: GameMode, roundDurationSec: number): void {
  if (!enabled) return
  currentMode = mode
  currentRoundDurationSec = roundDurationSec

  channel!.postMessage({
    kind: 'round-start',
    mode,
    roundDurationSec,
  } satisfies LiveRoundStart)
}

/** Call on each STATE_UPDATE (after reconciliation). */
export function recorderTick(player: Readonly<PlayerState>, timeLeft: number): void {
  if (!enabled || !currentMode) return

  const modeDef = getModeDefinition(currentMode)
  const modifiers = collectModifiers(player, modeDef)
  const rates = computePassiveRates(modifiers, modeDef.resources)

  const elapsed = currentRoundDurationSec - timeLeft

  const snapshot: LiveSnapshot = {
    timeSec: Math.round(elapsed * 1000) / 1000,
    score: player.score,
    resources: { ...player.resources },
    incomePerSec: rates,
    upgrades: { ...player.upgrades },
    generators: { ...player.generators },
    mode: currentMode,
    roundDurationSec: currentRoundDurationSec,
  }

  channel!.postMessage({ kind: 'tick', snapshot } satisfies LiveTick)
}

/** Call when the round ends. */
export function recorderRoundEnd(finalScore: number): void {
  if (!enabled) return
  channel!.postMessage({ kind: 'round-end', finalScore } satisfies LiveRoundEnd)
  currentMode = null
}
