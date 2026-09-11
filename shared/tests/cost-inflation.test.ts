import { describe, expect, it } from 'vitest'
import {
  applyGeneratorPurchase,
  applyGeneratorSell,
  applyPurchase,
  canAffordGenerator,
  collectEnemyCostFactors,
  collectGeneratorCostFactors,
  getGeneratorBulkCost,
  getGeneratorCost,
  getGeneratorSellRefund,
  getMaxAffordableGeneratorCount,
  getUpgradeNextCost,
  incomingCostFactors,
  purchaseBlockReason,
  resolveGeneratorDef,
  upgradeCostFactors,
} from '../src/index.js'
import type {
  AttackDefinition,
  EnemyCostFactor,
  GeneratorDefinition,
  ModeDefinition,
  PlayerState,
  UpgradeDefinition,
} from '../src/index.js'

// ─── Fixtures ────────────────────────────────────────────────────────
//
// A minimal two-player-shaped mode: a flat upgrade, an exponential one, a
// generator, and one passive attack per inflation shape. Prices here are small
// and exact, so an off-by-a-rounding-step shows up as a failing integer rather
// than a float comparison.

const FLAT_UPGRADE: UpgradeDefinition = {
  id: 'u-flat',
  cost: { r0: { baseCost: 100 } },
  purchaseLimit: 5,
}

const EXPO_UPGRADE: UpgradeDefinition = {
  id: 'u-expo',
  cost: { r0: { baseCost: 100, scaleType: 'exponential', scaleFactor: 2 } },
  purchaseLimit: 5,
}

/** Friendly cost reduction: halves `g0`'s base price while owned. */
const CHEAPER_G0: UpgradeDefinition = {
  id: 'u-cheap-g0',
  cost: { r0: { baseCost: 0 } },
  purchaseLimit: 1,
  effects: [{ type: 'generatorCost', generator: 'g0', costFactor: 0.5 }],
}

const G0: GeneratorDefinition = {
  id: 'g0',
  cost: { r0: { baseCost: 100, scaleType: 'exponential', scaleFactor: 2 } },
  production: { resource: 'r0', rate: 1 },
}

/** Every upgrade 25% dearer. */
const TARIFF_ALL_UPGRADES: AttackDefinition = {
  id: 'a-upgrades',
  kind: 'passive',
  effects: [{ type: 'enemyCostModifier', target: 'upgrades', costFactor: 1.25 }],
}

/** One generator at double price. */
const TARIFF_G0: AttackDefinition = {
  id: 'a-g0',
  kind: 'passive',
  effects: [{ type: 'enemyCostModifier', target: 'generator:g0', costFactor: 2 }],
}

/** One upgrade's curve made steeper, base price untouched. */
const STEEPEN_EXPO: AttackDefinition = {
  id: 'a-steepen',
  kind: 'passive',
  effects: [{ type: 'enemyCostModifier', target: 'upgrade:u-expo', scalingFactor: 1.5 }],
}

/**
 * The same inflation authored on an *active* attack. `validateModeDefinition`
 * rejects this placement (the effect declares `hosts: ['passiveAttack']`), so it
 * can never reach a real mode — it exists to pin the runtime guard in
 * `collectEnemyCostFactors`, which is what would otherwise let an active
 * attack's inflation apply for free, continuously, before it ever strikes.
 */
const ACTIVE_TARIFF: AttackDefinition = {
  id: 'a-active',
  kind: 'active',
  prepareCost: { r0: { baseCost: 10 } },
  prepareTimeSec: 1,
  effects: [{ type: 'enemyCostModifier', target: 'upgrades', costFactor: 3 }],
}

/** Upgrade unlocking the attack with the given id. */
function gate(attackId: string): UpgradeDefinition {
  return {
    id: `unlock-${attackId}`,
    cost: { r0: { baseCost: 0 } },
    purchaseLimit: 1,
    effects: [{ type: 'unlockAttack', attack: attackId }],
  }
}

const ATTACKS = [TARIFF_ALL_UPGRADES, TARIFF_G0, STEEPEN_EXPO, ACTIVE_TARIFF]

