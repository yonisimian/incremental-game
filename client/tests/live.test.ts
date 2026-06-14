/**
 * Tests for the DevRecorder → Live listener BroadcastChannel pipeline.
 *
 * Verifies:
 *  - DevRecorder activation via URL param and localStorage
 *  - Round lifecycle message flow (round-start → tick → round-end)
 *  - Live listener state transitions (waiting → recording → ended)
 *  - Snapshot accumulation and SimResult conversion
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import idlerTreeFile from '@game/shared/trees/idler.json'

// ─── BroadcastChannel spy ────────────────────────────────────────────

type Listener = (e: MessageEvent) => void

/**
 * Captures all messages posted to a BroadcastChannel name.
 * Allows replaying them to a listener (simulating cross-tab delivery).
 */
class ChannelSpy {
  readonly messages: unknown[] = []
  private listeners: Listener[] = []

  postMessage(data: unknown): void {
    this.messages.push(data)
    // Deliver to subscribers synchronously (simulates same-origin delivery)
    for (const fn of this.listeners) {
      fn(new MessageEvent('message', { data }))
    }
  }

  addListener(fn: Listener): void {
    this.listeners.push(fn)
  }

  set onmessage(fn: Listener) {
    this.addListener(fn)
  }

  close(): void {
    this.listeners = []
  }
}

// Track all channels by name so recorder and listener share data
const channels = new Map<string, ChannelSpy[]>()

class MockBroadcastChannel {
  private spy: ChannelSpy

  constructor(public name: string) {
    this.spy = new ChannelSpy()
    const group = channels.get(name) ?? []
    group.push(this.spy)
    channels.set(name, group)
  }

  postMessage(data: unknown): void {
    // Deliver to ALL channels with the same name (except self)
    const group = channels.get(this.name) ?? []
    for (const peer of group) {
      if (peer !== this.spy) {
        peer.postMessage(data)
      }
    }
    this.spy.messages.push(data)
  }

  set onmessage(fn: Listener) {
    this.spy.onmessage = fn
  }

  close(): void {
    this.spy.close()
    const group = channels.get(this.name) ?? []
    const idx = group.indexOf(this.spy)
    if (idx !== -1) group.splice(idx, 1)
  }
}

// ─── Setup / teardown ────────────────────────────────────────────────

beforeEach(async () => {
  channels.clear()
  vi.stubGlobal('BroadcastChannel', MockBroadcastChannel)
  vi.stubGlobal('window', {
    location: { search: '' },
  })
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: () => {},
  })
  // afterEach resets modules, wiping the runtime mode registry — re-register
  // the tree on the fresh instance the dynamic imports will resolve to.
  const shared = await import('@game/shared')
  shared.loadTree(idlerTreeFile)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.resetModules()
})

