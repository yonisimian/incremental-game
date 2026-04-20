import { beforeEach, describe, expect, it, vi } from 'vitest'
import type WebSocket from 'ws'
import type { Goal } from '@game/shared'

function mockWs(): WebSocket {
  return { readyState: 1, send: vi.fn() } as unknown as WebSocket
}

const timedGoal: Goal = { type: 'timed', durationSec: 60 }
const targetGoal: Goal = { type: 'target-score', target: 666, safetyCapSec: 300 }

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
    expect(addToQueue({ id: 'p1', ws: mockWs() }, 'clicker', timedGoal)).toBeNull()
  })

  it('returns a Match when two players are queued in the same mode', () => {
    addToQueue({ id: 'p1', ws: mockWs() }, 'clicker', timedGoal)
    const match = addToQueue({ id: 'p2', ws: mockWs() }, 'clicker', timedGoal)
    expect(match).not.toBeNull()
    expect(match!.getPlayerIds()).toEqual(['p1', 'p2'])
  })

  it('empties the queue after a match is created', () => {
    addToQueue({ id: 'p1', ws: mockWs() }, 'clicker', timedGoal)
    addToQueue({ id: 'p2', ws: mockWs() }, 'clicker', timedGoal)
    expect(addToQueue({ id: 'p3', ws: mockWs() }, 'clicker', timedGoal)).toBeNull()
  })

  it('removes a queued player before matching', () => {
    addToQueue({ id: 'p1', ws: mockWs() }, 'clicker', timedGoal)
    removeFromQueue('p1')
    expect(addToQueue({ id: 'p2', ws: mockWs() }, 'clicker', timedGoal)).toBeNull()
  })

  it('tolerates removing an unknown player ID', () => {
    expect(() => {
      removeFromQueue('ghost')
    }).not.toThrow()
  })

  it('does not match players from different modes', () => {
    addToQueue({ id: 'p1', ws: mockWs() }, 'clicker', timedGoal)
    expect(addToQueue({ id: 'p2', ws: mockWs() }, 'idler', timedGoal)).toBeNull()
  })

  it('matches players within the same idler queue', () => {
    addToQueue({ id: 'p1', ws: mockWs() }, 'idler', timedGoal)
    const match = addToQueue({ id: 'p2', ws: mockWs() }, 'idler', timedGoal)
    expect(match).not.toBeNull()
    expect(match!.mode).toBe('idler')
  })

  it('does not match players with different goal types', () => {
    addToQueue({ id: 'p1', ws: mockWs() }, 'clicker', timedGoal)
    expect(addToQueue({ id: 'p2', ws: mockWs() }, 'clicker', targetGoal)).toBeNull()
  })

  it('matches players with the same goal type', () => {
    addToQueue({ id: 'p1', ws: mockWs() }, 'clicker', targetGoal)
    const match = addToQueue({ id: 'p2', ws: mockWs() }, 'clicker', targetGoal)
    expect(match).not.toBeNull()
    expect(match!.goal.type).toBe('target-score')
  })
})