function makeMode(): ModeDefinition {
  return {
    resources: ['r0'],
    scoreResource: 'r0',
    upgrades: [FLAT_UPGRADE, EXPO_UPGRADE, CHEAPER_G0, ...ATTACKS.map((a) => gate(a.id))],
    goals: [{ type: 'timed', label: '⏱ Timed', durationSec: 30 }],
    clicksEnabled: false,
    highlightEnabled: false,
    initialResources: { r0: 0 },
    initialMeta: {},
    generators: [G0],
    attacks: ATTACKS,
    pacts: [],
    flavors: [
      {
        id: 'test',
        displayName: 'Test',
        themeClass: 'test',
        scoreLabel: 'Score',
        showClickStats: false,
        resources: [{ key: 'r0', displayName: 'Res', icon: '🔵' }],
        upgrades: [FLAT_UPGRADE, EXPO_UPGRADE, CHEAPER_G0, ...ATTACKS.map((a) => gate(a.id))].map(
          (u) => ({ id: u.id, name: u.id, icon: '🔧', description: '' }),
        ),
        generators: [{ id: 'g0', name: 'Gen', icon: '🏭' }],
        attacks: ATTACKS.map((a) => ({ id: a.id, name: a.id, icon: '💸', description: '' })),
        pacts: [],
      },
    ],
  }
}

function makeState(overrides?: Partial<PlayerState>): PlayerState {
  return {
    score: 0,
    resources: { r0: 100_000 },
    upgrades: {},
    generators: {},
    pendingAttacks: [],
    meta: {},
    ...overrides,
  }
}

/** An attacker holding the named attacks (their gating upgrades owned). */
function attacker(...attackIds: string[]): PlayerState {
  const upgrades: Record<string, number> = {}
  for (const id of attackIds) upgrades[`unlock-${id}`] = 1
  return makeState({ upgrades })
}

/** A victim already stamped with what `attacker` inflicts, as the server does. */
function victimOf(mode: ModeDefinition, ...attackIds: string[]): PlayerState {
  const incoming = collectEnemyCostFactors(attacker(...attackIds), mode)
  const state = makeState()
  if (incoming.length > 0) state.incomingCostFactors = incoming
  return state
}

const upgradeMap = (mode: ModeDefinition): Map<string, UpgradeDefinition> =>
  new Map(mode.upgrades.map((u) => [u.id, u]))

// ─── collectEnemyCostFactors ─────────────────────────────────────────

describe('collectEnemyCostFactors', () => {
  it('yields nothing when no passive attack is unlocked', () => {
    const mode = makeMode()
    expect(collectEnemyCostFactors(makeState(), mode)).toEqual([])
  })

  it('gathers a whole-scope inflation from an unlocked passive attack', () => {
    const mode = makeMode()
    expect(collectEnemyCostFactors(attacker('a-upgrades'), mode)).toEqual([
      { scope: 'upgrade', costFactor: 1.25 },
    ])
  })

  it('keeps the named entity for a single-target inflation', () => {
    const mode = makeMode()
    expect(collectEnemyCostFactors(attacker('a-g0'), mode)).toEqual([
      { scope: 'generator', id: 'g0', costFactor: 2 },
    ])
  })

  it('ignores an active attack carrying the effect', () => {
    const mode = makeMode()
    expect(collectEnemyCostFactors(attacker('a-active'), mode)).toEqual([])
  })

  it('gathers one entry per unlocked attack, uncompounded by owned count', () => {
    const mode = makeMode()
    const state = attacker('a-upgrades', 'a-g0')
    // An attack is unlocked or it isn't — a second level of its gating upgrade
    // must not double the inflation.
    state.upgrades['unlock-a-upgrades'] = 3
    expect(collectEnemyCostFactors(state, mode)).toEqual([
      { scope: 'upgrade', costFactor: 1.25 },
      { scope: 'generator', id: 'g0', costFactor: 2 },
    ])
  })
})

// ─── incomingCostFactors ─────────────────────────────────────────────

