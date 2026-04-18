import type WebSocket from 'ws';
import { Match } from './match.js';

interface QueuedPlayer {
  id: string;
  ws: WebSocket;
}

const queue: QueuedPlayer[] = [];

/**
 * Add a player to the matchmaking queue.
 * If two players are queued, creates and returns a Match.
 */
export function addToQueue(player: QueuedPlayer): Match | null {
  queue.push(player);

  if (queue.length >= 2) {
    const p1 = queue.shift()!;
    const p2 = queue.shift()!;
    return new Match(p1, p2);
  }

  return null;
}

/** Remove a player from the queue (e.g. on disconnect before match). */
export function removeFromQueue(playerId: string): void {
  const idx = queue.findIndex((p) => p.id === playerId);
  if (idx !== -1) queue.splice(idx, 1);
}
