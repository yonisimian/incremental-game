import { describe, expect, it } from 'vitest'
import {
  applyEffect,
  collectModifiers,
  createInitialState,
  getModeDefinition,
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
})

// ─── highlightMultiplier param validation ────────────────────────────

describe('highlightMultiplier params', () => {
  function applyHighlight(ref: EffectRef): unknown {
    const state = createInitialState(getModeDefinition('idler'))
    return applyEffect(ref, state)
  }

  it('rejects a missing unlockUpgradeId', () => {
    expect(() => applyHighlight({ type: 'highlightMultiplier', multiplier: 2 })).toThrow(
      /unlockUpgradeId/u,
    )
  })

  it('rejects a non-string unlockUpgradeId', () => {
    expect(() =>
      applyHighlight({ type: 'highlightMultiplier', unlockUpgradeId: 7, multiplier: 2 }),
    ).toThrow(/unlockUpgradeId/u)
  })

  it('rejects a non-finite multiplier', () => {
    expect(() =>
      applyHighlight({ type: 'highlightMultiplier', unlockUpgradeId: 'uh', multiplier: Infinity }),
    ).toThrow(/multiplier/u)
  })

  it('rejects a non-number multiplier', () => {
    expect(() =>
      applyHighlight({ type: 'highlightMultiplier', unlockUpgradeId: 'uh', multiplier: 'x' }),
    ).toThrow(/multiplier/u)
  })

  it('rejects boostUpgradeId without boostedMultiplier', () => {
    expect(() =>
      applyHighlight({
        type: 'highlightMultiplier',
        unlockUpgradeId: 'uh',
        multiplier: 2,
        boostUpgradeId: 'uh2',
      }),
    ).toThrow(/together/u)
  })

  it('rejects boostedMultiplier without boostUpgradeId', () => {
    expect(() =>
      applyHighlight({
        type: 'highlightMultiplier',
        unlockUpgradeId: 'uh',
        multiplier: 2,
        boostedMultiplier: 3,
      }),
    ).toThrow(/together/u)
  })

  it('rejects a non-finite boostedMultiplier', () => {
    expect(() =>
      applyHighlight({
        type: 'highlightMultiplier',
        unlockUpgradeId: 'uh',
        multiplier: 2,
        boostUpgradeId: 'uh2',
        boostedMultiplier: Infinity,
      }),
    ).toThrow(/boostedMultiplier/u)
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
    state.upgrades.uh = 1
    state.meta.highlight = 'r0'
    const mods = collectModifiers(state, def)
    expect(mods).toContainEqual({ stage: 'multiplicative', field: 'r0', value: 2 })
  })

  it('follows the highlighted resource when it changes (r1)', () => {
    const def = getModeDefinition('idler')
    const state = idlerState()
    state.upgrades.uh = 1
    state.meta.highlight = 'r1'
    const mods = collectModifiers(state, def)
    expect(mods).toContainEqual({ stage: 'multiplicative', field: 'r1', value: 2 })
    expect(mods.some((m) => m.stage === 'multiplicative' && m.field === 'r0')).toBe(false)
  })

  it('falls back to r0 when no resource is highlighted', () => {
    const def = getModeDefinition('idler')
    const state = idlerState()
    state.upgrades.uh = 1
    delete state.meta.highlight
    const mods = collectModifiers(state, def)
    expect(mods).toContainEqual({ stage: 'multiplicative', field: 'r0', value: 2 })
  })

  it('raises the highlight to ×3 once the boost upgrade (uh2) is owned', () => {
    const def = getModeDefinition('idler')
    const state = idlerState()
    state.upgrades.uh = 1
    state.upgrades.uh2 = 1
    state.meta.highlight = 'r0'
    const mods = collectModifiers(state, def)
    expect(mods).toContainEqual({ stage: 'multiplicative', field: 'r0', value: 3 })
    expect(mods.some((m) => m.stage === 'multiplicative' && m.value === 2)).toBe(false)
  })

  it('does not boost when uh2 is owned but the unlock (uh) is not', () => {
    const def = getModeDefinition('idler')
    const state = idlerState()
    state.upgrades.uh2 = 1
    state.meta.highlight = 'r0'
    const mods = collectModifiers(state, def)
    expect(mods.some((m) => m.stage === 'multiplicative')).toBe(false)
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
      // Self-gated: emits a ×3 highlight modifier once `uEffect` is owned.
      effects: [{ type: 'highlightMultiplier', unlockUpgradeId: 'uEffect', multiplier: 3 }],
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

    // Highlight a generator id (g1: produces r1 at rate 1) → the mode-level
    // highlight effect emits a g1-targeted ×2, which must fold into g1's output.
    const hi = createInitialState(def)
    hi.upgrades.uh = 1
    hi.generators.g1 = 1
    hi.meta.highlight = 'g1'
    const hiMods = collectModifiers(hi, def)

    const lo = createInitialState(def)
    lo.upgrades.uh = 1
    lo.generators.g1 = 1
    lo.meta.highlight = 'r0'
    const loMods = collectModifiers(lo, def)

    // The generator-targeted multiplier is consumed, never leaked as a standalone
    // modifier on the generator id.
    expect(hiMods.some((m) => m.field === 'g1')).toBe(false)
    // g1 (rate 1, owned 1) doubles: its r1 output gains exactly one extra unit.
    expect(sumAdditive(hiMods, 'r1')).toBe(sumAdditive(loMods, 'r1') + 1)
  })
})
