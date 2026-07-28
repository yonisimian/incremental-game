/**
 * DevRecorder — records each round's actions and (optionally) streams live data.
 *
 * Every game buffers its own round (actions + mode) so the end screen can export
 * it as a strategy file, regardless of any dev flag. Additionally, when the dev
 * broadcast is enabled, it posts a snapshot to a BroadcastChannel on every state
 * update so the dev panel (in a separate tab) can render live charts of real
 * gameplay data.
 *
 * Broadcast activation: the game page loads with `?dev` in the URL, or
 * `localStorage.setItem('dev-recorder', '1')`.
 *
 * Cost when broadcast is inactive: one array push per action and one boolean
 * check per state-update. No additional dependencies — BroadcastChannel is a
 * native browser API.
 */

import type { GameMode, PlayerAction, PlayerState } from '@game/shared'
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

/**
 * A player action as it happened, broadcast so the dev panel can reconstruct
 * the round as an authorable strategy (Live → Queue export).
 * @public
 */
export interface LiveAction {
  kind: 'action'
  action: PlayerAction
}

export type DevMessage = LiveRoundStart | LiveTick | LiveRoundEnd | LiveAction

// ─── Recorder state ─────────────────────────────────────────────────

let channel: BroadcastChannel | null = null
let enabled = false
let currentMode: GameMode | null = null
let currentRoundDurationSec = 0

// ─── Always-on recording buffer ──────────────────────────────────────
//
// Independent of the broadcast `enabled` gate: every game records its own round
// so the end screen can export it as a strategy, whether or not `?dev` is set.
// Only actions + mode are needed (not per-tick snapshots), so this stays cheap.
let recordedActions: PlayerAction[] = []
let recordedMode: GameMode | null = null
let recordedRoundDurationSec = 0
let recording = false

/** The most recent (or in-progress) round's recording, for export. */
export interface RecordedRound {
  actions: readonly PlayerAction[]
  mode: GameMode
  roundDurationSec: number
}

/** The recorded round, or `null` if nothing playable was captured. */
export function getRecordedRound(): RecordedRound | null {
  if (!recordedMode || recordedActions.length === 0) return null
  return {
    actions: recordedActions,
    mode: recordedMode,
    roundDurationSec: recordedRoundDurationSec,
  }
}

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
  // Always start a fresh recording so the end screen can export this round.
  recordedActions = []
  recordedMode = mode
  recordedRoundDurationSec = roundDurationSec
  recording = true

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
    mode: currentMode,
    roundDurationSec: currentRoundDurationSec,
  }

  channel!.postMessage({ kind: 'tick', snapshot } satisfies LiveTick)
}

/** Call when the round ends. */
export function recorderRoundEnd(finalScore: number): void {
  // Stop buffering but keep the recording intact for the end-screen export.
  recording = false
  if (!enabled) return
  channel!.postMessage({ kind: 'round-end', finalScore } satisfies LiveRoundEnd)
  currentMode = null
}

/**
 * Call for every player action issued locally (buy / generator / highlight /
 * click). Buffered for the end-screen export and, when recording to the dev
 * panel, broadcast in order so it can rebuild the round as a strategy.
 */
export function recorderAction(action: PlayerAction): void {
  if (recording) recordedActions.push(action)
  if (!enabled || !currentMode) return
  channel!.postMessage({ kind: 'action', action } satisfies LiveAction)
}
