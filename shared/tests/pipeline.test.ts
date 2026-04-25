import { describe, expect, it } from 'vitest'
import {
  computeIncome,
  computeClickIncome,
  computePassiveRates,
  applyPassiveTick,
} from '../src/modifiers/pipeline.js'
import type { Modifier } from '../src/modifiers/types.js'
import type { PlayerState } from '../src/types.js'

// ─── computeIncome ───────────────────────────────────────────────────

describe('computeIncome', () => {
  it('returns zeroed context with no modifiers', () => {
    const ctx = computeIncome([])
    expect(ctx.clickIncome).toBe(0)
    expect(ctx.rates).toEqual({})
    expect(ctx.globalMultiplier).toBe(1)
  })

  it('sums additive modifiers', () => {
    const mods: Modifier[] = [
      { stage: 'additive', field: 'currency', value: 3 },
      { stage: 'additive', field: 'currency', value: 2 },
    ]
    const ctx = computeIncome(mods)
    expect(ctx.rates.currency).toBe(5)
  })

  it('applies additive then multiplicative', () => {
    const mods: Modifier[] = [
      { stage: 'additive', field: 'currency', value: 5 },
      { stage: 'multiplicative', field: 'currency', value: 3 },
    ]
    const ctx = computeIncome(mods)
    expect(ctx.rates.currency).toBe(15) // 5 * 3
  })

  it('handles clickIncome through additive + multiplicative', () => {
    const mods: Modifier[] = [
      { stage: 'additive', field: 'clickIncome', value: 1 },
      { stage: 'additive', field: 'clickIncome', value: 1 },
      { stage: 'multiplicative', field: 'clickIncome', value: 2 },
    ]
    const ctx = computeIncome(mods)
    expect(ctx.clickIncome).toBe(4) // (1+1) * 2
  })

  it('handles globalMultiplier through all stages', () => {
    const mods: Modifier[] = [
      { stage: 'additive', field: 'globalMultiplier', value: 0.5 },
      { stage: 'multiplicative', field: 'globalMultiplier', value: 2 },
      { stage: 'global', field: 'globalMultiplier', value: 3 },
    ]
    const ctx = computeIncome(mods)
    // additive: 1 + 0.5 = 1.5; multiplicative: 1.5 * 2 = 3; global: 3 * 3 = 9
    expect(ctx.globalMultiplier).toBe(9)
  })

  it('multiplicative on empty rate creates the rate (0 * N = 0)', () => {
    const mods: Modifier[] = [{ stage: 'multiplicative', field: 'wood', value: 2 }]
    const ctx = computeIncome(mods)
    expect(ctx.rates.wood).toBe(0)
  })

  it('handles multiple independent resources', () => {
    const mods: Modifier[] = [
      { stage: 'additive', field: 'wood', value: 1 },
      { stage: 'additive', field: 'ale', value: 2 },
      { stage: 'multiplicative', field: 'wood', value: 3 },
    ]
    const ctx = computeIncome(mods)
    expect(ctx.rates.wood).toBe(3) // 1 * 3
    expect(ctx.rates.ale).toBe(2) // 2, no multiplier
  })
})

// ─── computeClickIncome ──────────────────────────────────────────────

describe('computeClickIncome', () => {
  it('returns 0 with no modifiers', () => {
    expect(computeClickIncome([])).toBe(0)
  })

  it('applies globalMultiplier to clickIncome', () => {
    const mods: Modifier[] = [
      { stage: 'additive', field: 'clickIncome', value: 2 },
      { stage: 'global', field: 'globalMultiplier', value: 3 },
    ]
    expect(computeClickIncome(mods)).toBe(6) // 2 * 3
  })

  it('chains additive → multiplicative → global for click income', () => {
    const mods: Modifier[] = [
      { stage: 'additive', field: 'clickIncome', value: 1 },
      { stage: 'multiplicative', field: 'clickIncome', value: 2 },
      { stage: 'global', field: 'globalMultiplier', value: 1.5 },
    ]
    expect(computeClickIncome(mods)).toBe(3) // (1 * 2) * 1.5
  })
})

// ─── computePassiveRates ─────────────────────────────────────────────

describe('computePassiveRates', () => {
  it('returns zero rates for all declared resources when no modifiers', () => {
    const rates = computePassiveRates([], ['wood', 'ale'])
    expect(rates).toEqual({ wood: 0, ale: 0 })
  })

  it('applies modifiers and globalMultiplier', () => {
    const mods: Modifier[] = [
      { stage: 'additive', field: 'wood', value: 2 },
      { stage: 'additive', field: 'ale', value: 1 },
      { stage: 'global', field: 'globalMultiplier', value: 2 },
    ]
    const rates = computePassiveRates(mods, ['wood', 'ale'])
    expect(rates.wood).toBe(4) // 2 * 2
    expect(rates.ale).toBe(2) // 1 * 2
  })

  it('only includes declared resources in the result', () => {
    const mods: Modifier[] = [
      { stage: 'additive', field: 'wood', value: 5 },
      { stage: 'additive', field: 'gems', value: 99 },
    ]
    const rates = computePassiveRates(mods, ['wood'])
    expect(rates).toEqual({ wood: 5 })
    expect(rates.gems).toBeUndefined()
  })
})

// ─── applyPassiveTick ────────────────────────────────────────────────

describe('applyPassiveTick', () => {
  function makeState(resources: Record<string, number>): PlayerState {
    return {
      score: 0,
      resources: { ...resources },
      upgrades: {},
      meta: {},
    }
  }

  it('adds income for one tick', () => {
    const state = makeState({ wood: 0, ale: 0 })
    const mods: Modifier[] = [
      { stage: 'additive', field: 'wood', value: 4 },
      { stage: 'additive', field: 'ale', value: 2 },
    ]
    applyPassiveTick(state, ['wood', 'ale'], 'wood', mods, 0.25)
    expect(state.resources.wood).toBe(1) // 4 * 0.25
    expect(state.resources.ale).toBe(0.5) // 2 * 0.25
    expect(state.score).toBe(1) // wood is scoreResource
  })

  it('only adds scoreResource to score', () => {
    const state = makeState({ wood: 0, ale: 0 })
    const mods: Modifier[] = [{ stage: 'additive', field: 'ale', value: 10 }]
    applyPassiveTick(state, ['wood', 'ale'], 'wood', mods, 1)
    expect(state.resources.ale).toBe(10)
    expect(state.score).toBe(0) // ale is not scoreResource
  })

  it('accumulates across multiple ticks', () => {
    const state = makeState({ currency: 0 })
    const mods: Modifier[] = [{ stage: 'additive', field: 'currency', value: 1 }]
    applyPassiveTick(state, ['currency'], 'currency', mods, 0.25)
    applyPassiveTick(state, ['currency'], 'currency', mods, 0.25)
    expect(state.resources.currency).toBeCloseTo(0.5)
    expect(state.score).toBeCloseTo(0.5)
  })

  it('handles zero tick duration', () => {
    const state = makeState({ currency: 5 })
    const mods: Modifier[] = [{ stage: 'additive', field: 'currency', value: 100 }]
    applyPassiveTick(state, ['currency'], 'currency', mods, 0)
    expect(state.resources.currency).toBe(5)
    expect(state.score).toBe(0)
  })
})