describe('DevRecorder', () => {
  it('does not activate without flags', async () => {
    const mod = await import('../src/dev-recorder.js')
    mod.initDevRecorder()
    // recorderTick should be a no-op — no channel opened
    mod.recorderTick({ score: 10, resources: {}, upgrades: {}, generators: {}, meta: {} }, 30)
    // No channel should have been created
    expect(channels.get('dev-panel')).toBeUndefined()
  })

  it('activates when ?dev is in the URL', async () => {
    vi.stubGlobal('window', { location: { search: '?dev' } })
    const mod = await import('../src/dev-recorder.js')
    mod.initDevRecorder()
    // Should not throw when posting
    mod.recorderRoundStart('idler', 35)
    expect(channels.get('dev-panel')).toBeDefined()
  })

  it('activates when localStorage flag is set', async () => {
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => (key === 'dev-recorder' ? '1' : null),
      setItem: () => {},
    })
    const mod = await import('../src/dev-recorder.js')
    mod.initDevRecorder()
    mod.recorderRoundStart('idler', 35)
    expect(channels.get('dev-panel')).toBeDefined()
  })

  it('posts round-start, tick, and round-end messages', async () => {
    vi.stubGlobal('window', { location: { search: '?dev' } })
    const mod = await import('../src/dev-recorder.js')
    mod.initDevRecorder()

    mod.recorderRoundStart('idler', 35)
    mod.recorderTick(
      { score: 5, resources: { r0: 5, r1: 2 }, upgrades: {}, generators: {}, meta: {} },
      30,
    )
    mod.recorderRoundEnd(42)

    // The recorder's own channel stores its sent messages
    const group = channels.get('dev-panel')!
    const recorderChannel = group[0]
    expect(recorderChannel.messages).toHaveLength(3)
    expect(recorderChannel.messages[0]).toEqual({
      kind: 'round-start',
      mode: 'idler',
      roundDurationSec: 35,
    })
    expect((recorderChannel.messages[1] as { kind: string }).kind).toBe('tick')
    expect(recorderChannel.messages[2]).toEqual({ kind: 'round-end', finalScore: 42 })
  })

  it('computes correct elapsed time from roundDuration - timeLeft', async () => {
    vi.stubGlobal('window', { location: { search: '?dev' } })
    const mod = await import('../src/dev-recorder.js')
    mod.initDevRecorder()
    mod.recorderRoundStart('idler', 35)

    mod.recorderTick(
      { score: 0, resources: { r0: 0, r1: 0 }, upgrades: {}, generators: {}, meta: {} },
      30, // timeLeft = 30 → elapsed = 5
    )

    const group = channels.get('dev-panel')!
    const tickMsg = group[0].messages[1] as { kind: string; snapshot: { timeSec: number } }
    expect(tickMsg.snapshot.timeSec).toBe(5)
  })

  it('skips ticks when no round is active (currentMode is null)', async () => {
    vi.stubGlobal('window', { location: { search: '?dev' } })
    const mod = await import('../src/dev-recorder.js')
    mod.initDevRecorder()

    // Tick without round-start — should be a no-op
    mod.recorderTick({ score: 5, resources: { r0: 5 }, upgrades: {}, generators: {}, meta: {} }, 30)

    const group = channels.get('dev-panel')!
    expect(group[0].messages).toHaveLength(0)
  })

  it('resets currentMode after round-end', async () => {
    vi.stubGlobal('window', { location: { search: '?dev' } })
    const mod = await import('../src/dev-recorder.js')
    mod.initDevRecorder()

    mod.recorderRoundStart('idler', 35)
    mod.recorderRoundEnd(50)

    // Tick after round-end should be a no-op
    mod.recorderTick(
      { score: 99, resources: { r0: 99 }, upgrades: {}, generators: {}, meta: {} },
      25,
    )

    const group = channels.get('dev-panel')!
    // Should have only round-start + round-end = 2 messages (tick dropped)
    expect(group[0].messages).toHaveLength(2)
  })
})

// ─── Live listener tests ────────────────────────────────────────────

describe('Live listener', () => {
  it('starts in waiting state', async () => {
    const mod = await import('../src/dev/live.js')
    const state = mod.getLiveState()
    expect(state.status).toBe('waiting')
    expect(state.snapshots).toHaveLength(0)
    expect(state.mode).toBeNull()
    expect(state.finalScore).toBeNull()
  })

  it('transitions to recording on round-start', async () => {
    const mod = await import('../src/dev/live.js')
    const states: string[] = []

    mod.startLiveListener((state) => {
      states.push(state.status)
    })

    // Simulate a round-start message arriving
    const group = channels.get('dev-panel')!
    const listenerChannel = group[0]
    listenerChannel.postMessage({ kind: 'round-start', mode: 'idler', roundDurationSec: 35 })

    expect(states).toContain('recording')
    expect(mod.getLiveState().mode).toBe('idler')
    expect(mod.getLiveState().roundDurationSec).toBe(35)

    mod.stopLiveListener()
  })

  it('accumulates snapshots on tick messages', async () => {
    const mod = await import('../src/dev/live.js')
    let callCount = 0

    mod.startLiveListener(() => {
      callCount++
    })

    const group = channels.get('dev-panel')!
    const ch = group[0]

    ch.postMessage({ kind: 'round-start', mode: 'idler', roundDurationSec: 35 })
    ch.postMessage({
      kind: 'tick',
      snapshot: {
        timeSec: 0.25,
        score: 1,
        resources: { r0: 1 },
        incomePerSec: { r0: 2 },
        mode: 'idler',
        roundDurationSec: 35,
      },
    })
    ch.postMessage({
      kind: 'tick',
      snapshot: {
        timeSec: 0.5,
        score: 2,
        resources: { r0: 2 },
        incomePerSec: { r0: 2 },
        mode: 'idler',
        roundDurationSec: 35,
      },
    })

    const state = mod.getLiveState()
    expect(state.snapshots).toHaveLength(2)
    expect(state.snapshots[0].tick).toBe(0)
    expect(state.snapshots[1].tick).toBe(1)
    expect(state.snapshots[0].timeSec).toBe(0.25)
    expect(state.snapshots[1].score).toBe(2)
    expect(callCount).toBe(3) // round-start + 2 ticks

    mod.stopLiveListener()
  })

  it('transitions to ended on round-end', async () => {
    const mod = await import('../src/dev/live.js')
    const statuses: string[] = []

    mod.startLiveListener((state) => {
      statuses.push(state.status)
    })

    const ch = channels.get('dev-panel')![0]
    ch.postMessage({ kind: 'round-start', mode: 'idler', roundDurationSec: 35 })
    ch.postMessage({ kind: 'round-end', finalScore: 42 })

    expect(statuses).toEqual(['recording', 'ended'])
    expect(mod.getLiveState().finalScore).toBe(42)

    mod.stopLiveListener()
  })

  it('resets snapshots on a new round-start', async () => {
    const mod = await import('../src/dev/live.js')
    mod.startLiveListener(() => {})

    const ch = channels.get('dev-panel')![0]
    ch.postMessage({ kind: 'round-start', mode: 'idler', roundDurationSec: 35 })
    ch.postMessage({
      kind: 'tick',
      snapshot: {
        timeSec: 0.25,
        score: 1,
        resources: { r0: 1 },
        incomePerSec: { r0: 2 },
        mode: 'idler',
        roundDurationSec: 35,
      },
    })
    expect(mod.getLiveState().snapshots).toHaveLength(1)

    // New round — should reset
    ch.postMessage({ kind: 'round-start', mode: 'idler', roundDurationSec: 35 })
    expect(mod.getLiveState().snapshots).toHaveLength(0)
    expect(mod.getLiveState().finalScore).toBeNull()

    mod.stopLiveListener()
  })

  it('stopLiveListener closes the channel', async () => {
    const mod = await import('../src/dev/live.js')
    mod.startLiveListener(() => {})
    expect(channels.get('dev-panel')!.length).toBeGreaterThan(0)

    mod.stopLiveListener()
    // Channel should have been removed from the group via close()
    expect(channels.get('dev-panel')!).toHaveLength(0)
  })
})

