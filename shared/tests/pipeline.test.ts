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
    expect(ctx.resources).toEqual({})
    expect(ctx.globalMultiplier).toBe(1)
  })

  it('sums additive modifiers into the scoped layer', () => {
    const mods: Modifier[] = [
      { stage: 'additive', scope: 'base', field: 'currency', value: 3 },
      { stage: 'additive', scope: 'base', field: 'currency', value: 2 },
    ]
    const ctx = computeIncome(mods)
    expect(ctx.resources.currency.base).toEqual({ add: 5, mult: 1 })
  })

  it('keeps base, generator, and global layers separate', () => {
    const mods: Modifier[] = [
      { stage: 'additive', scope: 'base', field: 'r0', value: 5 },
      { stage: 'additive', scope: 'generator', field: 'r0', value: 10 },
      { stage: 'multiplicative', scope: 'global', field: 'r0', value: 2 },
    ]
    const ctx = computeIncome(mods)
    expect(ctx.resources.r0.base).toEqual({ add: 5, mult: 1 })
    expect(ctx.resources.r0.generator).toEqual({ add: 10, mult: 1 })
    expect(ctx.resources.r0.global).toEqual({ add: 0, mult: 2 })
  })

  it('handles clickIncome through additive + multiplicative (scope-independent)', () => {
    const mods: Modifier[] = [
      { stage: 'additive', scope: 'base', field: 'clickIncome', value: 1 },
      { stage: 'additive', scope: 'base', field: 'clickIncome', value: 1 },
      { stage: 'multiplicative', scope: 'base', field: 'clickIncome', value: 2 },
    ]
    const ctx = computeIncome(mods)
    expect(ctx.clickIncome).toBe(4) // (1+1) * 2
  })

  it('handles globalMultiplier through additive and multiplicative stages', () => {
    const mods: Modifier[] = [
      { stage: 'additive', scope: 'global', field: 'globalMultiplier', value: 0.5 },
      { stage: 'multiplicative', scope: 'global', field: 'globalMultiplier', value: 3 },
    ]
    const ctx = computeIncome(mods)
    // additive: 1 + 0.5 = 1.5; multiplicative: 1.5 * 3 = 4.5
    expect(ctx.globalMultiplier).toBe(4.5)
  })
})

// ─── computeClickIncome ──────────────────────────────────────────────

