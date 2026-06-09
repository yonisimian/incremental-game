import { describe, expect, it } from 'vitest'
import {
  applyEffect,
  collectModifiers,
  createInitialState,
  getModeDefinition,
  registerEffect,
  resolveEffect,
} from '../src/index.js'
import type { EffectRef, PlayerState } from '../src/index.js'

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
})