// ─── liveStateToSimResult ────────────────────────────────────────────

describe('liveStateToSimResult', () => {
  it('returns null for empty snapshots', async () => {
    const mod = await import('../src/dev/live.js')
    const result = mod.liveStateToSimResult(mod.getLiveState())
    expect(result).toBeNull()
  })

  it('converts live state to SimResult shape', async () => {
    const mod = await import('../src/dev/live.js')
    mod.startLiveListener(() => {})

    const ch = channels.get('dev-panel')![0]
    ch.postMessage({ kind: 'round-start', mode: 'idler', roundDurationSec: 35 })
    ch.postMessage({
      kind: 'tick',
      snapshot: {
        timeSec: 0.25,
        score: 5,
        resources: { r0: 5 },
        incomePerSec: { r0: 2 },
        mode: 'idler',
        roundDurationSec: 35,
      },
    })
    ch.postMessage({ kind: 'round-end', finalScore: 42 })

    const result = mod.liveStateToSimResult(mod.getLiveState())
    expect(result).not.toBeNull()
    expect(result!.name).toBe('Live Game')
    expect(result!.finalScore).toBe(42)
    expect(result!.snapshots).toHaveLength(1)
    expect(result!.purchaseLog).toEqual([])

    mod.stopLiveListener()
  })

  it('uses last snapshot score when finalScore is null', async () => {
    const mod = await import('../src/dev/live.js')
    mod.startLiveListener(() => {})

    const ch = channels.get('dev-panel')![0]
    ch.postMessage({ kind: 'round-start', mode: 'idler', roundDurationSec: 35 })
    ch.postMessage({
      kind: 'tick',
      snapshot: {
        timeSec: 0.25,
        score: 7.5,
        resources: { r0: 7.5 },
        incomePerSec: { r0: 2 },
        mode: 'idler',
        roundDurationSec: 35,
      },
    })

    // No round-end — finalScore is null
    const result = mod.liveStateToSimResult(mod.getLiveState())
    expect(result!.finalScore).toBe(7.5)

    mod.stopLiveListener()
  })

  it('does not open a second channel when called twice', async () => {
    const mod = await import('../src/dev/live.js')
    const handler1Calls: number[] = []
    const handler2Calls: number[] = []

    mod.startLiveListener(() => {
      handler1Calls.push(1)
    })
    const channelCountAfterFirst = channels.get('dev-panel')!.length

    mod.startLiveListener(() => {
      handler2Calls.push(1)
    })
    const channelCountAfterSecond = channels.get('dev-panel')!.length

    // Should not open a second channel
    expect(channelCountAfterSecond).toBe(channelCountAfterFirst)

    // But the handler should be updated to the second one
    const ch = channels.get('dev-panel')![0]
    ch.postMessage({ kind: 'round-start', mode: 'idler', roundDurationSec: 35 })

    // Second handler receives the message, first does not
    expect(handler2Calls).toHaveLength(1)
    expect(handler1Calls).toHaveLength(0)

    mod.stopLiveListener()
  })
})
