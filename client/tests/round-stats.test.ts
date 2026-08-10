import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModeDefinition, PlayerState } from '@game/shared'
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

/** A player whose game clock reads `gameSec`, highlighting `highlight`. */
function playerAt(gameSec: number, highlight = 'r0'): PlayerState {
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

    it('falls back to the score resource when nothing is highlighted', () => {
      roundStats.recordTick(makePlayer({ meta: { gameSec: 3 } }), makeMode())

      expect(roundStats.dwellByResource.r0).toBeCloseTo(3)
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
  })
})
