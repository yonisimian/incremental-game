import { beforeEach, describe, expect, it, vi } from 'vitest'
import type WebSocket from 'ws'
import { MAX_TARGET_SCORE, RANDOM_GOAL } from '@game/shared'

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
  let startRoom: (typeof import('../src/matchmaking.js'))['startRoom']
  let leaveRoom: (typeof import('../src/matchmaking.js'))['leaveRoom']
  let updateRoomSettings: (typeof import('../src/matchmaking.js'))['updateRoomSettings']
  let getRoomCount: (typeof import('../src/matchmaking.js'))['getRoomCount']
  let getRoomByPlayerId: (typeof import('../src/matchmaking.js'))['getRoomByPlayerId']
  let removeFromAll: (typeof import('../src/matchmaking.js'))['removeFromAll']
  let reopenRoom: (typeof import('../src/matchmaking.js'))['reopenRoom']

  beforeEach(async () => {
    vi.resetModules()
    vi.useFakeTimers()
    // resetModules wipes the runtime mode registry too — re-register the trees
    // on the fresh module instance before the re-imported code uses them.
    const { loadTreeFiles } = await import('../src/trees.js')
    loadTreeFiles()
    const mod = await import('../src/matchmaking.js')
    createRoom = mod.createRoom
    joinRoom = mod.joinRoom
    startRoom = mod.startRoom
    leaveRoom = mod.leaveRoom
    updateRoomSettings = mod.updateRoomSettings
    getRoomCount = mod.getRoomCount
    getRoomByPlayerId = mod.getRoomByPlayerId
    removeFromAll = mod.removeFromAll
    reopenRoom = mod.reopenRoom
  })

  describe('reopenRoom', () => {
    const snapshot = { code: 'ABCDEF', creatorId: 'p1', mode: 'idler' as const, goal: RANDOM_GOAL }

    it('seats both players back in a room with the old code, host seat and settings', () => {
      const res = reopenRoom(player('p1'), player('p2'), snapshot, noop)
      expect(res.ok).toBe(true)
      if (!res.ok) return
      expect(res.room.code).toBe('ABCDEF')
      expect(res.room.creatorId).toBe('p1')
      expect(res.room.players.map((p) => p.id)).toEqual(['p1', 'p2'])
      expect(res.room.mode).toBe('idler')
      expect(res.room.goal).toEqual(RANDOM_GOAL)
      expect(getRoomByPlayerId('p1')).toBe(res.room)
      expect(getRoomByPlayerId('p2')).toBe(res.room)
      expect(getRoomCount()).toBe(1)
    })

    it('picks a fresh code when the old one is taken', () => {
      const first = reopenRoom(player('a'), player('b'), snapshot, noop)
      const second = reopenRoom(player('p1'), player('p2'), snapshot, noop)
      expect(first.ok && second.ok).toBe(true)
      if (!first.ok || !second.ok) return
      expect(second.room.code).not.toBe('ABCDEF')
      expect(second.room.code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/u)
      expect(getRoomCount()).toBe(2)
    })

    it('refuses when either player is already in a room', () => {
      createRoom(player('p2'), noop)
      const res = reopenRoom(player('p1'), player('p2'), snapshot, noop)
      expect(res).toEqual({ ok: false, reason: 'already_in_room' })
      expect(getRoomByPlayerId('p1')).toBeUndefined()
    })

    it('is full and startable by the host, and expires if never started', () => {
      const onExpire = vi.fn()
      reopenRoom(player('p1'), player('p2'), snapshot, onExpire)
      expect(startRoom('p2')).toEqual({ ok: false, reason: 'not_creator' })
      vi.advanceTimersByTime(10 * 60 * 1000)
      expect(onExpire).toHaveBeenCalledTimes(1)
      expect(getRoomCount()).toBe(0)
    })

    it('can be started by the host right away', () => {
      reopenRoom(player('p1'), player('p2'), snapshot, noop)
      const res = startRoom('p1')
      expect(res.ok).toBe(true)
      expect(getRoomCount()).toBe(0)
    })
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

  it('joins a room by code and keeps the full room waiting for its host', () => {
    const create = createRoom(player('p1'), noop)
    if (!create.ok) throw new Error('create failed')
    const join = joinRoom(player('p2'), create.room.code)
    expect(join.ok).toBe(true)
    if (!join.ok) return
    expect(join.room.players).toHaveLength(2)
    expect(getRoomCount()).toBe(1)
    expect(getRoomByPlayerId('p2')?.code).toBe(create.room.code)
  })

  it('lets the creator start a full room, removing it from the map', () => {
    const create = createRoom(player('p1'), noop)
    if (!create.ok) throw new Error('create failed')
    joinRoom(player('p2'), create.room.code)
    const res = startRoom('p1')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.room.players.map((p) => p.id)).toEqual(['p1', 'p2'])
    expect(getRoomCount()).toBe(0)
    expect(getRoomByPlayerId('p1')).toBeUndefined()
    expect(getRoomByPlayerId('p2')).toBeUndefined()
  })

  it('refuses to start a room that is not full', () => {
    createRoom(player('p1'), noop)
    expect(startRoom('p1')).toEqual({ ok: false, reason: 'not_full' })
    expect(getRoomCount()).toBe(1)
  })

  it('refuses a start from the joiner or an outsider', () => {
    const create = createRoom(player('p1'), noop)
    if (!create.ok) throw new Error('create failed')
    joinRoom(player('p2'), create.room.code)
    expect(startRoom('p2')).toEqual({ ok: false, reason: 'not_creator' })
    expect(startRoom('ghost')).toEqual({ ok: false, reason: 'not_in_room' })
    expect(getRoomCount()).toBe(1)
  })

  it('lets a promoted joiner start once a new second player arrives', () => {
    const create = createRoom(player('p1'), noop)
    if (!create.ok) throw new Error('create failed')
    joinRoom(player('p2'), create.room.code)
    leaveRoom('p1')
    expect(startRoom('p2')).toEqual({ ok: false, reason: 'not_full' })
    joinRoom(player('p3'), create.room.code)
    const res = startRoom('p2')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.room.creatorId).toBe('p2')
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
    joinRoom(player('p2'), create.room.code)
    const res = leaveRoom('p1')
    expect(res).toMatchObject({ destroyed: false, promoted: true, leaverName: 'Player p1' })
    expect(getRoomByPlayerId('p2')!.creatorId).toBe('p2')
  })

  it('allows the creator to update room settings', () => {
    createRoom(player('p1'), noop)
    const res = updateRoomSettings('p1', { mode: 'idler' })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.settings.mode).toBe('idler')
  })

  it('lets the creator switch the room to another tree', async () => {
    // Only one tree ships; register the idler tree under a second id (from the
    // same module instance the reset matchmaking module sees).
    const { getModeDefinition, registerMode } = await import('@game/shared')
    registerMode('idler-copy', getModeDefinition('idler'))
    createRoom(player('p1'), noop)
    const res = updateRoomSettings('p1', { mode: 'idler-copy' })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.settings.mode).toBe('idler-copy')
    expect(getRoomByPlayerId('p1')!.mode).toBe('idler-copy')
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
      goal: { type: 'target-score', label: 'x', target: MAX_TARGET_SCORE * 10, safetyCapSec: 1 },
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    if (res.settings.goal.type !== 'target-score') return
    expect(res.settings.goal.target).toBe(MAX_TARGET_SCORE)
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

  it('accepts the random goal pick, with its own label', () => {
    createRoom(player('p1'), noop)
    const res = updateRoomSettings('p1', { goal: { type: 'random', label: 'whatever' } })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.settings.goal).toEqual(RANDOM_GOAL)
    expect(getRoomByPlayerId('p1')!.goal.type).toBe('random')
  })

  it('keeps the random pick across a mode change', async () => {
    const { getModeDefinition, registerMode } = await import('@game/shared')
    registerMode('idler-copy', getModeDefinition('idler'))
    createRoom(player('p1'), noop)
    updateRoomSettings('p1', { goal: RANDOM_GOAL })
    const res = updateRoomSettings('p1', { mode: 'idler-copy' })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.settings.goal.type).toBe('random')
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
