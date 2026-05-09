/**
 * Live data listener for the dev panel.
 *
 * Listens on a BroadcastChannel for snapshots posted by the game's
 * DevRecorder, accumulates them, and exposes the data in the same
 * shape as SimResult so the existing chart code works unchanged.
 */

import type { DevMessage, LiveSnapshot } from '../dev-recorder.js'
import { DEV_CHANNEL } from '../dev-recorder.js'
import type { TickSnapshot, SimResult } from './simulate.js'

// ─── Types ───────────────────────────────────────────────────────────

/** @public */
export type LiveStatus = 'waiting' | 'recording' | 'ended'

export interface LiveState {
  status: LiveStatus
  /** Accumulated snapshots for the current (or last) round. */
  snapshots: TickSnapshot[]
  /** Game mode of the current/last round. */
  mode: string | null
  /** Round duration in seconds. */
  roundDurationSec: number
  /** Final score (set on round-end). */
  finalScore: number | null
}

type LiveChangeHandler = (state: Readonly<LiveState>) => void

// ─── State ───────────────────────────────────────────────────────────

const liveState: LiveState = {
  status: 'waiting',
  snapshots: [],
  mode: null,
  roundDurationSec: 0,
  finalScore: null,
}

let channel: BroadcastChannel | null = null
let onChange: LiveChangeHandler = () => {}
let tickCounter = 0

// ─── Public API ──────────────────────────────────────────────────────

/** Start listening for game snapshots. */
export function startLiveListener(handler: LiveChangeHandler): void {
  onChange = handler
  if (channel) return // already listening

  channel = new BroadcastChannel(DEV_CHANNEL)
  channel.onmessage = (e: MessageEvent<DevMessage>) => {
    const msg = e.data
    switch (msg.kind) {
      case 'round-start':
        liveState.status = 'recording'
        liveState.snapshots = []
        liveState.mode = msg.mode
        liveState.roundDurationSec = msg.roundDurationSec
        liveState.finalScore = null
        tickCounter = 0
        onChange(liveState)
        break

      case 'tick':
        liveState.snapshots.push(toTickSnapshot(msg.snapshot, tickCounter++))
        onChange(liveState)
        break

      case 'round-end':
        liveState.status = 'ended'
        liveState.finalScore = msg.finalScore
        onChange(liveState)
        break
    }
  }
}

/** Stop listening and close the channel. */
export function stopLiveListener(): void {
  if (channel) {
    channel.close()
    channel = null
  }
  onChange = () => {}
}

/** Get the current live state. */
export function getLiveState(): Readonly<LiveState> {
  return liveState
}

/** Convert a LiveSnapshot to a TickSnapshot (same shape used by simulation). */
export function liveStateToSimResult(state: Readonly<LiveState>): SimResult | null {
  if (state.snapshots.length === 0) return null
  return {
    name: 'Live Game',
    snapshots: state.snapshots,
    finalScore: state.finalScore ?? state.snapshots.at(-1)?.score ?? 0,
    purchaseLog: [], // we don't track purchases in live mode (yet)
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────

function toTickSnapshot(snap: LiveSnapshot, tick: number): TickSnapshot {
  return {
    tick,
    timeSec: snap.timeSec,
    score: snap.score,
    resources: snap.resources,
    incomePerSec: snap.incomePerSec,
    event: '',
  }
}
