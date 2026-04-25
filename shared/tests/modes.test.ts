import { describe, expect, it } from 'vitest'
import {
  getModeDefinition,
  getDefaultGoal,
  createInitialState,
  collectModifiers,
  applyPurchase,
} from '../src/index.js'
import type { ModeDefinition, PlayerState } from '../src/index.js'

// ─── getModeDefinition ───────────────────────────────────────────────

describe('getModeDefinition', () => {
  it('returns the clicker mode definition', () => {
    const def = getModeDefinition('clicker')
    expect(def.resources).toEqual(['currency'])
    expect(def.scoreResource).toBe('currency')
    expect(def.clicksEnabled).toBe(true)
  })

  it('returns the idler mode definition', () => {
    const def = getModeDefinition('idler')
    expect(def.resources).toEqual(['wood', 'ale'])
    expect(def.scoreResource).toBe('wood')
    expect(def.clicksEnabled).toBe(false)
  })
})

// ─── getDefaultGoal ──────────────────────────────────────────────────

describe('getDefaultGoal', () => {
  it('returns the first goal for clicker', () => {
    const goal = getDefaultGoal('clicker')
    expect(goal.type).toBe('timed')
  })

  it('returns the first goal for idler', () => {
    const goal = getDefaultGoal('idler')
    expect(goal.type).toBe('timed')
  })
})

// ─── createInitialState ──────────────────────────────────────────────

describe('createInitialState', () => {
  it('creates fresh clicker state', () => {
    const def = getModeDefinition('clicker')
    const state = createInitialState(def)
    expect(state.score).toBe(0)
    expect(state.resources).toEqual({ currency: 0 })
    expect(state.meta).toEqual({})
    // All upgrades initialized to 0
    for (const u of def.upgrades) {
      expect(state.upgrades[u.id]).toBe(0)
    }
  })

  it('creates fresh idler state with highlight meta', () => {
    const def = getModeDefinition('idler')
    const state = createInitialState(def)
    expect(state.score).toBe(0)
    expect(state.resources).toEqual({ wood: 0, ale: 0 })
    expect(state.meta.highlight).toBe('wood')
  })

  it('returns independent copies (no shared references)', () => {
    const def = getModeDefinition('clicker')
    const a = createInitialState(def)
    const b = createInitialState(def)
    a.resources.currency = 999
    a.upgrades['auto-clicker'] = 1
    expect(b.resources.currency).toBe(0)
    expect(b.upgrades['auto-clicker']).toBe(0)
  })
})

// ─── collectModifiers ────────────────────────────────────────────────

describe('collectModifiers', () => {
  it('includes native modifiers for clicker', () => {
    const def = getModeDefinition('clicker')
    const state = createInitialState(def)
    const mods = collectModifiers(state, def)
    // Should at least include the base clickIncome modifier
    expect(mods.some((m) => m.field === 'clickIncome')).toBe(true)
  })

  it('includes upgrade modifiers when owned', () => {
    const def = getModeDefinition('clicker')
    const state = createInitialState(def)
    state.upgrades['auto-clicker'] = 1
    const mods = collectModifiers(state, def)
    // auto-clicker adds +1 currency/sec
    expect(mods.some((m) => m.field === 'currency' && m.value === 1)).toBe(true)
  })

  it('does not include unowned upgrade modifiers', () => {
    const def = getModeDefinition('clicker')
    const state = createInitialState(def)
    const mods = collectModifiers(state, def)
    // No currency rate without auto-clicker
    expect(mods.filter((m) => m.field === 'currency')).toHaveLength(0)
  })

  it('scales repeatable upgrade modifiers by count', () => {
    const def = getModeDefinition('idler')
    const state = createInitialState(def)
    state.upgrades['tavern-recruits'] = 3
    const mods = collectModifiers(state, def)
    // tavern-recruits: +1 base wood/sec × 3 = +3
    const trMod = mods.find((m) => m.field === 'wood' && m.stage === 'additive' && m.value === 3)
    expect(trMod).toBeDefined()
  })

  it('calls collectDynamic for idler mode', () => {
    const def = getModeDefinition('idler')
    const state = createInitialState(def)
    const mods = collectModifiers(state, def)
    // Highlight mechanic should produce a multiplicative modifier
    expect(
      mods.some((m) => m.stage === 'multiplicative' && (m.field === 'wood' || m.field === 'ale')),
    ).toBe(true)
  })
})

// ─── applyPurchase ───────────────────────────────────────────────────

describe('applyPurchase', () => {
  function makeState(def: ModeDefinition): PlayerState {
    return createInitialState(def)
  }

  it('deducts cost from scoreResource for clicker upgrades', () => {
    const def = getModeDefinition('clicker')
    const state = makeState(def)
    state.resources.currency = 50
    applyPurchase(state, 'auto-clicker', def) // costs 10
    expect(state.resources.currency).toBe(40)
    expect(state.upgrades['auto-clicker']).toBe(1)
  })

  it('deducts cost from costCurrency for idler upgrades', () => {
    const def = getModeDefinition('idler')
    const state = makeState(def)
    state.resources.wood = 100
    applyPurchase(state, 'sharpened-axes', def) // costs 30 wood
    expect(state.resources.wood).toBe(70)
    expect(state.upgrades['sharpened-axes']).toBe(1)
  })

  it('increments count for repeatable upgrades', () => {
    const def = getModeDefinition('idler')
    const state = makeState(def)
    state.resources.ale = 45
    applyPurchase(state, 'tavern-recruits', def) // costs 15 ale
    applyPurchase(state, 'tavern-recruits', def)
    applyPurchase(state, 'tavern-recruits', def)
    expect(state.upgrades['tavern-recruits']).toBe(3)
    expect(state.resources.ale).toBe(0)
  })

  it('does nothing for unknown upgrade ID', () => {
    const def = getModeDefinition('clicker')
    const state = makeState(def)
    state.resources.currency = 999
    applyPurchase(state, 'bogus', def)
    expect(state.resources.currency).toBe(999)
  })
})