describe('incomingCostFactors', () => {
  const factors: EnemyCostFactor[] = [
    { scope: 'upgrade', costFactor: 1.25 },
    { scope: 'upgrade', id: 'u-flat', costFactor: 2 },
    { scope: 'generator', id: 'g0', costFactor: 3 },
  ]
  const state = makeState({ incomingCostFactors: factors })

  it('is neutral when nothing is inflicted', () => {
    expect(incomingCostFactors(makeState(), 'upgrade', 'u-flat')).toEqual({
      costFactor: 1,
      scalingFactor: 1,
    })
  })

  it('compounds a whole-scope entry with the entity-specific one', () => {
    expect(incomingCostFactors(state, 'upgrade', 'u-flat')).toEqual({
      costFactor: 2.5,
      scalingFactor: 1,
    })
  })

  it('applies a whole-scope entry to an unnamed entity of that scope', () => {
    expect(incomingCostFactors(state, 'upgrade', 'u-expo')).toEqual({
      costFactor: 1.25,
      scalingFactor: 1,
    })
  })

  it('keeps scopes apart', () => {
    // The upgrade entries don't reach a generator, and vice versa.
    expect(incomingCostFactors(state, 'generator', 'g0')).toEqual({
      costFactor: 3,
      scalingFactor: 1,
    })
    expect(incomingCostFactors(state, 'generator', 'g1')).toEqual({
      costFactor: 1,
      scalingFactor: 1,
    })
  })
})

// ─── Upgrade prices ──────────────────────────────────────────────────

describe('upgrade prices under inflation', () => {
  it('inflates every upgrade for a whole-scope attack', () => {
    const mode = makeMode()
    const victim = victimOf(mode, 'a-upgrades')
    expect(getUpgradeNextCost(FLAT_UPGRADE, 0, upgradeCostFactors(victim, 'u-flat'))).toEqual({
      r0: 125,
    })
    expect(getUpgradeNextCost(EXPO_UPGRADE, 1, upgradeCostFactors(victim, 'u-expo'))).toEqual({
      r0: 250,
    })
  })

  // The base price is untouched; only the growth compounds — which is why the
  // two knobs are reported as separate sentences in the UI.
  it('steepens only the curve for a scaling-only attack', () => {
    const mode = makeMode()
    const factors = upgradeCostFactors(victimOf(mode, 'a-steepen'), 'u-expo')
    // scaleFactor 2 → 1 + (2-1)*1.5 = 2.5
    expect(getUpgradeNextCost(EXPO_UPGRADE, 0, factors)).toEqual({ r0: 100 })
    expect(getUpgradeNextCost(EXPO_UPGRADE, 1, factors)).toEqual({ r0: 250 })
    expect(getUpgradeNextCost(EXPO_UPGRADE, 2, factors)).toEqual({ r0: 625 })
  })

  it('leaves an upgrade the attack doesn’t name alone', () => {
    const mode = makeMode()
    const victim = victimOf(mode, 'a-steepen')
    expect(getUpgradeNextCost(FLAT_UPGRADE, 0, upgradeCostFactors(victim, 'u-flat'))).toEqual({
      r0: 100,
    })
  })
})

// ─── The client/server price-agreement invariant ─────────────────────
//
// The property that actually protects this feature: the price validation
// requires, the price a purchase deducts, and the price a caller quotes are one
// number. A disagreement is not cosmetic — it's a rejected purchase and a
// flickering optimistic buy.

