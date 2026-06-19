import { describe, expect, it } from 'vitest'
import {
  applyEffect,
  collectModifiers,
  createInitialState,
  getModeDefinition,
  listEffectTypes,
  registerEffect,
  resolveEffect,
} from '../src/index.js'
import type { EffectRef, ModeDefinition, PlayerState, UpgradeDefinition } from '../src/index.js'

// ─── Registry ────────────────────────────────────────────────────────

describe('effect registry', () => {
  it('resolves a registered seed effect', () => {
    expect(resolveEffect('highlightMultiplier')).toBeDefined()
  })

  it('returns undefined for an unknown type', () => {
    expect(resolveEffect('doesNotExist')).toBeUndefined()
  })

  it('throws when applying an unknown effect type', () => {
    const state = createInitialState(getModeDefinition('idler'))
    expect(() => applyEffect({ type: 'doesNotExist' }, state)).toThrow(/unknown effect type/iu)
  })

  it('throws when registering a duplicate type', () => {
    const existing = resolveEffect('highlightMultiplier')!
    expect(() => {
      registerEffect('highlightMultiplier', existing)
    }).toThrow(/already registered/iu)
  })

  it('lists registered effect types sorted', () => {
    expect(listEffectTypes()).toEqual(['highlightMultiplier'])
  })
})

// ─── highlightMultiplier param validation ────────────────────────────

describe('highlightMultiplier params', () => {
  function applyHighlight(ref: EffectRef): unknown {
    const state = createInitialState(getModeDefinition('idler'))
    return applyEffect(ref, state)
  }

  it('rejects a non-finite multiplier', () => {
    expect(() => applyHighlight({ type: 'highlightMultiplier', multiplier: Infinity })).toThrow(
      /multiplier/u,
    )
  })

  it('rejects a non-number multiplier', () => {
    expect(() => applyHighlight({ type: 'highlightMultiplier', multiplier: 'x' })).toThrow(
      /multiplier/u,
    )
  })

  it('rejects unknown params (strict schema)', () => {
    expect(() =>
      applyHighlight({ type: 'highlightMultiplier', multiplier: 2, boostUpgradeId: 'uh2' }),
    ).toThrow()
  })
})

// ─── Golden parity: highlight behavior must match the pre-effect closure ──

describe('highlightMultiplier behavior (golden)', () => {
  function idlerState(): PlayerState {
    return createInitialState(getModeDefinition('idler'))
  }

  it('emits no highlight multiplier before the unlock upgrade is owned', () => {
    const def = getModeDefinition('idler')
    const state = idlerState()
    const mods = collectModifiers(state, def)
    expect(mods.some((m) => m.stage === 'multiplicative')).toBe(false)
  })

  it('doubles the highlighted resource (r0) once the unlock is owned', () => {
    const def = getModeDefinition('idler')
    const state = idlerState()
    state.upgrades['sh-unlock'] = 1
    state.meta.highlight = 'r0'
    const mods = collectModifiers(state, def)
    expect(mods).toContainEqual({ stage: 'multiplicative', field: 'r0', value: 2 })
  })

  it('follows the highlighted resource when it changes (r1)', () => {
    const def = getModeDefinition('idler')
    const state = idlerState()
    state.upgrades['sh-unlock'] = 1
    state.meta.highlight = 'r1'
    const mods = collectModifiers(state, def)
    expect(mods).toContainEqual({ stage: 'multiplicative', field: 'r1', value: 2 })
    expect(mods.some((m) => m.stage === 'multiplicative' && m.field === 'r0')).toBe(false)
  })

  it('falls back to r0 when no resource is highlighted', () => {
    const def = getModeDefinition('idler')
    const state = idlerState()
    state.upgrades['sh-unlock'] = 1
    delete state.meta.highlight
    const mods = collectModifiers(state, def)
    expect(mods).toContainEqual({ stage: 'multiplicative', field: 'r0', value: 2 })
  })

  it('raises the highlight to ×2.2 once the boost upgrade (sh-mf-hp) is owned', () => {
    const def = getModeDefinition('idler')
    const state = idlerState()
    state.upgrades['sh-unlock'] = 1
    state.upgrades['sh-mf-hp'] = 1
    state.meta.highlight = 'r0'
    const mods = collectModifiers(state, def)
    // The boost is distributed: sh-unlock emits ×2 and sh-mf-hp emits ×1.1, stacking to ×2.2.
    expect(mods).toContainEqual({ stage: 'multiplicative', field: 'r0', value: 2 })
    expect(mods).toContainEqual({ stage: 'multiplicative', field: 'r0', value: 1.1 })
    const r0Factor = mods
      .filter((m) => m.stage === 'multiplicative' && m.field === 'r0')
      .reduce((acc, m) => acc * m.value, 1)
    expect(r0Factor).toBeCloseTo(2.2)
  })

  it('applies the ×2.2 boost to the highlighted resource when it changes (r1)', () => {
    const def = getModeDefinition('idler')
    const state = idlerState()
    state.upgrades['sh-unlock'] = 1
    state.upgrades['sh-mf-hp'] = 1
    state.meta.highlight = 'r1'
    const mods = collectModifiers(state, def)
    const r1Factor = mods
      .filter((m) => m.stage === 'multiplicative' && m.field === 'r1')
      .reduce((acc, m) => acc * m.value, 1)
    expect(r1Factor).toBeCloseTo(2.2)
    expect(mods.some((m) => m.stage === 'multiplicative' && m.field === 'r0')).toBe(false)
  })

  it('does not boost when sh-mf-hp is owned but the unlock (sh-unlock) is not', () => {
    const def = getModeDefinition('idler')
    const state = idlerState()
    state.upgrades['sh-mf-hp'] = 1
    state.meta.highlight = 'r0'
    const mods = collectModifiers(state, def)
    // sh-mf-hp's ×1.1 still applies (it gates on its own ownership), but the ×2 base
    // is absent without sh-unlock — and sh-mf-hp's prerequisite makes this unreachable in play.
    expect(mods.some((m) => m.stage === 'multiplicative' && m.value === 2)).toBe(false)
  })
})

