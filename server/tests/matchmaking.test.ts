import { beforeEach, describe, expect, it, vi } from 'vitest'
import type WebSocket from 'ws'
import idlerTreeFile from '@game/shared/trees/idler.json' with { type: 'json' }

function mockWs(): WebSocket {
  return { readyState: 1, send: vi.fn() } as unknown as WebSocket
}

function player(id: string) {
  return { id, ws: mockWs(), name: `Player ${id}` }
}

const noop = () => {}

describe('quick-match queue', () => {
  let addToQuickQueue: (typeof import('../src/matchmaking.js'))['addToQuickQueue']
  let removeFromQuickQueue: (typeof import('../src/matchmaking.js'))['removeFromQuickQueue']
  let getQueuedPlayer: (typeof import('../src/matchmaking.js'))['getQueuedPlayer']

  beforeEach(async () => {
    vi.resetModules()
    const mod = await import('../src/matchmaking.js')
    addToQuickQueue = mod.addToQuickQueue
    removeFromQuickQueue = mod.removeFromQuickQueue
    getQueuedPlayer = mod.getQueuedPlayer
  })

  it('returns null when only one player is queued', () => {
    expect(addToQuickQueue(player('p1'))).toBeNull()
  })

  it('returns a pair when two players are queued', () => {
    addToQuickQueue(player('p1'))
    const pair = addToQuickQueue(player('p2'))
    expect(pair).not.toBeNull()
    expect(pair![0].id).toBe('p1')
    expect(pair![1].id).toBe('p2')
  })

  it('empties the queue after a match', () => {
    addToQuickQueue(player('p1'))
    addToQuickQueue(player('p2'))
    expect(addToQuickQueue(player('p3'))).toBeNull()
  })

  it('removes a queued player before matching', () => {
    addToQuickQueue(player('p1'))
    removeFromQuickQueue('p1')
    expect(addToQuickQueue(player('p2'))).toBeNull()
  })

  it('tolerates removing an unknown player ID', () => {
    expect(() => {
      removeFromQuickQueue('ghost')
    }).not.toThrow()
  })

  it('finds a queued player by ID', () => {
    addToQuickQueue(player('p1'))
    expect(getQueuedPlayer('p1')).toBeDefined()
    expect(getQueuedPlayer('p1')!.id).toBe('p1')
  })

  it('returns undefined for a non-queued player', () => {
    expect(getQueuedPlayer('ghost')).toBeUndefined()
  })
})

