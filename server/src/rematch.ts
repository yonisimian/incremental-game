import type WebSocket from 'ws'
import { ROOM_TTL_MS } from '@game/shared'
import type { GameMode, GoalChoice } from '@game/shared'
import { realTimeDelay } from './runtime-config.js'

// ─── Types ───────────────────────────────────────────────────────────

export interface RematchEntry {
  id: string
  ws: WebSocket
  name: string
  /** The seat this player held in the finished match (see `Match.getSeatTokens`). */
  seatToken: string
}

/** A finished match that can still be rematched. */
export interface FinishedMatch {
  mode: GameMode
  /** What a rematch plays: a room's pick (so `random` rolls again), else the goal just played. */
  goal: GoalChoice
  /** The room it was started from; `null` for quick and bot matches. */
  roomCode: string | null
  /** Both seat tokens in seat order: seat 0 is a room's host, even after a reconnect. */
  seatTokens: readonly [string, string]
}

export type RematchResult =
  /** The match's rematch window is closed (or it never existed). */
  | { kind: 'expired' }
  /** The seat token isn't one of this match's seats. */
  | { kind: 'invalid' }
  /** Queued; the opponent hasn't asked yet. */
  | { kind: 'waiting' }
  /** Both seats asked. `pair` is in seat order, so a room's host comes first. */
  | { kind: 'paired'; pair: [RematchEntry, RematchEntry]; finished: FinishedMatch }

// ─── State ───────────────────────────────────────────────────────────

/** Rematch queue keyed by matchId — only the two original opponents can pair. */
const rematchQueue = new Map<string, RematchEntry>()

/**
 * Finished matches by id, kept for one room TTL after they end: that is the
 * rematch window. Once a match is forgotten its rematch is refused, so a late
 * click can't turn a room rematch into a quick one.
 */
const finishedMatches = new Map<string, FinishedMatch>()

// ─── API ─────────────────────────────────────────────────────────────

/**
 * Open a finished match's rematch window. When it closes, whoever is still
 * waiting on it is dropped from the queue and handed to `onClosed`.
 */
export function recordFinishedMatch(
  matchId: string,
  finished: FinishedMatch,
  onClosed: (waiting: RematchEntry) => void,
): void {
  finishedMatches.set(matchId, finished)
  setTimeout(() => {
    finishedMatches.delete(matchId)
    const waiting = rematchQueue.get(matchId)
    if (!waiting) return
    rematchQueue.delete(matchId)
    onClosed(waiting)
  }, realTimeDelay(ROOM_TTL_MS)).unref()
}

/**
 * Ask for a rematch of `matchId`. The two seats pair; a second request for the
 * same seat (the same player re-asking, or a reconnect racing its own stale
 * socket) replaces the first instead of pairing with it. A player has at most
 * one pending rematch: asking drops any other.
 */
export function requestRematch(matchId: string, entry: RematchEntry): RematchResult {
  const finished = finishedMatches.get(matchId)
  if (!finished) return { kind: 'expired' }
  const seat = finished.seatTokens.indexOf(entry.seatToken)
  if (seat === -1) return { kind: 'invalid' }

  removeFromRematchQueue(entry.id)
  const waiting = rematchQueue.get(matchId)
  if (!waiting || waiting.seatToken === entry.seatToken) {
    rematchQueue.set(matchId, entry)
    return { kind: 'waiting' }
  }

  rematchQueue.delete(matchId)
  finishedMatches.delete(matchId)
  const pair: [RematchEntry, RematchEntry] = seat === 0 ? [entry, waiting] : [waiting, entry]
  return { kind: 'paired', pair, finished }
}

/** Drop a player's pending rematch, if any (they quit, left, or started something else). */
export function removeFromRematchQueue(playerId: string): void {
  for (const [key, entry] of rematchQueue) {
    if (entry.id === playerId) {
      rematchQueue.delete(key)
      return
    }
  }
}

/** Look up a player's pending rematch and the match it is for (for bot-request). */
export function getPendingRematch(
  playerId: string,
): { entry: RematchEntry; finished: FinishedMatch } | undefined {
  for (const [matchId, entry] of rematchQueue) {
    if (entry.id !== playerId) continue
    // Queued entries are dropped with their match, so the record is always there.
    const finished = finishedMatches.get(matchId)
    return finished ? { entry, finished } : undefined
  }
  return undefined
}
