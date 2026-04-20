import type WebSocket from 'ws'
import type { GameMode, Goal } from '@game/shared'
import { Match } from './match.js'

interface QueuedPlayer {
  id: string
  ws: WebSocket
}

/** Queue key combines mode + goal identity so players only match with identical settings. */
function queueKey(mode: GameMode, goal: Goal): string {
  if (goal.type === 'timed') return `${mode}:timed:${String(goal.durationSec)}`
  return `${mode}:target:${String(goal.target)}:${String(goal.safetyCapSec)}`
}

const queues = new Map<string, { players: QueuedPlayer[]; goal: Goal }>()

function getQueue(mode: GameMode, goal: Goal): { players: QueuedPlayer[]; goal: Goal } {
  const key = queueKey(mode, goal)
  let q = queues.get(key)
  if (!q) {
    q = { players: [], goal }
    queues.set(key, q)
  }
  return q
}

/**
 * Add a player to the matchmaking queue for a specific mode + goal.
 * If two players are queued with the same settings, creates and returns a Match.
 */
export function addToQueue(player: QueuedPlayer, mode: GameMode, goal: Goal): Match | null {
  const queue = getQueue(mode, goal)
  queue.players.push(player)

  if (queue.players.length >= 2) {
    const p1 = queue.players.shift()!
    const p2 = queue.players.shift()!
    return new Match(p1, p2, mode, goal)
  }

  return null
}

/** Remove a player from all queues (e.g. on disconnect before match). */
export function removeFromQueue(playerId: string): void {
  for (const queue of queues.values()) {
    const idx = queue.players.findIndex((p) => p.id === playerId)
    if (idx !== -1) {
      queue.players.splice(idx, 1)
      return
    }
  }
}
