import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AttackEvent, ModeDefinition, PlayerState } from '@game/shared'
import { roundStats } from '../src/stats/round-stats.js'

// ─── Fixtures ────────────────────────────────────────────────────────

/**
 * Minimal mode carrying only what `recordTick` reads (`highlightEnabled`,
 * `scoreResource`, and `upgrades` for the system-gate check). No upgrades →
 * highlight is ungated, so `isHighlightActive` is true when enabled.
 */
function makeMode(highlightEnabled = true): ModeDefinition {
  return { scoreResource: 'r0', highlightEnabled, upgrades: [] } as unknown as ModeDefinition
}

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    score: 0,
    resources: {},
    upgrades: {},
    generators: {},
    pendingAttacks: [],
    meta: {},
    ...overrides,
  }
}

/** A mode declaring one active pact whose window lasts `durationSec`. */
function makePactMode(durationSec = 10): ModeDefinition {
  return { pacts: [{ id: 'p0', kind: 'active', durationSec }] } as unknown as ModeDefinition
}

/** A server snapshot at `gameSec` carrying the given open pact windows. */
function pactSnapshot(gameSec: number, expiries: number[] = []): PlayerState {
  return makePlayer({
    meta: { gameSec },
    activePacts: expiries.map((expiresAtSec) => ({ pact: 'p0', expiresAtSec })),
  })
}

/** A player whose game clock reads `gameSec`, highlighting `highlight`. */
function playerAt(gameSec: number, highlight: string | null = 'r0'): PlayerState {
  return makePlayer({ meta: { gameSec, highlight } })
}

// ─── Tests ───────────────────────────────────────────────────────────