describe('computeClickIncome', () => {
  it('returns 0 with no modifiers', () => {
    expect(computeClickIncome([])).toBe(0)
  })

  it('applies globalMultiplier to clickIncome', () => {
    const mods: Modifier[] = [
      { stage: 'additive', scope: 'base', field: 'clickIncome', value: 2 },
      { stage: 'multiplicative', scope: 'global', field: 'globalMultiplier', value: 3 },
    ]
    expect(computeClickIncome(mods)).toBe(6) // 2 * 3
  })

  it('chains additive → multiplicative for click income', () => {
    const mods: Modifier[] = [
      { stage: 'additive', scope: 'base', field: 'clickIncome', value: 1 },
      { stage: 'multiplicative', scope: 'base', field: 'clickIncome', value: 2 },
      { stage: 'multiplicative', scope: 'global', field: 'globalMultiplier', value: 1.5 },
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
      { stage: 'additive', scope: 'base', field: 'wood', value: 2 },
      { stage: 'additive', scope: 'base', field: 'ale', value: 1 },
      { stage: 'multiplicative', scope: 'global', field: 'globalMultiplier', value: 2 },
    ]
    const rates = computePassiveRates(mods, ['wood', 'ale'])
    expect(rates.wood).toBe(4) // 2 * 2
    expect(rates.ale).toBe(2) // 1 * 2
  })

  it('combines base + generator layers then applies the per-resource global multiplier', () => {
    const mods: Modifier[] = [
      { stage: 'additive', scope: 'base', field: 'r0', value: 5 },
      { stage: 'additive', scope: 'generator', field: 'r0', value: 15 },
      { stage: 'multiplicative', scope: 'global', field: 'r0', value: 2 },
    ]
    expect(computePassiveRates(mods, ['r0']).r0).toBe(40) // (5 + 15) * 2
  })

  it('base-scope multiplier scales only the base layer, not generators', () => {
    const mods: Modifier[] = [
      { stage: 'additive', scope: 'base', field: 'r0', value: 10 },
      { stage: 'additive', scope: 'generator', field: 'r0', value: 10 },
      { stage: 'multiplicative', scope: 'base', field: 'r0', value: 3 },
    ]
    expect(computePassiveRates(mods, ['r0']).r0).toBe(40) // base 10*3=30, generator 10
  })

  it('generator-scope multiplier scales only the generator layer, not base', () => {
    const mods: Modifier[] = [
      { stage: 'additive', scope: 'base', field: 'r0', value: 10 },
      { stage: 'additive', scope: 'generator', field: 'r0', value: 10 },
      { stage: 'multiplicative', scope: 'generator', field: 'r0', value: 3 },
    ]
    expect(computePassiveRates(mods, ['r0']).r0).toBe(40) // base 10, generator 10*3=30
  })

  it('multiplicative on an empty layer yields 0 (0 * N)', () => {
    const mods: Modifier[] = [{ stage: 'multiplicative', scope: 'base', field: 'wood', value: 2 }]
    expect(computePassiveRates(mods, ['wood']).wood).toBe(0)
  })

  it('only includes declared resources in the result', () => {
    const mods: Modifier[] = [
      { stage: 'additive', scope: 'base', field: 'wood', value: 5 },
      { stage: 'additive', scope: 'base', field: 'gems', value: 99 },
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
      generators: {},
      meta: {},
    }
  }

  it('adds income for one tick', () => {
    const state = makeState({ wood: 0, ale: 0 })
    const mods: Modifier[] = [
      { stage: 'additive', scope: 'base', field: 'wood', value: 4 },
      { stage: 'additive', scope: 'base', field: 'ale', value: 2 },
    ]
    applyPassiveTick(state, ['wood', 'ale'], 'wood', mods, 0.25)
    expect(state.resources.wood).toBe(1) // 4 * 0.25
    expect(state.resources.ale).toBe(0.5) // 2 * 0.25
    expect(state.score).toBe(1) // wood is scoreResource
  })

  it('only adds scoreResource to score', () => {
    const state = makeState({ wood: 0, ale: 0 })
    const mods: Modifier[] = [{ stage: 'additive', scope: 'base', field: 'ale', value: 10 }]
    applyPassiveTick(state, ['wood', 'ale'], 'wood', mods, 1)
    expect(state.resources.ale).toBe(10)
    expect(state.score).toBe(0) // ale is not scoreResource
  })

  it('accumulates across multiple ticks', () => {
    const state = makeState({ currency: 0 })
    const mods: Modifier[] = [{ stage: 'additive', scope: 'base', field: 'currency', value: 1 }]
    applyPassiveTick(state, ['currency'], 'currency', mods, 0.25)
    applyPassiveTick(state, ['currency'], 'currency', mods, 0.25)
    expect(state.resources.currency).toBeCloseTo(0.5)
    expect(state.score).toBeCloseTo(0.5)
  })

  it('handles zero tick duration', () => {
    const state = makeState({ currency: 5 })
    const mods: Modifier[] = [{ stage: 'additive', scope: 'base', field: 'currency', value: 100 }]
    applyPassiveTick(state, ['currency'], 'currency', mods, 0)
    expect(state.resources.currency).toBe(5)
    expect(state.score).toBe(0)
  })

  it('accumulates gameSec in state.meta', () => {
    const state = makeState({ currency: 0 })
    const mods: Modifier[] = [{ stage: 'additive', scope: 'base', field: 'currency', value: 1 }]
    applyPassiveTick(state, ['currency'], 'currency', mods, 0.1)
    applyPassiveTick(state, ['currency'], 'currency', mods, 0.1)
    applyPassiveTick(state, ['currency'], 'currency', mods, 0.1)
    expect(state.meta.gameSec).toBeCloseTo(0.3)
  })
})
