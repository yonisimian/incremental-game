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
  })

  it('sums additive modifiers into a resource global layer', () => {
    const mods: Modifier[] = [
      { stage: 'additive', field: 'currency', value: 3 },
      { stage: 'additive', field: 'currency', value: 2 },
    ]
    const ctx = computeIncome(mods, ['currency'])
    expect(ctx.resources.currency.global.add).toBe(5)
  })

  it('applies additive then multiplicative on the global layer', () => {
    const mods: Modifier[] = [
      { stage: 'additive', field: 'currency', value: 5 },
      { stage: 'multiplicative', field: 'currency', value: 3 },
    ]
    expect(computePassiveRates(mods, ['currency']).currency).toBe(15) // 5 * 3
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

  it('ignores globalMultiplier modifiers in the pipeline', () => {
    const mods: Modifier[] = [
      { stage: 'additive', field: 'globalMultiplier', value: 0.5 },
      { stage: 'multiplicative', field: 'globalMultiplier', value: 3 },
    ]
    const ctx = computeIncome(mods)
    expect(ctx.resources).toEqual({})
    expect(ctx.clickIncome).toBe(0)
  })

  it('multiplicative on empty rate creates the rate (0 * N = 0)', () => {
    const mods: Modifier[] = [{ stage: 'multiplicative', field: 'wood', value: 2 }]
    expect(computePassiveRates(mods, ['wood']).wood).toBe(0)
  })

  it('handles multiple independent resources', () => {
    const mods: Modifier[] = [
      { stage: 'additive', field: 'wood', value: 1 },
      { stage: 'additive', field: 'ale', value: 2 },
      { stage: 'multiplicative', field: 'wood', value: 3 },
    ]
    const rates = computePassiveRates(mods, ['wood', 'ale'])
    expect(rates.wood).toBe(3) // 1 * 3
    expect(rates.ale).toBe(2) // 2, no multiplier
  })

  it('ignores an unknown or out-of-range field', () => {
    const mods: Modifier[] = [
      { stage: 'additive', field: 'r5', value: 9 }, // undeclared resource
      { stage: 'additive', field: 'b9', value: 9 }, // out-of-range base producer
    ]
    const ctx = computeIncome(mods, ['r0'])
    expect(ctx.resources.r0).toEqual({ base: { add: 0, mult: 1 }, global: { add: 0, mult: 1 } })
  })
})

// ─── base vs global layering (the generator-leak fix) ────────────────

describe('base / global production layers', () => {
  // A generator's folded output arrives as an additive resource-id (global)
  // modifier — the same shape `collectModifiers` emits.
  const generatorOutput = (resource: string, value: number): Modifier => ({
    stage: 'additive',
    field: resource,
    value,
  })

  it('a base (`bK`) multiplier scales only base production, not generators', () => {
    const mods: Modifier[] = [
      { stage: 'additive', field: 'b0', value: 10 }, // base floor
      generatorOutput('r0', 100), // generator output (global layer)
      { stage: 'multiplicative', field: 'b0', value: 2 }, // "Sharpen Axe" — base only
    ]
    // (10 * 2) + 100 = 120 — the ×2 must NOT touch the 100 of generator output.
    expect(computePassiveRates(mods, ['r0']).r0).toBe(120)
  })

  it('a global (`rK`) multiplier scales base AND generators', () => {
    const mods: Modifier[] = [
      { stage: 'additive', field: 'b0', value: 10 },
      generatorOutput('r0', 100),
      { stage: 'multiplicative', field: 'r0', value: 2 }, // global — everything
    ]
    // (10 + 100) * 2 = 220.
    expect(computePassiveRates(mods, ['r0']).r0).toBe(220)
  })

  it('ignores globalMultiplier modifiers when computing passive rates', () => {
    const mods: Modifier[] = [
      { stage: 'additive', field: 'b0', value: 10 },
      generatorOutput('r0', 100),
      { stage: 'multiplicative', field: 'b0', value: 2 }, // base ×2 → 20
      { stage: 'multiplicative', field: 'r0', value: 3 }, // global ×3
      { stage: 'multiplicative', field: 'globalMultiplier', value: 5 },
    ]
    // ((10*2) + 100) * 3 = 360.
    expect(computePassiveRates(mods, ['r0']).r0).toBe(360)
  })
})

// ─── computeClickIncome ──────────────────────────────────────────────

describe('computeClickIncome', () => {
  it('returns 0 with no modifiers', () => {
    expect(computeClickIncome([])).toBe(0)
  })

  it('ignores globalMultiplier modifiers when computing click income', () => {
    const mods: Modifier[] = [
      { stage: 'additive', field: 'clickIncome', value: 2 },
      { stage: 'multiplicative', field: 'globalMultiplier', value: 3 },
    ]
    expect(computeClickIncome(mods)).toBe(2)
  })

  it('chains additive → multiplicative for click income', () => {
    const mods: Modifier[] = [
      { stage: 'additive', field: 'clickIncome', value: 1 },
      { stage: 'multiplicative', field: 'clickIncome', value: 2 },
      { stage: 'multiplicative', field: 'globalMultiplier', value: 1.5 },
    ]
    expect(computeClickIncome(mods)).toBe(2) // 1 * 2
  })
})

// ─── computePassiveRates ─────────────────────────────────────────────

describe('computePassiveRates', () => {
  it('returns zero rates for all declared resources when no modifiers', () => {
    const rates = computePassiveRates([], ['wood', 'ale'])
    expect(rates).toEqual({ wood: 0, ale: 0 })
  })

  it('ignores globalMultiplier modifiers when computing passive rates', () => {
    const mods: Modifier[] = [
      { stage: 'additive', field: 'wood', value: 2 },
      { stage: 'additive', field: 'ale', value: 1 },
      { stage: 'multiplicative', field: 'globalMultiplier', value: 2 },
    ]
    const rates = computePassiveRates(mods, ['wood', 'ale'])
    expect(rates.wood).toBe(2)
    expect(rates.ale).toBe(1)
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
      generators: {},
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

  it('accumulates gameSec in state.meta', () => {
    const state = makeState({ currency: 0 })
    const mods: Modifier[] = [{ stage: 'additive', field: 'currency', value: 1 }]
    applyPassiveTick(state, ['currency'], 'currency', mods, 0.1)
    applyPassiveTick(state, ['currency'], 'currency', mods, 0.1)
    applyPassiveTick(state, ['currency'], 'currency', mods, 0.1)
    expect(state.meta.gameSec).toBeCloseTo(0.3)
  })
})
