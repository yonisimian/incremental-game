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
import type { GameMode, PlayerState } from '@game/shared'

// ─── Types ───────────────────────────────────────────────────────────

/** @public */
export type LiveStatus = 'waiting' | 'recording' | 'ended'

export interface LiveState {
  status: LiveStatus
  /** Accumulated snapshots for the current (or last) round. */
  snapshots: TickSnapshot[]
  /** Game mode of the current/last round. */
  mode: GameMode | null
  /** Round duration in seconds. */
  roundDurationSec: number
  /** Final score (set on round-end). */
  finalScore: number | null
  /** Purchase events detected by diffing consecutive snapshot counts. */
  purchaseLog: { id: string; timeSec: number }[]
  /** Last-seen upgrade counts (for diff detection). */
  prevUpgrades: Record<string, number>
  /** Last-seen generator counts (for diff detection). */
  prevGenerators: Record<string, number>
}

type LiveChangeHandler = (state: Readonly<LiveState>) => void

// ─── State ───────────────────────────────────────────────────────────

const liveState: LiveState = {
  status: 'waiting',
  snapshots: [],
  mode: null,
  roundDurationSec: 0,
  finalScore: null,
  purchaseLog: [],
  prevUpgrades: {},
  prevGenerators: {},
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
        liveState.purchaseLog = []
        liveState.prevUpgrades = {}
        liveState.prevGenerators = {}
        tickCounter = 0
        onChange(liveState)
        break

      case 'tick': {
        const snap = msg.snapshot
        // Detect new purchases by diffing upgrade/generator counts
        for (const [id, count] of Object.entries(snap.upgrades)) {
          const prev = liveState.prevUpgrades[id] ?? 0
          for (let n = 0; n < count - prev; n++) {
            liveState.purchaseLog.push({ id, timeSec: snap.timeSec })
          }
        }
        for (const [id, count] of Object.entries(snap.generators)) {
          const prev = liveState.prevGenerators[id] ?? 0
          for (let n = 0; n < count - prev; n++) {
            liveState.purchaseLog.push({ id, timeSec: snap.timeSec })
          }
        }
        liveState.prevUpgrades = { ...snap.upgrades }
        liveState.prevGenerators = { ...snap.generators }

        liveState.snapshots.push(toTickSnapshot(snap, tickCounter++))
        onChange(liveState)
        break
      }

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
  const lastSnap = state.snapshots.at(-1)!
  const finalState: PlayerState = {
    score: lastSnap.score,
    resources: { ...lastSnap.resources },
    upgrades: { ...state.prevUpgrades },
    generators: { ...state.prevGenerators },
    meta: {},
  }
  return {
    name: 'Live Game',
    snapshots: state.snapshots,
    finalScore: state.finalScore ?? lastSnap.score,
    purchaseLog: [...state.purchaseLog],
    finalState,
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