describe('validated price === charged price', () => {
  function chargedFor(mode: ModeDefinition, victim: PlayerState, upgradeId: string): number {
    const before = victim.resources.r0
    applyPurchase(victim, upgradeId, mode)
    return before - victim.resources.r0
  }

  it('charges exactly the inflated quote for an upgrade', () => {
    const mode = makeMode()
    const victim = victimOf(mode, 'a-upgrades')
    const quoted = getUpgradeNextCost(FLAT_UPGRADE, 0, upgradeCostFactors(victim, 'u-flat')).r0
    expect(quoted).toBe(125)
    expect(chargedFor(mode, victim, 'u-flat')).toBe(quoted)
  })

  it('flips affordability at exactly the inflated price', () => {
    const mode = makeMode()
    const map = upgradeMap(mode)
    const victim = victimOf(mode, 'a-upgrades')

    victim.resources.r0 = 124
    expect(purchaseBlockReason(victim, 'u-flat', map)).toBe('unaffordable')
    victim.resources.r0 = 125
    expect(purchaseBlockReason(victim, 'u-flat', map)).toBeNull()
  })

  it('is unaffected for a player nobody is attacking', () => {
    const mode = makeMode()
    const map = upgradeMap(mode)
    const victim = makeState({ resources: { r0: 100 } })
    expect(purchaseBlockReason(victim, 'u-flat', map)).toBeNull()
    expect(chargedFor(mode, victim, 'u-flat')).toBe(100)
  })

  it('charges exactly the inflated quote for a generator', () => {
    const mode = makeMode()
    const victim = victimOf(mode, 'a-g0')
    const effective = resolveGeneratorDef(G0, victim, mode)
    const quoted = getGeneratorCost(effective, 0)
    expect(quoted).toBe(200)

    const before = victim.resources.r0
    applyGeneratorPurchase(victim, 'g0', mode)
    expect(before - victim.resources.r0).toBe(quoted)
  })

  it('flips generator affordability at exactly the inflated price', () => {
    const mode = makeMode()
    const victim = victimOf(mode, 'a-g0')
    const effective = resolveGeneratorDef(G0, victim, mode)

    victim.resources.r0 = 199
    expect(canAffordGenerator(victim, effective)).toBe(false)
    victim.resources.r0 = 200
    expect(canAffordGenerator(victim, effective)).toBe(true)
  })

  // A bulk buy priced at the base curve would be rejected wholesale by the
  // server, so buy-max has to count copies at the inflated price.
  it('counts buy-max copies at the inflated price', () => {
    const mode = makeMode()
    const victim = victimOf(mode, 'a-g0')
    victim.resources.r0 = 600 // 200 + 400 inflated = 600; base curve would fit 3 (100+200+400=700)
    const effective = resolveGeneratorDef(G0, victim, mode)
    expect(getMaxAffordableGeneratorCount(victim, effective)).toBe(2)
    expect(getGeneratorBulkCost(effective, 0, 2)).toBe(600)
  })
})

// ─── Refunds are not inflated ────────────────────────────────────────

describe('sell refund ignores enemy inflation', () => {
  it('refunds the player’s own price, not the inflated one', () => {
    const mode = makeMode()
    const victim = victimOf(mode, 'a-g0')
    victim.generators.g0 = 1

    const sellDef = resolveGeneratorDef(G0, victim, mode, 'sell')
    expect(getGeneratorSellRefund(sellDef, 1)).toBe(50) // 50% of the *base* 100

    const before = victim.resources.r0
    applyGeneratorSell(victim, 'g0', mode)
    expect(victim.resources.r0 - before).toBe(50)
  })

  // The exploit this guards: at ×2 or more an inflated refund would exceed what
  // the copy cost, making the attack a gift and a sell/re-buy a money pump.
  it('makes a buy-then-sell round trip strictly lossy under a heavy inflation', () => {
    const mode = makeMode()
    const victim = victimOf(mode, 'a-g0')
    const before = victim.resources.r0

    applyGeneratorPurchase(victim, 'g0', mode)
    applyGeneratorSell(victim, 'g0', mode)

    expect(victim.resources.r0).toBeLessThan(before)
    expect(victim.generators.g0).toBe(0)
  })

  it('still refunds a friendly reduction’s lower price', () => {
    const mode = makeMode()
    const victim = victimOf(mode, 'a-g0')
    victim.upgrades['u-cheap-g0'] = 1
    victim.generators.g0 = 1
    // Own ×0.5 applies to the refund; the enemy's ×2 does not.
    const sellDef = resolveGeneratorDef(G0, victim, mode, 'sell')
    expect(getGeneratorSellRefund(sellDef, 1)).toBe(25)
  })
})

// ─── Stacking with friendly reductions ───────────────────────────────

describe('inflation composes with a friendly reduction', () => {
  it('lands on the product of the two factors', () => {
    const mode = makeMode()
    const victim = victimOf(mode, 'a-g0')
    victim.upgrades['u-cheap-g0'] = 1
    // Own ×0.5, enemy ×2 → back to the authored price.
    expect(collectGeneratorCostFactors(victim, mode).get('g0')).toEqual({
      costFactor: 1,
      scalingFactor: 1,
    })
    expect(getGeneratorCost(resolveGeneratorDef(G0, victim, mode), 0)).toBe(100)
  })

  it('inflates a generator the player has no reduction for', () => {
    const mode = makeMode()
    // A whole-scope generator inflation must reach generators absent from the
    // own-factors map, which only holds those a `generatorCost` effect names.
    const victim = makeState({
      incomingCostFactors: [{ scope: 'generator', costFactor: 4 }],
    })
    expect(getGeneratorCost(resolveGeneratorDef(G0, victim, mode), 0)).toBe(400)
  })
})
