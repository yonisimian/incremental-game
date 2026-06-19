import { describe, expect, it } from 'vitest'
import {
  collectModifiers,
  computeClickIncome,
  createInitialState,
  getModeDefinition,
  isClickUnlocked,
} from '../src/index.js'
import type { ModeDefinition, PlayerState } from '../src/index.js'

// The clicker branch of the idler tree: `sc-unlock` gates clicking, `sc-af-cp`
// adds flat click power, and `sc-mf-cp` multiplies it.

function idlerState(): { def: ModeDefinition; state: PlayerState } {
  const def = getModeDefinition('idler')
  return { def, state: createInitialState(def) }
}

function clickIncome(state: PlayerState, def: ModeDefinition): number {
  return computeClickIncome(collectModifiers(state, def))
}

describe('isClickUnlocked', () => {
  it('is locked until the unlock upgrade is owned', () => {
    const { def, state } = idlerState()
    expect(isClickUnlocked(state, def)).toBe(false)
    state.upgrades['sc-unlock'] = 1
    expect(isClickUnlocked(state, def)).toBe(true)
  })
})

describe('clicker upgrade click income', () => {
  it('yields no click income before clicking is unlocked', () => {
    const { def, state } = idlerState()
    expect(clickIncome(state, def)).toBe(0)
  })

  it('grants base click income once unlocked', () => {
    const { def, state } = idlerState()
    state.upgrades['sc-unlock'] = 1
    expect(clickIncome(state, def)).toBe(1)
  })

  it('adds flat click power per level of sc-af-cp', () => {
    const { def, state } = idlerState()
    state.upgrades['sc-unlock'] = 1
    state.upgrades['sc-af-cp'] = 1
    expect(clickIncome(state, def)).toBe(2) // base 1 + 1 flat
    state.upgrades['sc-af-cp'] = 3
    expect(clickIncome(state, def)).toBe(4) // base 1 + 3 flat
  })

  it('compounds the sc-mf-cp multiplier across levels', () => {
    const { def, state } = idlerState()
    state.upgrades['sc-unlock'] = 1
    state.upgrades['sc-af-cp'] = 1 // click power = 2
    state.upgrades['sc-mf-cp'] = 2 // x1.1 compounded twice
    expect(clickIncome(state, def)).toBeCloseTo(2 * 1.1 ** 2)
  })
})
