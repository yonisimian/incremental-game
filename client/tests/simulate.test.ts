import { describe, expect, it } from 'vitest'
import { TICK_INTERVAL_MS, IDLER_ROUND_DURATION_SEC } from '@game/shared'
import { simulate } from '../src/dev/simulate.js'
import type { SimResult } from '../src/dev/simulate.js'
import type { Strategy } from '../src/dev/strategies.js'

// ─── Helpers ─────────────────────────────────────────────────────────

const buy = (upgradeId: string): Strategy['actions'][0] => ({ type: 'buy', upgradeId })
const hl = (h: string): Strategy['actions'][0] => ({ type: 'set_highlight', highlight: h })

const tickSec = TICK_INTERVAL_MS / 1000 // 0.25
const totalTicks = Math.round((IDLER_ROUND_DURATION_SEC * 1000) / TICK_INTERVAL_MS) // 140

// ─── Basic simulation structure ──────────────────────────────────────

describe('simulate — structure', () => {
  const result: SimResult = simulate({ name: 'test', actions: [hl('r0')] }, 'idler')

  it('returns the strategy name', () => {
    expect(result.name).toBe('test')
  })

  it('produces one snapshot per tick', () => {
    expect(result.snapshots).toHaveLength(totalTicks)
  })

  it('snapshots have sequential ticks starting at 0', () => {
    expect(result.snapshots[0].tick).toBe(0)
    expect(result.snapshots.at(-1)!.tick).toBe(totalTicks - 1)
  })

  it('snapshots have monotonically increasing timeSec', () => {
    for (let i = 1; i < result.snapshots.length; i++) {
      expect(result.snapshots[i].timeSec).toBeGreaterThan(result.snapshots[i - 1].timeSec)
    }
  })

  it('first snapshot timeSec equals one tick duration', () => {
    expect(result.snapshots[0].timeSec).toBeCloseTo(tickSec)
  })

  it('last snapshot timeSec equals round duration', () => {
    expect(result.snapshots.at(-1)!.timeSec).toBeCloseTo(IDLER_ROUND_DURATION_SEC)
  })
})

// ─── No-upgrades baseline ────────────────────────────────────────────

describe('simulate — no-upgrades idler baseline', () => {
  // Idler: base 1 r0/s + 1 r1/s, highlight r0 → ×2 → 2 r0/s + 1 r1/s
  const result = simulate({ name: 'baseline', actions: [hl('r0')] }, 'idler')
  const final = result.snapshots.at(-1)!

  it('accumulates correct score (2 r0/s × 35s = 70)', () => {
    expect(result.finalScore).toBeCloseTo(70, 1)
    expect(final.score).toBeCloseTo(70, 1)
  })

  it('accumulates correct r0 balance', () => {
    expect(final.resources.r0).toBeCloseTo(70, 1)
  })

  it('accumulates correct r1 balance (1 r1/s × 35s = 35)', () => {
    expect(final.resources.r1).toBeCloseTo(35, 1)
  })

  it('reports correct income rates', () => {
    expect(final.incomePerSec.r0).toBeCloseTo(2)
    expect(final.incomePerSec.r1).toBeCloseTo(1)
  })

  it('has no purchase events', () => {
    expect(result.purchaseLog).toHaveLength(0)
    expect(result.snapshots.every((s) => s.event === '')).toBe(true)
  })
})

// ─── Highlight changes effective immediately ─────────────────────────

describe('simulate — highlight is immediate', () => {
  // Highlight ale instead of wood: 1 r0/s + 2 r1/s
  const result = simulate({ name: 'ale-hl', actions: [hl('r1')] }, 'idler')
  const final = result.snapshots.at(-1)!

  it('score reflects unhighlighted r0 income (1 r0/s × 35s = 35)', () => {
    expect(result.finalScore).toBeCloseTo(35, 1)
  })

  it('r1 gets highlighted boost (2 r1/s × 35s = 70)', () => {
    expect(final.resources.r1).toBeCloseTo(70, 1)
  })
})

// ─── Upgrade purchase ────────────────────────────────────────────────

describe('simulate — upgrade purchase', () => {
  // u1 = Heavy Logging: costs 25 r0, adds +5 r0/s
  // With hl('r0'): base 1 r0/s + highlight ×2 = 2 r0/s.
  // After buy: base 1 + 5 = 6 r0/s, highlight ×2 = 12 r0/s
  const result = simulate({ name: 'HL only', actions: [hl('r0'), buy('u1')] }, 'idler')

  it('records the purchase in purchaseLog', () => {
    expect(result.purchaseLog).toHaveLength(1)
    expect(result.purchaseLog[0].id).toBe('u1')
  })

  it('purchase happens after accumulating 25 r0', () => {
    // At 2 r0/tick-sec → need 25/2 = 12.5s → tick 50, timeSec = 12.75
    const purchaseTime = result.purchaseLog[0].timeSec
    expect(purchaseTime).toBeGreaterThanOrEqual(12.5)
    expect(purchaseTime).toBeLessThanOrEqual(13)
  })

  it('score is higher than no-upgrades (70)', () => {
    expect(result.finalScore).toBeGreaterThan(70)
  })

  it('purchase event appears in snapshot', () => {
    const purchaseTick = result.snapshots.find((s) => s.event.includes('buy:u1'))
    expect(purchaseTick).toBeDefined()
  })

  it('deducts cost from r0 balance', () => {
    const purchaseIdx = result.snapshots.findIndex((s) => s.event.includes('buy:u1'))
    expect(purchaseIdx).toBeGreaterThan(0)
    expect(result.snapshots[purchaseIdx].resources.r0).toBeLessThan(
      result.snapshots[purchaseIdx - 1].resources.r0,
    )
  })

  it('income rate increases after purchase', () => {
    const purchaseIdx = result.snapshots.findIndex((s) => s.event.includes('buy:u1'))
    const rateBefore = result.snapshots[purchaseIdx - 1].incomePerSec.r0
    const rateAfter = result.snapshots[purchaseIdx].incomePerSec.r0
    expect(rateAfter).toBeGreaterThan(rateBefore)
  })
})

