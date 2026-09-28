import { describe, expect, it } from 'vitest'
import { BROADCAST_INTERVAL_MS } from '@game/shared'
import {
  anchorSnapshot,
  bendRate,
  countdownSpan,
  extrapolate,
  snapshotLeadSec,
  retarget,
  tweenAt,
  type Anchor,
} from '../src/ui/counters.js'
import { formatCountdown } from '../src/ui/format-number.js'

const T0 = 1000

describe('extrapolate', () => {
  const a: Anchor = anchorSnapshot(undefined, 100, 10, false, T0)

  it('shows the snapshot value at the snapshot', () => {
    expect(extrapolate(100, a, T0)).toBe(100)
  })

  it('climbs at the passive rate between snapshots', () => {
    expect(extrapolate(100, a, T0 + 250)).toBeCloseTo(102.5)
  })

  it('stops climbing after two broadcast intervals without a snapshot', () => {
    const cap = extrapolate(100, a, T0 + 2 * BROADCAST_INTERVAL_MS)
    expect(extrapolate(100, a, T0 + 10_000)).toBeCloseTo(cap)
  })

  it('passes a local change straight through', () => {
    // A click (+5) or a purchase (−50) lands on the frame it happens.
    expect(extrapolate(105, a, T0 + 250)).toBeCloseTo(107.5)
    expect(extrapolate(50, a, T0 + 250)).toBeCloseTo(52.5)
  })

  it('never drains on a negative rate', () => {
    const neg = anchorSnapshot(undefined, 100, -5, false, T0)
    expect(extrapolate(100, neg, T0 + 400)).toBe(100)
  })

  it('never shows a negative value', () => {
    const over = { ...a, offset: -500 }
    expect(extrapolate(10, over, T0)).toBe(0)
  })

  it('shows the plain value while paused', () => {
    const p = anchorSnapshot(undefined, 100, 10, true, T0)
    expect(extrapolate(100, p, T0 + 400)).toBe(100)
  })
})

describe('anchorSnapshot', () => {
  it('fades a mispredicted snapshot in instead of snapping to it', () => {
    const prev = anchorSnapshot(undefined, 100, 10, false, T0)
    const at = T0 + BROADCAST_INTERVAL_MS
    // Predicted 105; the server says 103.
    const next = anchorSnapshot({ value: 100, anchor: prev }, 103, 10, false, at)
    expect(extrapolate(103, next, at)).toBeCloseTo(105)
    // Offset gone; lead capped at two intervals (10/s × 1s).
    expect(extrapolate(103, next, at + 2000)).toBeCloseTo(113)
  })

  it('resumes from the paused value rather than the lead the pause skipped', () => {
    const paused = anchorSnapshot(undefined, 100, 10, true, T0)
    const next = anchorSnapshot({ value: 100, anchor: paused }, 100, 10, false, T0 + 5000)
    expect(extrapolate(100, next, T0 + 5000)).toBe(100)
  })
})

describe('bendRate', () => {
  it('keeps the lead so far when the rate changes between snapshots', () => {
    const a = anchorSnapshot(undefined, 100, 10, false, T0)
    const bent = bendRate(a, 20, T0 + 200)
    expect(extrapolate(100, bent, T0 + 200)).toBeCloseTo(102)
    expect(extrapolate(100, bent, T0 + 300)).toBeCloseTo(104)
  })
})

describe('tween', () => {
  it('starts settled on a first value', () => {
    expect(tweenAt(retarget(undefined, 50, T0), T0)).toBe(50)
  })

  it('moves linearly to the new value over one broadcast interval', () => {
    const t = retarget(retarget(undefined, 0, T0), 10, T0)
    expect(tweenAt(t, T0 + BROADCAST_INTERVAL_MS / 2)).toBeCloseTo(5)
    expect(tweenAt(t, T0 + BROADCAST_INTERVAL_MS * 3)).toBe(10)
  })

  it('heads for a new value from where it currently is', () => {
    const t = retarget(retarget(undefined, 0, T0), 10, T0)
    const mid = T0 + BROADCAST_INTERVAL_MS / 2
    const next = retarget(t, 20, mid)
    expect(tweenAt(next, mid)).toBeCloseTo(5)
    expect(tweenAt(next, mid + BROADCAST_INTERVAL_MS)).toBe(20)
  })
})

describe('snapshotLeadSec', () => {
  it('counts real time since the snapshot', () => {
    expect(snapshotLeadSec(T0, false, T0 + 300)).toBeCloseTo(0.3)
  })

  it('stops after two broadcast intervals without a snapshot', () => {
    expect(snapshotLeadSec(T0, false, T0 + 60_000)).toBeCloseTo((2 * BROADCAST_INTERVAL_MS) / 1000)
  })

  it('holds still while paused', () => {
    expect(snapshotLeadSec(T0, true, T0 + 300)).toBe(0)
  })
})

describe('countdowns', () => {
  const c = { template: 'Striking in {}s', untilSec: 14 }

  it('formats the seconds left to tenths, floored at zero', () => {
    expect(formatCountdown(c, 12)).toBe('Striking in 2.0s')
    expect(formatCountdown(c, 20)).toBe('Striking in 0.0s')
  })

  it('marks up the target time and template for the painter', () => {
    const html = countdownSpan(c, 12)
    expect(html).toBe(
      '<span data-until="14" data-countdown="Striking in {}s">Striking in 2.0s</span>',
    )
  })
})