// ─── collectModifiers effect wiring ──────────────────────────────────

describe('collectModifiers effect wiring', () => {
  it('applies per-upgrade effects only when the upgrade is owned', () => {
    const base = getModeDefinition('idler')
    const customUpgrade: UpgradeDefinition = {
      id: 'uEffect',
      cost: { r0: 10 },
      purchaseLimit: 1,
      modifiers: [],
      // Gated by placement: per-upgrade effects run only once `uEffect` is owned.
      effects: [{ type: 'highlightMultiplier', multiplier: 3 }],
    }
    const def: ModeDefinition = { ...base, upgrades: [...base.upgrades, customUpgrade] }

    const owned = createInitialState(def)
    owned.upgrades.uEffect = 1
    owned.meta.highlight = 'r1'
    expect(collectModifiers(owned, def)).toContainEqual({
      stage: 'multiplicative',
      field: 'r1',
      value: 3,
    })

    const unowned = createInitialState(def)
    unowned.meta.highlight = 'r1'
    expect(collectModifiers(unowned, def).some((m) => m.value === 3)).toBe(false)
  })

  it('routes generator-targeted effect modifiers into generator output', () => {
    const def = getModeDefinition('idler')
    const sumAdditive = (
      mods: readonly { field: string; stage: string; value: number }[],
      f: string,
    ) =>
      mods.filter((m) => m.field === f && m.stage === 'additive').reduce((s, m) => s + m.value, 0)

    // Highlight a generator id (g1: produces r1 at rate 1) → sh-unlock's per-upgrade
    // highlight effect emits a g1-targeted ×2, which must fold into g1's output.
    const hi = createInitialState(def)
    hi.upgrades['sh-unlock'] = 1
    hi.generators.g1 = 1
    hi.meta.highlight = 'g1'
    const hiMods = collectModifiers(hi, def)

    const lo = createInitialState(def)
    lo.upgrades['sh-unlock'] = 1
    lo.generators.g1 = 1
    lo.meta.highlight = 'r0'
    const loMods = collectModifiers(lo, def)

    // The generator-targeted multiplier is consumed, never leaked as a standalone
    // modifier on the generator id.
    expect(hiMods.some((m) => m.field === 'g1')).toBe(false)
    // g1 (rate 1, owned 1) doubles: its r1 output gains exactly one extra unit.
    expect(sumAdditive(hiMods, 'r1')).toBe(sumAdditive(loMods, 'r1') + 1)
  })

  it('applies mode-level effects regardless of upgrade ownership', () => {
    const base = getModeDefinition('idler')
    // A mode-level effect is ungated by upgrade ownership — it always runs.
    const def: ModeDefinition = {
      ...base,
      effects: [{ type: 'highlightMultiplier', multiplier: 5 }],
    }
    const state = createInitialState(def)
    state.meta.highlight = 'r0'
    expect(collectModifiers(state, def)).toContainEqual({
      stage: 'multiplicative',
      field: 'r0',
      value: 5,
    })
  })
})
