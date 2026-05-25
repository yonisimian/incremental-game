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
  // Idler: buy uh first to unlock highlight, then highlight r0
  // base 1 r0/s, after uh bought: highlight r0 → ×2 → 2 r0/s + 1 r1/s
  const result = simulate({ name: 'baseline', actions: [hl('r0'), buy('uh')] }, 'idler')
  const final = result.snapshots.at(-1)!

  it('accumulates correct score (with highlight unlock delay)', () => {
    // uh costs 5 r0, at 1/s takes 5s. Then 30s at 2/s = 60, plus 5 at 1/s = 5 → ~65
    expect(result.finalScore).toBeGreaterThan(60)
    expect(result.finalScore).toBeLessThan(75)
  })

  it('accumulates correct r0 balance', () => {
    // After buying uh (cost 5), remaining time has highlight active
    expect(final.resources.r0).toBeGreaterThan(55)
  })

  it('accumulates correct r1 balance (1 r1/s × 35s = 35)', () => {
    expect(final.resources.r1).toBeCloseTo(35, 1)
  })

  it('reports correct income rates', () => {
    // After uh purchased, income should be 2 r0/s and 1 r1/s
    expect(final.incomePerSec.r0).toBeCloseTo(2)
    expect(final.incomePerSec.r1).toBeCloseTo(1)
  })

  it('has one purchase event (uh)', () => {
    expect(result.purchaseLog).toHaveLength(1)
    expect(result.purchaseLog[0].id).toBe('uh')
  })
})

// ─── Highlight changes effective immediately ─────────────────────────

describe('simulate — highlight is immediate', () => {
  // Highlight ale instead of wood, with uh unlock: 1 r0/s until uh bought, then 1 r0/s + 2 r1/s
  const result = simulate({ name: 'ale-hl', actions: [hl('r1'), buy('uh')] }, 'idler')
  const final = result.snapshots.at(-1)!

  it('score reflects unhighlighted r0 income (1 r0/s × 35s = 35)', () => {
    expect(result.finalScore).toBeCloseTo(35, 1)
  })

  it('r1 gets highlighted boost (2 r1/s × 35s = 70)', () => {
    // uh costs 5 r0 (r0 at 1/s, so 5s), then 30s at 2 r1/s + 5s at 1 r1/s = 65
    expect(final.resources.r1).toBeGreaterThan(60)
  })
})

// ─── Upgrade purchase ────────────────────────────────────────────────

describe('simulate — upgrade purchase', () => {
  // u1 = Heavy Logging: costs 25 r0, adds +5 r0/s
  // With hl('r0') + uh: base 1 r0/s until uh bought (5s), then 2 r0/s
  // After u1 buy: base 1 + 5 = 6 r0/s, highlight ×2 = 12 r0/s
  const result = simulate({ name: 'HL only', actions: [hl('r0'), buy('uh'), buy('u1')] }, 'idler')

  it('records the purchases in purchaseLog', () => {
    expect(result.purchaseLog.some((p) => p.id === 'u1')).toBe(true)
  })

  it('purchase happens after accumulating 25 r0', () => {
    const u1Purchase = result.purchaseLog.find((p) => p.id === 'u1')!
    // uh costs 5 at 1/s (5s), then need 25 r0 at 2/s (12.5s) → ~17.5s
    expect(u1Purchase.timeSec).toBeGreaterThanOrEqual(17)
    expect(u1Purchase.timeSec).toBeLessThanOrEqual(18.5)
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
  // SA→HL: buy uh first, then u0 (15 r0), then u1 (25 r0)
  const result = simulate(
    { name: 'SA→HL', actions: [hl('r0'), buy('uh'), buy('u0'), buy('u1')] },
    'idler',
  )

  it('records both purchases in order', () => {
    const buyIds = result.purchaseLog.map((p) => p.id)
    expect(buyIds).toContain('u0')
    expect(buyIds).toContain('u1')
    expect(buyIds.indexOf('u0')).toBeLessThan(buyIds.indexOf('u1'))
  })

  it('second purchase happens after the first', () => {
    const u0Time = result.purchaseLog.find((p) => p.id === 'u0')!.timeSec
    const u1Time = result.purchaseLog.find((p) => p.id === 'u1')!.timeSec
    expect(u1Time).toBeGreaterThan(u0Time)
  })
})

// ─── Empty strategy ─────────────────────────────────────────────────

describe('simulate — empty strategy', () => {
  const result = simulate({ name: 'empty', actions: [] }, 'idler')

  it('still runs the full simulation', () => {
    expect(result.snapshots).toHaveLength(totalTicks)
  })

  it('uses default highlight (r0) but no highlight boost without uh', () => {
    // Without uh, no highlight boost: 1 r0/s × 35s = 35
    expect(result.finalScore).toBeCloseTo(35, 1)
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
  // u6 (Skilled Foremen) requires u1 (Heavy Logging).
  // Trying to buy u6 without u1 should get stuck — never purchases.
  const result = simulate({ name: 'u6 without u1', actions: [hl('r0'), buy('u6')] }, 'idler')

  it('cannot buy u6 without owning prerequisite u1', () => {
    expect(result.purchaseLog).toHaveLength(0)
  })

  it('no purchase events in any snapshot', () => {
    expect(result.snapshots.every((s) => s.event === '')).toBe(true)
  })
})

// ─── Prerequisite chain (u1 → u6) ───────────────────────────────────

describe('simulate — prerequisite chain', () => {
  // Buy uh first, then u1 (prereq for u6), then buy u6.
  const result = simulate(
    { name: 'u1→u6', actions: [hl('r0'), buy('uh'), buy('u1'), buy('u6')] },
    'idler',
  )

  it('records u6 purchase after u1', () => {
    const u6Purchases = result.purchaseLog.filter((p) => p.id === 'u6')
    expect(u6Purchases).toHaveLength(1)
  })

  it('score is at least as high as u1-only strategy', () => {
    const u1Only = simulate({ name: 'u1 only', actions: [hl('r0'), buy('u1')] }, 'idler')
    expect(result.finalScore).toBeGreaterThanOrEqual(u1Only.finalScore)
  })
})