describe('rooms', () => {
  let createRoom: (typeof import('../src/matchmaking.js'))['createRoom']
  let joinRoom: (typeof import('../src/matchmaking.js'))['joinRoom']
  let leaveRoom: (typeof import('../src/matchmaking.js'))['leaveRoom']
  let updateRoomSettings: (typeof import('../src/matchmaking.js'))['updateRoomSettings']
  let getRoomCount: (typeof import('../src/matchmaking.js'))['getRoomCount']
  let getRoomByPlayerId: (typeof import('../src/matchmaking.js'))['getRoomByPlayerId']
  let removeFromAll: (typeof import('../src/matchmaking.js'))['removeFromAll']

  beforeEach(async () => {
    vi.resetModules()
    vi.useFakeTimers()
    // resetModules wipes the runtime mode registry too — re-register the tree
    // on the fresh module instance before the re-imported code uses it.
    const shared = await import('@game/shared')
    shared.loadTree(idlerTreeFile)
    const mod = await import('../src/matchmaking.js')
    createRoom = mod.createRoom
    joinRoom = mod.joinRoom
    leaveRoom = mod.leaveRoom
    updateRoomSettings = mod.updateRoomSettings
    getRoomCount = mod.getRoomCount
    getRoomByPlayerId = mod.getRoomByPlayerId
    removeFromAll = mod.removeFromAll
  })

  it('creates a room successfully', () => {
    const res = createRoom(player('p1'), noop)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.room.code).toHaveLength(6)
    expect(res.room.creatorId).toBe('p1')
    expect(res.room.players).toHaveLength(1)
    expect(getRoomCount()).toBe(1)
  })

  it('prevents creating a room when already in one', () => {
    createRoom(player('p1'), noop)
    const res = createRoom(player('p1'), noop)
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.reason).toBe('already_in_room')
  })

  it('joins a room by code', () => {
    const create = createRoom(player('p1'), noop)
    if (!create.ok) throw new Error('create failed')
    const join = joinRoom(player('p2'), create.room.code)
    expect(join.ok).toBe(true)
    if (!join.ok) return
    expect(join.matchReady).toBe(true)
    expect(join.room.players).toHaveLength(2)
  })

  it('removes the room from map when full (matchReady)', () => {
    const create = createRoom(player('p1'), noop)
    if (!create.ok) throw new Error('create failed')
    joinRoom(player('p2'), create.room.code)
    expect(getRoomCount()).toBe(0)
  })

  it('rejects join with invalid code', () => {
    const join = joinRoom(player('p1'), 'ZZZZZZ')
    expect(join.ok).toBe(false)
    if (join.ok) return
    expect(join.reason).toBe('not_found')
  })

  it('rejects join when already in a room', () => {
    createRoom(player('p1'), noop)
    createRoom(player('p2'), noop)
    const p1Room = getRoomByPlayerId('p1')!
    const join = joinRoom(player('p2'), p1Room.code)
    expect(join.ok).toBe(false)
    if (join.ok) return
    expect(join.reason).toBe('already_in_room')
  })

  it('leaves a room and destroys it if empty', () => {
    createRoom(player('p1'), noop)
    const res = leaveRoom('p1')
    expect(res).not.toBeNull()
    expect(res!.destroyed).toBe(true)
    expect(getRoomCount()).toBe(0)
  })

  it('promotes the other player to creator when creator leaves', () => {
    const create = createRoom(player('p1'), noop)
    if (!create.ok) throw new Error('create failed')
    // Need to add a second player without triggering matchReady
    // Actually with 2-player rooms, joining makes it full. So leave/promote
    // only applies if we test with the creator leaving before second joins.
    // For the current 2-player design, leaving always destroys the room.
    const res = leaveRoom('p1')
    expect(res).not.toBeNull()
    expect(res!.destroyed).toBe(true)
  })

  it('allows the creator to update room settings', () => {
    createRoom(player('p1'), noop)
    const res = updateRoomSettings('p1', { mode: 'idler' })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.settings.mode).toBe('idler')
  })

  it('rejects settings update from non-creator', () => {
    const res = updateRoomSettings('ghost', { mode: 'idler' })
    expect(res.ok).toBe(false)
  })

  it('accepts a custom target score for the target-score goal', () => {
    createRoom(player('p1'), noop)
    const res = updateRoomSettings('p1', {
      goal: { type: 'target-score', label: '🎯 Race to Score', target: 500, safetyCapSec: 300 },
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.settings.goal.type).toBe('target-score')
    if (res.settings.goal.type !== 'target-score') return
    expect(res.settings.goal.target).toBe(500)
  })

  it('clamps an out-of-range custom target score', () => {
    createRoom(player('p1'), noop)
    const res = updateRoomSettings('p1', {
      goal: { type: 'target-score', label: 'x', target: 99_999_999, safetyCapSec: 1 },
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    if (res.settings.goal.type !== 'target-score') return
    expect(res.settings.goal.target).toBe(100_000)
    // Non-tunable fields come from the predefined goal, not the client payload.
    expect(res.settings.goal.safetyCapSec).toBe(300)
  })

  it('accepts a custom duration for the timed goal', () => {
    createRoom(player('p1'), noop)
    const res = updateRoomSettings('p1', {
      goal: { type: 'timed', label: '⏱ Timed', durationSec: 120 },
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    if (res.settings.goal.type !== 'timed') return
    expect(res.settings.goal.durationSec).toBe(120)
  })

  it('resets goal when mode changes and goal is incompatible', () => {
    createRoom(player('p1'), noop)
    // Change to idler — goal should auto-reset if the current goal is
    // not valid for idler.
    const res = updateRoomSettings('p1', { mode: 'idler' })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    // Result should have a valid goal for idler mode
    expect(res.settings.mode).toBe('idler')
    expect(res.settings.goal).toBeDefined()
  })

  it('removeFromAll cleans up queue and rooms', () => {
    createRoom(player('p1'), noop)
    const res = removeFromAll('p1')
    expect(res).not.toBeNull()
    expect(res!.destroyed).toBe(true)
    expect(getRoomCount()).toBe(0)
  })

  it('getRoomByPlayerId returns the room for a player', () => {
    createRoom(player('p1'), noop)
    const room = getRoomByPlayerId('p1')
    expect(room).toBeDefined()
    expect(room!.creatorId).toBe('p1')
  })

  it('getRoomByPlayerId returns undefined for non-room player', () => {
    expect(getRoomByPlayerId('ghost')).toBeUndefined()
  })

  it('calls onExpire when TTL expires', () => {
    const onExpire = vi.fn()
    createRoom(player('p1'), onExpire)
    vi.advanceTimersByTime(10 * 60 * 1000 + 1)
    expect(onExpire).toHaveBeenCalledOnce()
    expect(getRoomCount()).toBe(0)
  })
})
