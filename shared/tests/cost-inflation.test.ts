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
  MAX_ATTACK_PARAM,
  NEUTRAL_COST_FACTORS,
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

/** Friendly growth reduction: halves the growth portion of `g0`'s curve. */
const FLATTER_G0: UpgradeDefinition = {
  id: 'u-flatter-g0',
  cost: { r0: { baseCost: 0 } },
  purchaseLimit: 1,
  effects: [{ type: 'generatorCost', generator: 'g0', scalingFactor: 0.5 }],
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

/** `g0`'s growth doubled: its ×2 curve becomes ×3 (100 / 300 / 900). */
const STEEPEN_G0: AttackDefinition = {
  id: 'a-steepen-g0',
  kind: 'passive',
  effects: [{ type: 'enemyCostModifier', target: 'generator:g0', scalingFactor: 2 }],
}

/**
 * The same inflation authored on an *active* attack — a duration attack (plan
 * 37): the inflation applies for `durationSec` after the strike lands, tracked
 * as a window on the attacker. Merely *unlocking* it must inflict nothing; that
 * is the runtime guard in `collectEnemyCostFactors` which would otherwise let an
 * active attack's inflation apply for free, continuously, before it ever strikes.
 */
const ACTIVE_TARIFF: AttackDefinition = {
  id: 'a-active',
  kind: 'active',
  prepareCost: { r0: { baseCost: 10 } },
  prepareTimeSec: 1,
  durationSec: 10,
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

/** Doubles the tested inflation attacks' magnitude per level — including their inflation. */
const POWER_UP: UpgradeDefinition = {
  id: 'u-power',
  cost: { r0: { baseCost: 0 } },
  purchaseLimit: 3,
  effects: [
    { type: 'attackStat', attack: 'a-upgrades', stat: 'power', op: 'mult', value: 2 },
    { type: 'attackStat', attack: 'a-steepen', stat: 'power', op: 'mult', value: 2 },
    { type: 'attackStat', attack: 'a-active', stat: 'power', op: 'mult', value: 2 },
  ],
}

const ATTACKS = [
  TARIFF_ALL_UPGRADES,
  TARIFF_G0,
  STEEPEN_EXPO,
  STEEPEN_G0,
  ACTIVE_TARIFF,
  {
    id: 'a-purchases',
    kind: 'passive',
    effects: [{ type: 'enemyCostModifier', target: 'purchases', costFactor: 1.25 }],
  } satisfies AttackDefinition,
]
const OWN_UPGRADES = [FLAT_UPGRADE, EXPO_UPGRADE, CHEAPER_G0, FLATTER_G0, POWER_UP]

function makeMode(): ModeDefinition {
  return {
    resources: ['r0'],
    scoreResource: 'r0',
    upgrades: [...OWN_UPGRADES, ...ATTACKS.map((a) => gate(a.id))],
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
        upgrades: [...OWN_UPGRADES, ...ATTACKS.map((a) => gate(a.id))].map((u) => ({
          id: u.id,
          name: u.id,
          icon: '🔧',
          description: '',
        })),
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

  it('inflates both scopes for a `purchases` target', () => {
    const mode = makeMode()
    expect(collectEnemyCostFactors(attacker('a-purchases'), mode)).toEqual([
      { scope: 'upgrade', costFactor: 1.25 },
      { scope: 'generator', costFactor: 1.25 },
    ])
  })

  it('ignores an unlocked active attack whose window is not open', () => {
    const mode = makeMode()
    expect(collectEnemyCostFactors(attacker('a-active'), mode)).toEqual([])
  })

  it('gathers an active attack’s inflation while its window is open, and not after', () => {
    const mode = makeMode()
    // No gating upgrade owned: the strike already landed and was paid for, so
    // the window pass makes no unlock re-check.
    const state = makeState({
      meta: { gameSec: 5 },
      activeDebuffs: [{ attack: 'a-active', expiresAtSec: 15 }],
    })
    expect(collectEnemyCostFactors(state, mode)).toEqual([{ scope: 'upgrade', costFactor: 3 }])
    state.meta.gameSec = 15
    expect(collectEnemyCostFactors(state, mode)).toEqual([])
  })

  it('composes an open window with an unlocked passive attack', () => {
    const mode = makeMode()
    const state = attacker('a-upgrades')
    state.meta.gameSec = 5
    state.activeDebuffs = [{ attack: 'a-active', expiresAtSec: 15 }]
    expect(collectEnemyCostFactors(state, mode)).toEqual([
      { scope: 'upgrade', costFactor: 1.25 },
      { scope: 'upgrade', costFactor: 3 },
    ])
  })

  it('scales a window’s inflation by the attacker’s live power, as it does a passive one', () => {
    const mode = makeMode()
    const state = makeState({
      upgrades: { 'u-power': 1 },
      meta: { gameSec: 5 },
      activeDebuffs: [{ attack: 'a-active', expiresAtSec: 15 }],
    })
    // 1 + (3 − 1) × 2
    expect(collectEnemyCostFactors(state, mode)).toEqual([{ scope: 'upgrade', costFactor: 5 }])
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

  // Factors are authored `> 1`, so `1 + (f - 1) × power` can't hit the old
  // `∞ × 0 = NaN` case, but an unbounded power would still price at +∞.
  it('keeps a factor finite against a saturating power', () => {
    const mode = makeMode()
    const state = attacker('a-upgrades')
    // `2 ** 2000` overflows to Infinity while it is still being collected; the
    // power ceiling is what holds the factor finite.
    state.upgrades['u-power'] = 2000
    const [factor] = collectEnemyCostFactors(state, mode)
    expect(Number.isFinite(factor.costFactor)).toBe(true)
    expect(factor.costFactor).toBeCloseTo(1 + 0.25 * MAX_ATTACK_PARAM)
  })

  it('scales the growth portion of a factor by the attacker’s power', () => {
    const mode = makeMode()
    const state = attacker('a-upgrades')
    state.upgrades['u-power'] = 1
    // 1 + (1.25 - 1) × 2 = 1.5 — *not* 1.25 × 2, which would more than double
    // the 25% bite the author signed off on.
    const [factor] = collectEnemyCostFactors(state, mode)
    expect(factor.costFactor).toBeCloseTo(1.5)
  })

  it('scales a scalingFactor the same way', () => {
    const mode = makeMode()
    const state = attacker('a-steepen')
    state.upgrades['u-power'] = 1
    const [factor] = collectEnemyCostFactors(state, mode)
    expect(factor).toEqual({ scope: 'upgrade', id: 'u-expo', scalingFactor: 2 })
  })

  it('raises the victim’s quoted price through the scaled factor', () => {
    const mode = makeMode()
    const plain = victimOf(mode, 'a-upgrades')
    const buffedAttacker = attacker('a-upgrades')
    buffedAttacker.upgrades['u-power'] = 1
    const buffed = makeState({
      incomingCostFactors: collectEnemyCostFactors(buffedAttacker, mode),
    })
    const def = upgradeMap(mode).get('u-flat')!
    const base = getUpgradeNextCost(def, 0, upgradeCostFactors(makeState(), 'u-flat')).r0
    const inflated = getUpgradeNextCost(def, 0, upgradeCostFactors(plain, 'u-flat')).r0
    const doubled = getUpgradeNextCost(def, 0, upgradeCostFactors(buffed, 'u-flat')).r0
    expect(base).toBe(100)
    expect(inflated).toBe(125)
    expect(doubled).toBe(150)
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

  // `costFactor` means "×N at every level" on both curve shapes, so the
  // espionage line's "cost N% more" holds for linear curves too.
  it('scales a linear curve by costFactor at every level, not just its base', () => {
    const linear: UpgradeDefinition = {
      id: 'u-linear',
      cost: { r0: { baseCost: 10, scaleType: 'linear', scaleFactor: 5 } },
      purchaseLimit: Infinity,
    }
    const inflate = { costFactor: 2, scalingFactor: 1 }
    for (const level of [0, 1, 10]) {
      const authored = getUpgradeNextCost(linear, level, NEUTRAL_COST_FACTORS).r0
      expect(getUpgradeNextCost(linear, level, inflate).r0).toBe(authored * 2)
    }
    // scalingFactor steepens only the increment: 10 + 5·3·level.
    expect(getUpgradeNextCost(linear, 4, { costFactor: 1, scalingFactor: 3 }).r0).toBe(70)
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
    expect(purchaseBlockReason(victim, 'u-flat', map, mode)).toBe('unaffordable')
    victim.resources.r0 = 125
    expect(purchaseBlockReason(victim, 'u-flat', map, mode)).toBeNull()
  })

  it('is unaffected for a player nobody is attacking', () => {
    const mode = makeMode()
    const map = upgradeMap(mode)
    const victim = makeState({ resources: { r0: 100 } })
    expect(purchaseBlockReason(victim, 'u-flat', map, mode)).toBeNull()
    expect(chargedFor(mode, victim, 'u-flat')).toBe(100)
  })

  it('charges exactly the inflated quote for a generator', () => {
    const mode = makeMode()
    const victim = victimOf(mode, 'a-g0')
    const effective = resolveGeneratorDef(G0, victim, mode, 'buy')
    const quoted = getGeneratorCost(effective, 0)
    expect(quoted).toBe(200)

    const before = victim.resources.r0
    applyGeneratorPurchase(victim, 'g0', mode)
    expect(before - victim.resources.r0).toBe(quoted)
  })

  it('flips generator affordability at exactly the inflated price', () => {
    const mode = makeMode()
    const victim = victimOf(mode, 'a-g0')
    const effective = resolveGeneratorDef(G0, victim, mode, 'buy')

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
    const effective = resolveGeneratorDef(G0, victim, mode, 'buy')
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

  // The exploit this guards: a copy bought *before* the attack lands must not
  // refund at the inflated price after it — at ×4 that would pay back 200 for a
  // 100 copy, turning the attack into a gift and sell/re-buy into a money pump.
  it('never refunds more than a copy cost, even once a heavy inflation lands', () => {
    const mode = makeMode()
    const victim = makeState()
    const before = victim.resources.r0

    applyGeneratorPurchase(victim, 'g0', mode)
    victim.incomingCostFactors = [{ scope: 'generator', costFactor: 4 }]
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

// ─── Growth inflation (scalingFactor) ────────────────────────────────
//
// `scalingFactor` bends the curve rather than lifting it: the first copy/level
// keeps its authored price and every later one compounds faster. Pinned on the
// same price-agreement properties as `costFactor` above.

describe('growth inflation (scalingFactor)', () => {
  it('collects a growth-only entry without inventing a costFactor', () => {
    const mode = makeMode()
    expect(collectEnemyCostFactors(attacker('a-steepen-g0'), mode)).toEqual([
      { scope: 'generator', id: 'g0', scalingFactor: 2 },
    ])
  })

  it('keeps the first generator copy at its authored price and steepens the rest', () => {
    const mode = makeMode()
    const effective = resolveGeneratorDef(G0, victimOf(mode, 'a-steepen-g0'), mode, 'buy')
    // ×2 growth doubled → ×3: 100, 300, 900 (authored: 100, 200, 400).
    expect([0, 1, 2].map((owned) => getGeneratorCost(effective, owned))).toEqual([100, 300, 900])
  })

  it('flips generator affordability at exactly the steepened price, and charges it', () => {
    const mode = makeMode()
    const victim = victimOf(mode, 'a-steepen-g0')
    victim.generators.g0 = 1
    const effective = resolveGeneratorDef(G0, victim, mode, 'buy')

    victim.resources.r0 = 299
    expect(canAffordGenerator(victim, effective)).toBe(false)
    victim.resources.r0 = 300
    expect(canAffordGenerator(victim, effective)).toBe(true)

    applyGeneratorPurchase(victim, 'g0', mode)
    expect(victim.resources.r0).toBe(0)
    expect(victim.generators.g0).toBe(2)
  })

  it('counts buy-max copies along the steepened curve', () => {
    const mode = makeMode()
    const victim = victimOf(mode, 'a-steepen-g0')
    victim.resources.r0 = 700 // steepened: 100 + 300 = 400, +900 won't fit; authored would fit 3
    const effective = resolveGeneratorDef(G0, victim, mode, 'buy')
    expect(getMaxAffordableGeneratorCount(victim, effective)).toBe(2)
    expect(getGeneratorBulkCost(effective, 0, 2)).toBe(400)
  })

  it('flips upgrade affordability at exactly the steepened price, and charges it', () => {
    const mode = makeMode()
    const map = upgradeMap(mode)
    const victim = victimOf(mode, 'a-steepen')
    victim.upgrades['u-expo'] = 1 // level 1: authored 200, steepened 250

    victim.resources.r0 = 249
    expect(purchaseBlockReason(victim, 'u-expo', map, mode)).toBe('unaffordable')
    victim.resources.r0 = 250
    expect(purchaseBlockReason(victim, 'u-expo', map, mode)).toBeNull()
    applyPurchase(victim, 'u-expo', mode)
    expect(victim.resources.r0).toBe(0)
  })

  it('refunds along the authored curve, not the steepened one', () => {
    const mode = makeMode()
    const victim = victimOf(mode, 'a-steepen-g0')
    victim.generators.g0 = 2
    // The copy being sold is index 1: 50% of the authored 200, not of 300.
    expect(getGeneratorSellRefund(resolveGeneratorDef(G0, victim, mode, 'sell'), 2)).toBe(100)
  })

  it('cancels against a friendly growth reduction', () => {
    const mode = makeMode()
    const victim = victimOf(mode, 'a-steepen-g0')
    victim.upgrades['u-flatter-g0'] = 1
    // Own growth ×0.5, enemy ×2 → the authored curve.
    expect(collectGeneratorCostFactors(victim, mode, 'buy').get('g0')).toEqual({
      costFactor: 1,
      scalingFactor: 1,
    })
    const effective = resolveGeneratorDef(G0, victim, mode, 'buy')
    expect([0, 1, 2].map((owned) => getGeneratorCost(effective, owned))).toEqual([100, 200, 400])
  })

  it('stacks independently with a costFactor on the same generator', () => {
    const mode = makeMode()
    // Base ×2 and growth ×2 together: 200 · 3ⁿ.
    const effective = resolveGeneratorDef(G0, victimOf(mode, 'a-g0', 'a-steepen-g0'), mode, 'buy')
    expect([0, 1, 2].map((owned) => getGeneratorCost(effective, owned))).toEqual([200, 600, 1800])
  })

  it('leaves a flat cost untouched at every level', () => {
    const steep = { costFactor: 1, scalingFactor: 5 }
    for (const level of [0, 3]) {
      expect(getUpgradeNextCost(FLAT_UPGRADE, level, steep)).toEqual({ r0: 100 })
    }
  })
})

// ─── Stacking with friendly reductions ───────────────────────────────

describe('inflation composes with a friendly reduction', () => {
  it('lands on the product of the two factors', () => {
    const mode = makeMode()
    const victim = victimOf(mode, 'a-g0')
    victim.upgrades['u-cheap-g0'] = 1
    // Own ×0.5, enemy ×2 → back to the authored price.
    expect(collectGeneratorCostFactors(victim, mode, 'buy').get('g0')).toEqual({
      costFactor: 1,
      scalingFactor: 1,
    })
    expect(getGeneratorCost(resolveGeneratorDef(G0, victim, mode, 'buy'), 0)).toBe(100)
  })

  it('inflates a generator the player has no reduction for', () => {
    const mode = makeMode()
    // A whole-scope generator inflation must reach generators absent from the
    // own-factors map, which only holds those a `generatorCost` effect names.
    const victim = makeState({
      incomingCostFactors: [{ scope: 'generator', costFactor: 4 }],
    })
    expect(getGeneratorCost(resolveGeneratorDef(G0, victim, mode, 'buy'), 0)).toBe(400)
  })
})
