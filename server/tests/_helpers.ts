import { vi } from 'vitest'
import type WebSocket from 'ws'
import type { ServerMessage, StateUpdateMessage } from '@game/shared'

export function createMockWs(): WebSocket {
  return { readyState: 1, send: vi.fn() } as unknown as WebSocket
}

/** All messages sent to a mock WebSocket, parsed from JSON. */
export function sent(ws: WebSocket): ServerMessage[] {
  return (ws.send as ReturnType<typeof vi.fn>).mock.calls.map(
    ([raw]: string[]) => JSON.parse(raw) as ServerMessage,
  )
}

/** Messages of a specific type sent to a mock WebSocket. */
export function sentOfType<T extends ServerMessage['type']>(
  ws: WebSocket,
  type: T,
): Extract<ServerMessage, { type: T }>[] {
  return sent(ws).filter((m): m is Extract<ServerMessage, { type: T }> => m.type === type)
}

/** The most recent STATE_UPDATE sent to a mock WebSocket. */
export function latestUpdate(ws: WebSocket): StateUpdateMessage {
  const updates = sentOfType(ws, 'STATE_UPDATE')
  const last = updates.at(-1)
  if (!last) throw new Error('No STATE_UPDATE messages sent')
  return last
}
