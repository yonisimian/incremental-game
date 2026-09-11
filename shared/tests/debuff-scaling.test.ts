import { describe, expect, it } from 'vitest'
import {
  collectEnemyDebuffs,
  MIN_DEBUFF_FACTOR,
  scaleCostFactor,
  scaleDebuffValue,
} from '../src/index.js'
import type {
  AttackDefinition,
  ModeDefinition,
  PlayerState,
  UpgradeDefinition,
} from '../src/index.js'

// ─── scaleDebuffValue ────────────────────────────────────────────────
//
// The arithmetic an attack's `power` applies to a debuff. Characterized here
// because the answer is not the obvious one: "twice as strong" scales the
// distance from the stage's *neutral* point, so a ×0.9 penalty doubles to ×0.8
// and never to ×1.8 (which would turn the attack into a gift to the victim).

describe('scaleDebuffValue', () => {
  it('leaves both stages untouched at power 1', () => {
    expect(scaleDebuffValue('additive', -2, 1)).toBe(-2)
    expect(scaleDebuffValue('multiplicative', 0.9, 1)).toBe(0.9)
  })

  it('scales an additive drain by the power directly — 0 is its neutral point', () => {
    expect(scaleDebuffValue('additive', -2, 2)).toBe(-4)
    expect(scaleDebuffValue('additive', -2, 0.5)).toBe(-1)
  })

  it('scales a multiplicative factor by its distance from 1', () => {
    expect(scaleDebuffValue('multiplicative', 0.9, 2)).toBeCloseTo(0.8)
    expect(scaleDebuffValue('multiplicative', 0.9, 3)).toBeCloseTo(0.7)
  })

  it('saturates at the floor instead of zeroing the victim', () => {
    // An authored 0.9 reaches exactly 0 at power 10 — a factor of 0 deletes the
    // victim's production rather than scaling it, which is the case the authoring
    // guard refuses to allow in the first place.
    expect(scaleDebuffValue('multiplicative', 0.9, 10)).toBe(MIN_DEBUFF_FACTOR)
    expect(scaleDebuffValue('multiplicative', 0.9, 1000)).toBe(MIN_DEBUFF_FACTOR)
    expect(MIN_DEBUFF_FACTOR).toBeGreaterThan(0)
  })

  it('weakens toward neutral for a power below 1, never crossing it', () => {
    expect(scaleDebuffValue('multiplicative', 0.5, 0.5)).toBeCloseTo(0.75)
    expect(scaleDebuffValue('multiplicative', 0.5, 0)).toBe(1)
    expect(scaleDebuffValue('additive', -2, 0)).toBe(-0)
  })
})

// ─── scaleCostFactor ─────────────────────────────────────────────────

describe('scaleCostFactor', () => {
  it('scales the growth portion, not the whole factor', () => {
    // 1 + (1.25 - 1) × 2 = 1.5, not 1.25 × 2.
    expect(scaleCostFactor(1.25, 2)).toBeCloseTo(1.5)
    expect(scaleCostFactor(2, 3)).toBe(4)
  })

  it('is a no-op at power 1', () => {
    expect(scaleCostFactor(1.25, 1)).toBe(1.25)
  })

  it('floors at 1, so a weakened tariff never becomes a discount', () => {
    expect(scaleCostFactor(1.5, 0)).toBe(1)
    expect(scaleCostFactor(1.5, 0.5)).toBe(1.25)
  })
})

// ─── collectEnemyDebuffs × attackStat ────────────────────────────────

const DEBUFF_ATTACK: AttackDefinition = {
  id: 'a0',
  kind: 'passive',
  effects: [
    { type: 'enemyProductionModifier', stage: 'multiplicative', field: 'r0', value: 0.9 },
    { type: 'enemyProductionModifier', stage: 'additive', field: 'clickIncome', value: -2 },
  ],
}

const UNLOCK_A0: UpgradeDefinition = {
  id: 'unlock-a0',
  cost: { r0: { baseCost: 0 } },
  purchaseLimit: 1,
  effects: [{ type: 'unlockAttack', attack: 'a0' }],
}

/** Doubles a0's debuff strength per level. */
const A0_POWER: UpgradeDefinition = {
  id: 'a0-power',
  cost: { r0: { baseCost: 0 } },
  purchaseLimit: 3,
  effects: [{ type: 'attackStat', attack: 'a0', stat: 'power', op: 'mult', value: 2 }],
}

const UPGRADES = [UNLOCK_A0, A0_POWER]

function makeMode(): ModeDefinition {
  return {
    resources: ['r0'],
    scoreResource: 'r0',
    upgrades: UPGRADES,
    goals: [{ type: 'timed', label: '⏱ Timed', durationSec: 30 }],
    clicksEnabled: true,
    highlightEnabled: false,
    initialResources: { r0: 0 },
    initialMeta: {},
    generators: [],
    attacks: [DEBUFF_ATTACK],
    pacts: [],
    flavors: [
      {
        id: 'test',
        displayName: 'Test',
        themeClass: 'test',
        scoreLabel: 'Score',
        showClickStats: false,
        resources: [{ key: 'r0', displayName: 'Res', icon: '🔵' }],
        upgrades: UPGRADES.map((u) => ({ id: u.id, name: u.id, icon: '🔧', description: '' })),
        generators: [],
        attacks: [{ id: 'a0', name: 'Blight', icon: '💥', description: '' }],
        pacts: [],
      },
    ],
  }
}

function attacker(upgrades: Record<string, number>): PlayerState {
  return { score: 0, resources: {}, upgrades, generators: {}, pendingAttacks: [], meta: {} }
}

describe('collectEnemyDebuffs — power scaling', () => {
  const mode = makeMode()

  it('emits the authored values with no stat upgrade owned', () => {
    expect(collectEnemyDebuffs(attacker({ 'unlock-a0': 1 }), mode)).toEqual([
      { stage: 'multiplicative', field: 'r0', value: 0.9 },
      { stage: 'additive', field: 'clickIncome', value: -2 },
    ])
  })

  it('scales every debuff the attack carries by the same power', () => {
    const debuffs = collectEnemyDebuffs(attacker({ 'unlock-a0': 1, 'a0-power': 1 }), mode)
    expect(debuffs[0].value).toBeCloseTo(0.8)
    expect(debuffs[1].value).toBe(-4)
  })

  it('compounds with the stat upgrade’s owned count', () => {
    // power = 2³ = 8 → the 10% factor becomes 80%, the flat drain 8× deeper.
    const debuffs = collectEnemyDebuffs(attacker({ 'unlock-a0': 1, 'a0-power': 3 }), mode)
    expect(debuffs[0].value).toBeCloseTo(0.2)
    expect(debuffs[1].value).toBe(-16)
  })

  it('keeps the stat inert while the attack itself is locked', () => {
    expect(collectEnemyDebuffs(attacker({ 'a0-power': 3 }), mode)).toEqual([])
  })
})
