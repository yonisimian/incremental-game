import type WebSocket from 'ws'
import type { GameMode } from '@game/shared'
import { Match } from './match.js'

interface QueuedPlayer {
  id: string
  ws: WebSocket
}

const queues = new Map<GameMode, QueuedPlayer[]>()

function getQueue(mode: GameMode): QueuedPlayer[] {
  let q = queues.get(mode)
  if (!q) {
    q = []
    queues.set(mode, q)
  }
  return q
}

/**
 * Add a player to the matchmaking queue for a specific mode.
 * If two players are queued in the same mode, creates and returns a Match.
 */
export function addToQueue(player: QueuedPlayer, mode: GameMode): Match | null {
  const queue = getQueue(mode)
  queue.push(player)

  if (queue.length >= 2) {
    const p1 = queue.shift()!
    const p2 = queue.shift()!
    return new Match(p1, p2, mode)
  }

  return null
}

/** Remove a player from all queues (e.g. on disconnect before match). */
export function removeFromQueue(playerId: string): void {
  for (const queue of queues.values()) {
    const idx = queue.findIndex((p) => p.id === playerId)
    if (idx !== -1) {
      queue.splice(idx, 1)
      return
    }
  }
}
