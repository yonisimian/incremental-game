import { beforeEach, describe, expect, it, vi } from 'vitest'
import type WebSocket from 'ws'

function mockWs(): WebSocket {
  return { readyState: 1, send: vi.fn() } as unknown as WebSocket
}

describe('matchmaking', () => {
  let addToQueue: (typeof import('../src/matchmaking.js'))['addToQueue']
  let removeFromQueue: (typeof import('../src/matchmaking.js'))['removeFromQueue']

  beforeEach(async () => {
    vi.resetModules()
    const mod = await import('../src/matchmaking.js')
    addToQueue = mod.addToQueue
    removeFromQueue = mod.removeFromQueue
  })

  it('returns null when only one player is queued', () => {
    expect(addToQueue({ id: 'p1', ws: mockWs() }, 'clicker')).toBeNull()
  })

  it('returns a Match when two players are queued in the same mode', () => {
    addToQueue({ id: 'p1', ws: mockWs() }, 'clicker')
    const match = addToQueue({ id: 'p2', ws: mockWs() }, 'clicker')
    expect(match).not.toBeNull()
    expect(match!.getPlayerIds()).toEqual(['p1', 'p2'])
  })

  it('empties the queue after a match is created', () => {
    addToQueue({ id: 'p1', ws: mockWs() }, 'clicker')
    addToQueue({ id: 'p2', ws: mockWs() }, 'clicker')
    expect(addToQueue({ id: 'p3', ws: mockWs() }, 'clicker')).toBeNull()
  })

  it('removes a queued player before matching', () => {
    addToQueue({ id: 'p1', ws: mockWs() }, 'clicker')
    removeFromQueue('p1')
    expect(addToQueue({ id: 'p2', ws: mockWs() }, 'clicker')).toBeNull()
  })

  it('tolerates removing an unknown player ID', () => {
    expect(() => {
      removeFromQueue('ghost')
    }).not.toThrow()
  })

  it('does not match players from different modes', () => {
    addToQueue({ id: 'p1', ws: mockWs() }, 'clicker')
    expect(addToQueue({ id: 'p2', ws: mockWs() }, 'idler')).toBeNull()
  })

  it('matches players within the same idler queue', () => {
    addToQueue({ id: 'p1', ws: mockWs() }, 'idler')
    const match = addToQueue({ id: 'p2', ws: mockWs() }, 'idler')
    expect(match).not.toBeNull()
    expect(match!.mode).toBe('idler')
  })
})
