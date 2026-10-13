import { beforeEach, describe, expect, it, vi } from 'vitest'
import type WebSocket from 'ws'
import { RANDOM_GOAL, getDefaultGoal } from '@game/shared'
import type { RematchEntry } from '../src/rematch.js'

type RematchModule = typeof import('../src/rematch.js')

const TTL_MS = 10 * 60 * 1000
const SEATS = ['seat-host', 'seat-guest'] as const
const ROOM = { code: 'ABCDEF', mode: 'idler' as const, goal: RANDOM_GOAL }

function entry(id: string, seatToken: string): RematchEntry {
  return {
    id,
    ws: { readyState: 1, send: vi.fn() } as unknown as WebSocket,
    name: `Player ${id}`,
    seatToken,
    mode: 'idler',
    goal: getDefaultGoal('idler'),
  }
}

describe('rematch', () => {
  let m: RematchModule
  let onClosed: ReturnType<typeof vi.fn<(waiting: RematchEntry) => void>>

  beforeEach(async () => {
    vi.resetModules()
    vi.useFakeTimers()
    m = await import('../src/rematch.js')
    onClosed = vi.fn<(waiting: RematchEntry) => void>()
  })

  function finishRoomMatch(matchId = 'm1'): void {
    m.recordFinishedMatch(matchId, { room: ROOM, seatTokens: SEATS }, onClosed)
  }

  it('waits for the first seat, then pairs with the second', () => {
    finishRoomMatch()
    expect(m.requestRematch('m1', entry('p1', SEATS[0]))).toEqual({ kind: 'waiting' })
    const res = m.requestRematch('m1', entry('p2', SEATS[1]))
    expect(res.kind).toBe('paired')
    if (res.kind !== 'paired') return
    expect(res.pair.map((e) => e.id)).toEqual(['p1', 'p2'])
    expect(res.room).toEqual(ROOM)
  })

  it('puts the host first by seat token, whoever asks first', () => {
    finishRoomMatch()
    m.requestRematch('m1', entry('p2', SEATS[1]))
    const res = m.requestRematch('m1', entry('p1', SEATS[0]))
    expect(res.kind === 'paired' && res.pair.map((e) => e.id)).toEqual(['p1', 'p2'])
  })

  it('keeps the host seat for a host who reconnected with a new player id', () => {
    finishRoomMatch()
    m.requestRematch('m1', entry('guest', SEATS[1]))
    const res = m.requestRematch('m1', entry('host-reconnected', SEATS[0]))
    expect(res.kind === 'paired' && res.pair[0].id).toBe('host-reconnected')
  })

  it('reports no room for a quick match', () => {
    m.recordFinishedMatch('q1', { room: null, seatTokens: SEATS }, onClosed)
    m.requestRematch('q1', entry('p1', SEATS[0]))
    const res = m.requestRematch('q1', entry('p2', SEATS[1]))
    expect(res).toMatchObject({ kind: 'paired', room: null })
  })

  it('refuses a seat token that is not one of the match seats', () => {
    finishRoomMatch()
    expect(m.requestRematch('m1', entry('intruder', 'forged'))).toEqual({ kind: 'invalid' })
    // The refused request left nothing behind to pair with.
    expect(m.requestRematch('m1', entry('p1', SEATS[0]))).toEqual({ kind: 'waiting' })
  })

  it('does not pair a seat with itself (a reconnect racing its stale socket)', () => {
    finishRoomMatch()
    m.requestRematch('m1', entry('old-socket', SEATS[0]))
    expect(m.requestRematch('m1', entry('new-socket', SEATS[0]))).toEqual({ kind: 'waiting' })
    expect(m.getRematchEntry('old-socket')).toBeUndefined()
    expect(m.getRematchEntry('new-socket')).toBeDefined()
  })

  it('refuses a rematch of an unknown match', () => {
    expect(m.requestRematch('nope', entry('p1', SEATS[0]))).toEqual({ kind: 'expired' })
  })

  it('refuses a rematch once the window has closed', () => {
    finishRoomMatch()
    vi.advanceTimersByTime(TTL_MS)
    expect(m.requestRematch('m1', entry('p1', SEATS[0]))).toEqual({ kind: 'expired' })
    expect(onClosed).not.toHaveBeenCalled()
  })

  it('sends back whoever is still waiting when the window closes', () => {
    finishRoomMatch()
    const waiting = entry('p1', SEATS[0])
    m.requestRematch('m1', waiting)
    vi.advanceTimersByTime(TTL_MS - 1)
    expect(onClosed).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onClosed).toHaveBeenCalledWith(waiting)
    expect(m.getRematchEntry('p1')).toBeUndefined()
  })

  it('consumes the match once paired, so a third request finds it closed', () => {
    finishRoomMatch()
    m.requestRematch('m1', entry('p1', SEATS[0]))
    m.requestRematch('m1', entry('p2', SEATS[1]))
    expect(m.requestRematch('m1', entry('p1', SEATS[0]))).toEqual({ kind: 'expired' })
    vi.advanceTimersByTime(TTL_MS)
    expect(onClosed).not.toHaveBeenCalled()
  })

  it('keeps at most one pending rematch per player', () => {
    finishRoomMatch('m1')
    finishRoomMatch('m2')
    m.requestRematch('m1', entry('p1', SEATS[0]))
    m.requestRematch('m2', entry('p1', SEATS[0]))
    // p1's m1 request is gone, so m1's other seat now waits instead of pairing.
    expect(m.requestRematch('m1', entry('p2', SEATS[1]))).toEqual({ kind: 'waiting' })
  })

  it('drops a pending rematch when the player starts something else', () => {
    finishRoomMatch()
    m.requestRematch('m1', entry('p1', SEATS[0]))
    m.removeFromRematchQueue('p1')
    expect(m.getRematchEntry('p1')).toBeUndefined()
    expect(m.requestRematch('m1', entry('p2', SEATS[1]))).toEqual({ kind: 'waiting' })
  })
})