describe('RoundStats', () => {
  beforeEach(() => {
    roundStats.reset()
  })

  describe('recordClick', () => {
    it('accumulates total clicks, income, and per-resource income', () => {
      roundStats.recordClick('r0', 5)
      roundStats.recordClick('r0', 3)
      roundStats.recordClick('r1', 2)

      expect(roundStats.totalClicks).toBe(3)
      expect(roundStats.totalIncome).toBe(10)
      expect(roundStats.incomeByResource.r0).toBe(8)
      expect(roundStats.incomeByResource.r1).toBe(2)
    })

    it('starts from a zeroed state', () => {
      expect(roundStats.totalClicks).toBe(0)
      expect(roundStats.totalIncome).toBe(0)
      expect(roundStats.peakCps).toBe(0)
      expect(Object.keys(roundStats.incomeByResource)).toHaveLength(0)
    })
  })

  describe('recordTick', () => {
    it('credits elapsed game time to the highlighted resource', () => {
      roundStats.recordTick(playerAt(2, 'r0'), makeMode())
      roundStats.recordTick(playerAt(5, 'r0'), makeMode())

      expect(roundStats.dwellByResource.r0).toBeCloseTo(5)
    })

    it('tracks dwell per resource as the highlight moves', () => {
      roundStats.recordTick(playerAt(2, 'r0'), makeMode())
      roundStats.recordTick(playerAt(5, 'r1'), makeMode())

      expect(roundStats.dwellByResource.r0).toBeCloseTo(2)
      expect(roundStats.dwellByResource.r1).toBeCloseTo(3)
    })

    it('does not accrue dwell when the clock has not advanced', () => {
      roundStats.recordTick(playerAt(4, 'r0'), makeMode())
      roundStats.recordTick(playerAt(4, 'r0'), makeMode()) // same gameSec
      roundStats.recordTick(playerAt(3, 'r0'), makeMode()) // regressed clock

      expect(roundStats.dwellByResource.r0).toBeCloseTo(4)
    })

    it('does not accrue dwell while the highlight mechanic is inactive', () => {
      roundStats.recordTick(playerAt(2, 'r0'), makeMode(false))
      roundStats.recordTick(playerAt(5, 'r0'), makeMode(false))

      expect(Object.keys(roundStats.dwellByResource)).toHaveLength(0)
    })

    it('credits released time to its own bucket, not to a resource', () => {
      roundStats.recordTick(makePlayer({ meta: { gameSec: 3 } }), makeMode())

      expect(Object.keys(roundStats.dwellByResource)).toHaveLength(0)
      expect(roundStats.releasedSec).toBeCloseTo(3)
    })

    it('splits a round between a held resource and released time', () => {
      roundStats.recordTick(playerAt(2, 'r0'), makeMode())
      roundStats.recordTick(playerAt(5, null), makeMode())

      expect(roundStats.dwellByResource.r0).toBeCloseTo(2)
      expect(roundStats.releasedSec).toBeCloseTo(3)
    })
  })

  describe('averageCps', () => {
    it('divides total clicks by elapsed game time', () => {
      roundStats.recordClick('r0', 1)
      roundStats.recordClick('r0', 1)
      roundStats.recordClick('r0', 1)

      expect(roundStats.averageCps(playerAt(2))).toBeCloseTo(1.5)
    })

    it('returns 0 before the clock has advanced', () => {
      roundStats.recordClick('r0', 1)

      expect(roundStats.averageCps(playerAt(0))).toBe(0)
    })
  })

  describe('peakCps (rolling window)', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(0)
      roundStats.reset()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('tracks the highest clicks/sec over the 3s window', () => {
      // 3 clicks within the same 3s window → 3 / 3s = 1 cps.
      roundStats.recordClick('r0', 1)
      roundStats.recordClick('r0', 1)
      roundStats.recordClick('r0', 1)

      expect(roundStats.peakCps).toBeCloseTo(1)
    })

    it('never decreases once a peak is reached, even as old clicks expire', () => {
      roundStats.recordClick('r0', 1)
      roundStats.recordClick('r0', 1)
      roundStats.recordClick('r0', 1)
      const peak = roundStats.peakCps

      // Advance past the window so the early clicks are pruned; a lone later
      // click has a lower instantaneous rate but the peak is a high-water mark.
      vi.setSystemTime(10_000)
      roundStats.recordClick('r0', 1)

      expect(roundStats.peakCps).toBe(peak)
    })
  })

  describe('recordAttackEvents', () => {
    it('counts a strike once however many events it sends', () => {
      // One landing that stole and opened a window, then a second landing.
      const events: AttackEvent[] = [
        { attack: 'a0', direction: 'outgoing', kind: 'resource', resource: 'r0', amount: 50, t: 4 },
        { attack: 'a0', direction: 'outgoing', kind: 'debuff', durationSec: 8, t: 4 },
      ]
      roundStats.recordAttackEvents(events)
      roundStats.recordAttackEvents([
        {
          attack: 'a0',
          direction: 'outgoing',
          kind: 'resource',
          resource: 'r0',
          amount: 30,
          t: 20,
        },
      ])

      const a0 = roundStats.outgoingAttack('a0')
      expect(a0?.strikes).toBe(2)
      expect(a0?.resources.r0).toBe(80)
      expect(roundStats.outgoingDebuffSec('a0', 30)).toBe(8)
    })

    it('tallies misses and generator thefts per attack', () => {
      roundStats.recordAttackEvents([
        { attack: 'a4', direction: 'outgoing', kind: 'none', t: 3 },
        { attack: 'a4', direction: 'outgoing', kind: 'generator', generator: 'g1', count: 2, t: 9 },
      ])

      const a4 = roundStats.outgoingAttack('a4')
      expect(a4?.strikes).toBe(2)
      expect(a4?.misses).toBe(1)
      expect(a4?.generators.g1).toBe(2)
      expect(roundStats.outgoingAttack('a0')).toBeNull()
    })

    it('pools incoming strikes apart from outgoing ones', () => {
      roundStats.recordAttackEvents([
        { attack: 'a0', direction: 'incoming', kind: 'resource', resource: 'r1', amount: 12, t: 2 },
        { attack: 'a4', direction: 'incoming', kind: 'generator', generator: 'g0', count: 1, t: 5 },
        { attack: 'a9', direction: 'incoming', kind: 'debuff', durationSec: 15, t: 6 },
      ])

      expect(roundStats.incomingAttacks.resources.r1).toBe(12)
      expect(roundStats.incomingAttacks.generators.g0).toBe(1)
      expect(roundStats.incomingDebuffSec(30)).toBe(15)
      expect(roundStats.outgoingAttack('a0')).toBeNull()
    })
  })

  describe('debuff time', () => {
    it('counts only the part of a window that has elapsed', () => {
      roundStats.recordAttackEvents([
        { attack: 'a9', direction: 'incoming', kind: 'debuff', durationSec: 30, t: 10 },
      ])

      expect(roundStats.incomingDebuffSec(15)).toBe(5)
      expect(roundStats.incomingDebuffSec(100)).toBe(30)
    })

    it('counts overlapping incoming windows once', () => {
      roundStats.recordAttackEvents([
        { attack: 'a8', direction: 'incoming', kind: 'debuff', durationSec: 20, t: 0 },
        { attack: 'a9', direction: 'incoming', kind: 'debuff', durationSec: 20, t: 10 },
        { attack: 'a9', direction: 'incoming', kind: 'debuff', durationSec: 5, t: 50 },
      ])

      // [0, 30) as one stretch, then [50, 55).
      expect(roundStats.incomingDebuffSec(60)).toBe(35)
    })
  })

  describe('recordPactWindows', () => {
    it('counts each window once across repeated snapshots', () => {
      const mode = makePactMode()
      roundStats.recordPactWindows(pactSnapshot(1, [11]), mode)
      roundStats.recordPactWindows(pactSnapshot(2, [11]), mode)
      roundStats.recordPactWindows(pactSnapshot(30, [40]), mode)

      expect(roundStats.pactActivations('p0')).toBe(2)
      expect(roundStats.pactActivations('other')).toBe(0)
    })

    it('measures time active from the window bounds, only up to the clock', () => {
      const mode = makePactMode(10)
      // Opened at 1, first seen at 3 — the opening seconds still count.
      roundStats.recordPactWindows(pactSnapshot(3, [11]), mode)

      expect(roundStats.pactActiveSec('p0', 3)).toBeCloseTo(2)
      // A frozen clock (paused match) adds nothing.
      expect(roundStats.pactActiveSec('p0', 3)).toBeCloseTo(2)
      // A closed window counts its whole length and no more.
      expect(roundStats.pactActiveSec('p0', 25)).toBeCloseTo(10)
    })

    it('counts a predicted window until the server window for it arrives', () => {
      const mode = makePactMode(10)
      const predicted = { startSec: 4.2, endSec: 14.2 }
      expect(roundStats.pactActivations('p0', predicted)).toBe(1)
      expect(roundStats.pactActiveSec('p0', 6.2, predicted)).toBeCloseTo(2)

      // The server's window (opened at 4) overlaps the prediction: one activation.
      roundStats.recordPactWindows(pactSnapshot(5, [14]), mode)
      expect(roundStats.pactActivations('p0', predicted)).toBe(1)
      expect(roundStats.pactActiveSec('p0', 6, predicted)).toBeCloseTo(2)
    })
  })

  describe('recordSharedPacts', () => {
    it('remembers every enemy treaty that reached the player, once, in arrival order', () => {
      roundStats.recordSharedPacts(['p1'])
      roundStats.recordSharedPacts(['p1', 'drum-accord'])
      roundStats.recordSharedPacts([])

      expect(roundStats.sharedPactsSeen).toEqual(['p1', 'drum-accord'])
    })
  })

  describe('reset', () => {
    it('clears clicks, dwell, and the dwell clock baseline', () => {
      roundStats.recordClick('r0', 5)
      roundStats.recordTick(playerAt(4, 'r0'), makeMode())

      roundStats.reset()

      expect(roundStats.totalClicks).toBe(0)
      expect(roundStats.totalIncome).toBe(0)
      expect(Object.keys(roundStats.dwellByResource)).toHaveLength(0)

      // The dwell baseline reset too: the next tick measures delta from 0, not
      // from the pre-reset gameSec (which would yield a negative delta → no accrual).
      roundStats.recordTick(playerAt(3, 'r0'), makeMode())
      expect(roundStats.dwellByResource.r0).toBeCloseTo(3)
    })

    it('clears attack and pact telemetry', () => {
      roundStats.recordAttackEvents([
        { attack: 'a0', direction: 'outgoing', kind: 'none', t: 1 },
        { attack: 'a0', direction: 'incoming', kind: 'resource', resource: 'r0', amount: 5, t: 1 },
      ])
      roundStats.recordPactWindows(pactSnapshot(1, [11]), makePactMode())

      roundStats.reset()

      expect(roundStats.outgoingAttack('a0')).toBeNull()
      expect(Object.keys(roundStats.incomingAttacks.resources)).toHaveLength(0)
      expect(roundStats.pactActivations('p0')).toBe(0)

      roundStats.recordSharedPacts(['p1'])
      roundStats.reset()
      expect(roundStats.sharedPactsSeen).toEqual([])
    })
  })
})