// ─── Multiple purchases in sequence ─────────────────────────────────

describe('simulate — multi-purchase strategy', () => {
  // SA→HL: buy u0 first (30 r0), then u1 (25 r0)
  const result = simulate({ name: 'SA→HL', actions: [hl('r0'), buy('u0'), buy('u1')] }, 'idler')

  it('records both purchases in order', () => {
    expect(result.purchaseLog).toHaveLength(2)
    expect(result.purchaseLog[0].id).toBe('u0')
    expect(result.purchaseLog[1].id).toBe('u1')
  })

  it('second purchase happens after the first', () => {
    expect(result.purchaseLog[1].timeSec).toBeGreaterThan(result.purchaseLog[0].timeSec)
  })
})

// ─── Empty strategy ─────────────────────────────────────────────────

describe('simulate — empty strategy', () => {
  const result = simulate({ name: 'empty', actions: [] }, 'idler')

  it('still runs the full simulation', () => {
    expect(result.snapshots).toHaveLength(totalTicks)
  })

  it('uses default highlight (r0) and produces score', () => {
    // Default highlight is r0, so same as baseline
    expect(result.finalScore).toBeCloseTo(70, 1)
  })
})

// ─── Cross-resource purchase (u2 costs r1) ──────────────────────────

describe('simulate — cross-resource cost', () => {
  // u2 = Royal Brewery: costs 25 r1, adds +5 r1/s
  // Highlight ale first to earn r1 faster: 2 r1/s → 25/2 = 12.5s
  const result = simulate({ name: 'RB', actions: [hl('r1'), buy('u2'), hl('r0')] }, 'idler')

  it('buys u2 using r1 currency', () => {
    expect(result.purchaseLog).toHaveLength(1)
    expect(result.purchaseLog[0].id).toBe('u2')
  })

  it('r1 is deducted at purchase', () => {
    const purchaseIdx = result.snapshots.findIndex((s) => s.event.includes('buy:u2'))
    expect(purchaseIdx).toBeGreaterThan(0)
    expect(result.snapshots[purchaseIdx].resources.r1).toBeLessThan(
      result.snapshots[purchaseIdx - 1].resources.r1,
    )
  })
})

// ─── Prerequisite enforcement ────────────────────────────────────────

describe('simulate — prerequisite enforcement', () => {
  // u3 (Master Craftsmen) requires u2 (Royal Brewery).
  // Trying to buy u3 without u2 should get stuck — never purchases.
  const result = simulate({ name: 'MC without RB', actions: [hl('r1'), buy('u3')] }, 'idler')

  it('cannot buy u3 without owning prerequisite u2', () => {
    expect(result.purchaseLog).toHaveLength(0)
  })

  it('no purchase events in any snapshot', () => {
    expect(result.snapshots.every((s) => s.event === '')).toBe(true)
  })
})

// ─── Unlimited upgrade (u3) ──────────────────────────────────────────

describe('simulate — unlimited upgrade stacking', () => {
  // Buy u2 first (prereq), then buy u3 twice. Each u3 adds +5 r0/s.
  const result = simulate(
    { name: 'RB→MC×2', actions: [hl('r1'), buy('u2'), buy('u3'), buy('u3'), hl('r0')] },
    'idler',
  )

  it('records both u3 purchases', () => {
    const mcPurchases = result.purchaseLog.filter((p) => p.id === 'u3')
    expect(mcPurchases).toHaveLength(2)
  })

  it('each u3 purchase increases r0 income', () => {
    const mcIndices = result.snapshots
      .map((s, i) => (s.event.includes('buy:u3') ? i : -1))
      .filter((i) => i !== -1)
    expect(mcIndices).toHaveLength(2)

    // After first MC, r0 income should be higher
    const rateBeforeFirst = result.snapshots[mcIndices[0] - 1].incomePerSec.r0
    const rateAfterFirst = result.snapshots[mcIndices[0]].incomePerSec.r0
    expect(rateAfterFirst).toBeGreaterThan(rateBeforeFirst)

    // After second MC, r0 income should increase again
    const rateAfterSecond = result.snapshots[mcIndices[1]].incomePerSec.r0
    expect(rateAfterSecond).toBeGreaterThan(rateAfterFirst)
  })

  it('score is higher than RB-only strategy', () => {
    const rbOnly = simulate({ name: 'RB only', actions: [hl('r1'), buy('u2'), hl('r0')] }, 'idler')
    expect(result.finalScore).toBeGreaterThan(rbOnly.finalScore)
  })
})
