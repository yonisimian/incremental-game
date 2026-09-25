import { describe, expect, it } from 'vitest'
import {
  collectEnemyDebuffs,
  collectModifiers,
  computeClickIncome,
  createInitialState,
  getModeDefinition,
  INCOMING_CLICK_INCOME_FIELD,
  isClickUnlocked,
  resolveEnemyDebuffs,
} from '../src/index.js'
import type { Modifier, ModeDefinition, PlayerState } from '../src/index.js'

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

  // `sc-pcps` sits after `sc-mf-cp` in the tree, so a click track folded in
  // array order added its bonus after the multiplier had run (8.84). Every own
  // flat bonus is now multiplied, wherever its node sits.
  it('multiplies sc-pcps like every other flat bonus, regardless of tree order', () => {
    const { def, state } = idlerState()
    Object.assign(state.upgrades, { 'sc-unlock': 1, 'sc-af-cp': 3, 'sc-mf-cp': 2, 'sc-pcps': 1 })
    state.meta.peakCps = 4
    expect(clickIncome(state, def)).toBeCloseTo((1 + 3 + 4) * 1.1 ** 2, 9) // 9.68
  })
})

describe('enemy click debuffs', () => {
  /** A victim with the plan-35 build: 9.68 per click undebuffed. */
  function victim(): { def: ModeDefinition; state: PlayerState } {
    const { def, state } = idlerState()
    Object.assign(state.upgrades, { 'sc-unlock': 1, 'sc-af-cp': 3, 'sc-mf-cp': 2, 'sc-pcps': 1 })
    state.meta.peakCps = 4
    return { def, state }
  }

  /** The resolved click debuffs of an attacker holding both idler click attacks. */
  function bothClickAttacks(def: ModeDefinition, target: PlayerState): Modifier[] {
    const attacker = createInitialState(def)
    Object.assign(attacker.upgrades, { 'a-unlock': 1, 'node-7': 1 })
    return resolveEnemyDebuffs(collectEnemyDebuffs(attacker, def), target, def)
  }

  it('resolves an authored clickIncome debuff onto the incoming click field', () => {
    const { def, state } = victim()
    const fields = bothClickAttacks(def, state).map((m) => m.field)
    expect(fields).toContain(INCOMING_CLICK_INCOME_FIELD)
    expect(fields).not.toContain('clickIncome')
  })

  // ×0.5 scales the finished 9.68; the flat −2 comes off last: 9.68 · 0.5 − 2.
  it('applies both idler click attacks as "halve, then drain 2"', () => {
    const { def, state } = victim()
    const income = computeClickIncome([
      ...collectModifiers(state, def),
      ...bothClickAttacks(def, state),
    ])
    expect(income).toBeCloseTo(9.68 * 0.5 - 2, 9) // 2.84
  })

  // Swapping the two `unlockAttack` lines on node-7 used to swing this by 41%.
  it('does not depend on the order the attacks are listed in', () => {
    const { def, state } = victim()
    const own = collectModifiers(state, def)
    const debuffs = bothClickAttacks(def, state)
    expect(computeClickIncome([...own, ...[...debuffs].reverse()])).toBeCloseTo(
      computeClickIncome([...own, ...debuffs]),
      9,
    )
    expect(computeClickIncome([...debuffs, ...own])).toBeCloseTo(
      computeClickIncome([...own, ...debuffs]),
      9,
    )
  })
})
