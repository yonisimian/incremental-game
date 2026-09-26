// Plan 42 — passive pacts: the enemy-stat catalog the pact effects read from,
// and the resolvers that turn a pact's description into concrete numbers
// against the partner. Logic tier throughout: every assertion is on a value.

import { describe, expect, it } from 'vitest'
import {
  applyGeneratorPurchase,
  applyPurchase,
  collectEnemyCostFactors,
  collectGeneratorCostFactors,
  collectPactBonuses,
  collectPactCostFactors,
  createInitialState,
  ENEMY_STAT_SCORE_KEY,
  enemyStatKeys,
  enemyStatKeysFor,
  getGeneratorCost,
  getGeneratorSellRefund,
  getModeDefinition,
  getUpgradeNextCost,
  NEUTRAL_COST_FACTORS,
  pactCostFactors,
  pactModifiers,
  pactsInForce,
  purchaseBlockReason,
  readEnemyStat,
  resolveEnemyDebuffs,
  resolveGeneratorDef,
  upgradeCostFactors,
  validateModeDefinition,
} from '../src/index.js'
import type {
  AttackDefinition,
  GeneratorDefinition,
  ModeDefinition,
  PactDefinition,
  PartnerSnapshot,
  PlayerState,
  UpgradeDefinition,
} from '../src/index.js'

// ─── Enemy stats ─────────────────────────────────────────────────────

describe('enemyStatKeys', () => {
  it('names every stat the reader understands, in dropdown order', () => {
    expect(enemyStatKeysFor(['r0', 'r1'], ['u0'], ['g0']).map((f) => f.key)).toEqual([
      'r0',
      'r0:rate',
      'r1',
      'r1:rate',
      'peakCps',
      'score',
      'upgrades',
      'generators',
      'purchases',
      'upgrade:u0',
      'generator:g0',
    ])
  })

  it('derives the idler catalog from its resources, upgrades and generators', () => {
    const mode = getModeDefinition('idler')
    const keys = enemyStatKeys(mode).map((f) => f.key)
    for (const r of mode.resources) expect(keys).toContain(r)
    for (const g of mode.generators) expect(keys).toContain(`generator:${g.id}`)
    for (const u of mode.upgrades) expect(keys).toContain(`upgrade:${u.id}`)
    expect(keys).toContain(ENEMY_STAT_SCORE_KEY)
  })

  it('labels each key for the editor', () => {
    const labels = new Map(enemyStatKeysFor(['r0'], ['u0'], ['g0']).map((f) => [f.key, f.label]))
    expect(labels.get('r0:rate')).toMatch(/rate/)
    expect(labels.get('upgrades')).toMatch(/total/i)
    expect(labels.get('generator:g0')).toMatch(/g0/)
  })
})

describe('readEnemyStat', () => {
  function snapshot(patch: Partial<PlayerState> = {}, rates: Record<string, number> = {}) {
    const state: PlayerState = {
      score: 900,
      resources: { r0: 120, r1: 30 },
      upgrades: { u0: 2, u1: 3 },
      generators: { g0: 4, g1: 5 },
      pendingAttacks: [],
      meta: { peakCps: 7 },
      ...patch,
    }
    return { state, rates } satisfies PartnerSnapshot
  }

  it('reads every key in the table', () => {
    const snap = snapshot({}, { r0: 12.5 })
    expect(readEnemyStat(snap, 'r0')).toBe(120)
    expect(readEnemyStat(snap, 'r1')).toBe(30)
    expect(readEnemyStat(snap, 'r0:rate')).toBe(12.5)
    expect(readEnemyStat(snap, 'peakCps')).toBe(7)
    expect(readEnemyStat(snap, 'score')).toBe(900)
    expect(readEnemyStat(snap, 'generator:g0')).toBe(4)
    expect(readEnemyStat(snap, 'generators')).toBe(9)
    expect(readEnemyStat(snap, 'upgrade:u1')).toBe(3)
    expect(readEnemyStat(snap, 'upgrades')).toBe(5)
  })

  // The rule that keeps two rate-mirroring pacts from feeding each other: a
  // `:rate` source reads the snapshot's pact-free figure, never anything on the
  // state (which carries no rate at all).
  it('reads a :rate key from the snapshot rates, not the state', () => {
    const snap = snapshot({ resources: { r0: 1e6 } }, { r0: 3 })
    expect(readEnemyStat(snap, 'r0:rate')).toBe(3)
    expect(readEnemyStat(snapshot({}, {}), 'r0:rate')).toBe(0)
  })

  it('reads a stat the partner has nothing under as 0', () => {
    const fresh = { state: createInitialState(getModeDefinition('idler')), rates: {} }
    expect(readEnemyStat(fresh, 'peakCps')).toBe(0)
    expect(readEnemyStat(fresh, 'generator:g0')).toBe(0)
    expect(readEnemyStat(fresh, 'generators')).toBe(0)
    expect(readEnemyStat(fresh, 'upgrade:nope')).toBe(0)
  })

  it('reads an unknown key as 0', () => {
    expect(readEnemyStat(snapshot(), 'nonsense')).toBe(0)
    expect(readEnemyStat(snapshot(), 'meta:peakCps')).toBe(0)
  })
})

// ─── Fixtures ────────────────────────────────────────────────────────
//
// A minimal two-player-shaped mode: two upgrades, two generators, one passive
// attack (for the commute test), and one pact per shape — a one-sided
// whole-scope discount, a mutual single-generator one, an effect-less mutual
// placeholder, and an active pact nothing reads yet. Prices are small and
// exact, so an off-by-a-rounding-step shows up as a failing integer.

const U_FLAT: UpgradeDefinition = {
  id: 'u-flat',
  cost: { r0: { baseCost: 100 } },
  purchaseLimit: 5,
}
const U_EXPO: UpgradeDefinition = {
  id: 'u-expo',
  cost: { r0: { baseCost: 100, scaleType: 'exponential', scaleFactor: 2 } },
  purchaseLimit: 5,
}
const G0: GeneratorDefinition = {
  id: 'g0',
  cost: { r0: { baseCost: 100, scaleType: 'exponential', scaleFactor: 2 } },
  production: { resource: 'r0', rate: 1 },
}
const G1: GeneratorDefinition = {
  id: 'g1',
  cost: { r0: { baseCost: 50 } },
  production: { resource: 'r0', rate: 1 },
}

/** Every upgrade the enemy is ahead on costs 25% less. One-sided. */
const RESEARCH: PactDefinition = {
  id: 'p-research',
  kind: 'passive',
  effects: [{ type: 'mirrorCostModifier', target: 'upgrades', costFactor: 0.75 }],
}
/** `g0` at half price and half growth while the enemy has more of them. Mutual. */
const TRADE: PactDefinition = {
  id: 'p-trade',
  kind: 'passive',
  mutual: true,
  effects: [
    { type: 'mirrorCostModifier', target: 'generator:g0', costFactor: 0.5, scalingFactor: 0.5 },
  ],
}
/** A mutual placeholder: legal, in force, worth nothing. */
const EMPTY: PactDefinition = { id: 'p-empty', kind: 'passive', mutual: true }
/** An active pact carrying a discount nothing reads until plan 44. */
const ACTIVE: PactDefinition = {
  id: 'p-active',
  kind: 'active',
  effects: [{ type: 'mirrorCostModifier', target: 'generators', costFactor: 0.5 }],
}
/** +2% r0 per enemy g0, up to +50%. Mutual. */
const ROUTE: PactDefinition = {
  id: 'p-route',
  kind: 'passive',
  mutual: true,
  effects: [
    {
      type: 'mirrorStatModifier',
      source: 'generator:g0',
      field: 'r0',
      stage: 'multiplicative',
      perUnit: 0.02,
      cap: 0.5,
    },
  ],
}
/** Each click pays +0.5 per enemy peak CPS, uncapped; plus a rate mirror. One-sided. */
const TAPS: PactDefinition = {
  id: 'p-taps',
  kind: 'passive',
  effects: [
    {
      type: 'mirrorStatModifier',
      source: 'peakCps',
      field: 'clickIncome',
      stage: 'additive',
      perUnit: 0.5,
    },
    { type: 'mirrorStatModifier', source: 'r0:rate', field: 'r0', stage: 'additive', perUnit: 0.1 },
  ],
}
/** A highlight-factor mirror: ×(1 + 0.001 per enemy score point). */
const GLOW: PactDefinition = {
  id: 'p-glow',
  kind: 'passive',
  effects: [
    {
      type: 'mirrorStatModifier',
      source: 'score',
      field: 'highlightFactor',
      stage: 'multiplicative',
      perUnit: 0.001,
    },
  ],
}
const PACTS = [RESEARCH, TRADE, EMPTY, ACTIVE, ROUTE, TAPS, GLOW]

/** Every upgrade 25% dearer — the attack the discount has to commute with. */
const TARIFF: AttackDefinition = {
  id: 'a-tariff',
  kind: 'passive',
  effects: [{ type: 'enemyCostModifier', target: 'upgrades', costFactor: 1.25 }],
}

/** The free upgrade that signs (unlocks) a pact. */
function sign(pactId: string): UpgradeDefinition {
  return {
    id: `sign-${pactId}`,
    cost: {},
    purchaseLimit: 1,
    effects: [{ type: 'unlockPact', pact: pactId }],
  }
}
/** The free upgrade that unlocks an attack. */
function arm(attackId: string): UpgradeDefinition {
  return {
    id: `arm-${attackId}`,
    cost: {},
    purchaseLimit: 1,
    effects: [{ type: 'unlockAttack', attack: attackId }],
  }
}

function makeMode(): ModeDefinition {
  const upgrades = [U_FLAT, U_EXPO, ...PACTS.map((p) => sign(p.id)), arm(TARIFF.id)]
  return {
    resources: ['r0'],
    scoreResource: 'r0',
    upgrades,
    goals: [{ type: 'timed', label: '⏱ Timed', durationSec: 30 }],
    clicksEnabled: false,
    highlightEnabled: false,
    initialResources: { r0: 0 },
    initialMeta: {},
    generators: [G0, G1],
    attacks: [TARIFF],
    pacts: PACTS,
    flavors: [
      {
        id: 'test',
        displayName: 'Test',
        themeClass: 'test',
        scoreLabel: 'Score',
        showClickStats: false,
        resources: [{ key: 'r0', displayName: 'Res', icon: '🔵' }],
        upgrades: upgrades.map((u) => ({ id: u.id, name: u.id, icon: '🔧', description: '' })),
        generators: [G0, G1].map((g) => ({ id: g.id, name: g.id, icon: '🏭' })),
        attacks: [{ id: TARIFF.id, name: TARIFF.id, icon: '💸', description: '' }],
        pacts: PACTS.map((p) => ({ id: p.id, name: p.id, icon: '🤝', description: '' })),
      },
    ],
  }
}

const MODE = makeMode()

/** A player with the given levels / copies, having signed the given pacts. */
function player(
  opts: {
    signed?: readonly string[]
    armed?: readonly string[]
    upgrades?: Record<string, number>
    generators?: Record<string, number>
    r0?: number
  } = {},
): PlayerState {
  const state = createInitialState(MODE)
  for (const id of opts.signed ?? []) state.upgrades[`sign-${id}`] = 1
  for (const id of opts.armed ?? []) state.upgrades[`arm-${id}`] = 1
  Object.assign(state.upgrades, opts.upgrades ?? {})
  Object.assign(state.generators, opts.generators ?? {})
  state.resources.r0 = opts.r0 ?? 100_000
  return state
}

/** `owner` stamped with what `partner` and the pacts grant them, as the server does. */
function stamped(owner: PlayerState, partner: PlayerState): PlayerState {
  const discounts = collectPactCostFactors(owner, partner, MODE)
  if (discounts.length > 0) owner.pactCostFactors = discounts
  const incoming = collectEnemyCostFactors(partner, MODE)
  if (incoming.length > 0) owner.incomingCostFactors = incoming
  return owner
}

const ids = (pacts: readonly PactDefinition[]) => pacts.map((p) => p.id)

// ─── pactsInForce ────────────────────────────────────────────────────

describe('pactsInForce', () => {
  it('boots as a valid mode', () => {
    expect(() => {
      validateModeDefinition('test', MODE)
    }).not.toThrow()
  })

  it('lists nothing when neither side has signed anything', () => {
    expect(pactsInForce(player(), player(), MODE)).toEqual([])
  })

  it('lists the owner’s unlocked passive pacts, in declaration order', () => {
    const owner = player({ signed: ['p-empty', 'p-research'] })
    expect(ids(pactsInForce(owner, player(), MODE))).toEqual(['p-research', 'p-empty'])
  })

  it('lists the partner’s mutual passive pacts after the owner’s, never a one-sided one', () => {
    const owner = player({ signed: ['p-research'] })
    const partner = player({ signed: ['p-trade', 'p-empty'] })
    expect(ids(pactsInForce(owner, partner, MODE))).toEqual(['p-research', 'p-trade', 'p-empty'])
    // The partner's one-sided research benefits them alone.
    expect(ids(pactsInForce(player(), player({ signed: ['p-research'] }), MODE))).toEqual([])
  })

  it('lists a pact both sides signed once', () => {
    const both = player({ signed: ['p-trade'] })
    expect(ids(pactsInForce(both, player({ signed: ['p-trade'] }), MODE))).toEqual(['p-trade'])
  })

  it('skips active pacts and locked ones', () => {
    // Signed active pact: plan 44's lifecycle, not in force here. Unsigned
    // passive pact: locked, whatever its `mutual`.
    expect(pactsInForce(player({ signed: ['p-active'] }), player(), MODE)).toEqual([])
    expect(pactsInForce(player(), player({ signed: ['p-active'] }), MODE)).toEqual([])
  })
})

// ─── collectPactCostFactors ──────────────────────────────────────────

describe('collectPactCostFactors', () => {
  it('yields nothing when no pact is in force, however far ahead the partner is', () => {
    const partner = player({ upgrades: { 'u-flat': 5 }, generators: { g0: 9 } })
    expect(collectPactCostFactors(player(), partner, MODE)).toEqual([])
  })

  it('is in force on an entity only while the partner is strictly ahead', () => {
    const owner = player({ signed: ['p-research'] })
    const factor = (ownLevel: number, theirLevel: number) =>
      collectPactCostFactors(
        player({ signed: ['p-research'], upgrades: { 'u-flat': ownLevel } }),
        player({ upgrades: { 'u-flat': theirLevel } }),
        MODE,
      )
    expect(collectPactCostFactors(owner, player(), MODE)).toEqual([])
    expect(factor(0, 1)).toEqual([
      { pact: 'p-research', scope: 'upgrade', id: 'u-flat', costFactor: 0.75 },
    ])
    expect(factor(1, 1)).toEqual([])
    expect(factor(2, 1)).toEqual([])
    expect(factor(1, 3)).toHaveLength(1)
  })

  it('expands a whole-scope target to one concrete entry per entity the partner is ahead on', () => {
    const owner = player({ signed: ['p-research'] })
    const partner = player({ upgrades: { 'u-flat': 1, 'u-expo': 2 } })
    expect(collectPactCostFactors(owner, partner, MODE)).toEqual([
      { pact: 'p-research', scope: 'upgrade', id: 'u-flat', costFactor: 0.75 },
      { pact: 'p-research', scope: 'upgrade', id: 'u-expo', costFactor: 0.75 },
    ])
    // The partner's pact-signing upgrades are upgrades too — and ones the
    // owner doesn't hold — so a whole-scope research pact discounts them as
    // well. Nothing exempts an unlock node; it is simply free here.
    const signer = player({ signed: ['p-trade'] })
    expect(collectPactCostFactors(owner, signer, MODE)).toEqual([
      { pact: 'p-research', scope: 'upgrade', id: 'sign-p-trade', costFactor: 0.75 },
    ])
  })

  it('carries both factors, tagged with the granting pact', () => {
    const owner = player({ signed: ['p-trade'] })
    const partner = player({ generators: { g0: 3, g1: 3 } })
    expect(collectPactCostFactors(owner, partner, MODE)).toEqual([
      { pact: 'p-trade', scope: 'generator', id: 'g0', costFactor: 0.5, scalingFactor: 0.5 },
    ])
  })

  it('grants a partner-held mutual pact to the owner, reading the holder’s levels', () => {
    // The owner signed nothing; the partner's trade route is mutual, so the
    // owner is discounted on the g0 the partner is ahead on.
    const owner = player({ generators: { g0: 1 } })
    const partner = player({ signed: ['p-trade'], generators: { g0: 4 } })
    expect(collectPactCostFactors(owner, partner, MODE)).toEqual([
      { pact: 'p-trade', scope: 'generator', id: 'g0', costFactor: 0.5, scalingFactor: 0.5 },
    ])
    // And nothing the other way while the partner is the one ahead.
    expect(collectPactCostFactors(partner, owner, MODE)).toEqual([])
  })

  it('ignores a signed active pact and an effect-less one', () => {
    const owner = player({ signed: ['p-active', 'p-empty'] })
    const partner = player({ generators: { g0: 3, g1: 3 } })
    expect(collectPactCostFactors(owner, partner, MODE)).toEqual([])
  })
})

// ─── The price seam ──────────────────────────────────────────────────

describe('pactCostFactors (the stamped read)', () => {
  const state = player()
  state.pactCostFactors = [
    { pact: 'p-research', scope: 'upgrade', id: 'u-flat', costFactor: 0.75 },
    { pact: 'p-trade', scope: 'generator', id: 'g0', costFactor: 0.5, scalingFactor: 0.5 },
  ]

  it('is neutral when nothing is stamped', () => {
    expect(pactCostFactors(player(), 'upgrade', 'u-flat')).toEqual(NEUTRAL_COST_FACTORS)
  })

  it('folds the entry for the named entity and no other', () => {
    expect(pactCostFactors(state, 'upgrade', 'u-flat')).toEqual({
      costFactor: 0.75,
      scalingFactor: 1,
    })
    expect(pactCostFactors(state, 'upgrade', 'u-expo')).toEqual(NEUTRAL_COST_FACTORS)
    expect(pactCostFactors(state, 'generator', 'g0')).toEqual({
      costFactor: 0.5,
      scalingFactor: 0.5,
    })
    expect(pactCostFactors(state, 'generator', 'g1')).toEqual(NEUTRAL_COST_FACTORS)
  })
})

describe('prices under a pact discount', () => {
  it('quotes and charges the discounted integer for an upgrade', () => {
    const owner = stamped(player({ signed: ['p-research'] }), player({ upgrades: { 'u-flat': 1 } }))
    const quoted = getUpgradeNextCost(U_FLAT, 0, upgradeCostFactors(owner, 'u-flat')).r0
    expect(quoted).toBe(75)
    const before = owner.resources.r0
    applyPurchase(owner, 'u-flat', MODE)
    expect(before - owner.resources.r0).toBe(quoted)
    // Level for level with the partner now: the discount is gone.
    expect(collectPactCostFactors(owner, player({ upgrades: { 'u-flat': 1 } }), MODE)).toEqual([])
  })

  it('flips affordability at exactly the discounted price', () => {
    const map = new Map(MODE.upgrades.map((u) => [u.id, u]))
    const owner = stamped(player({ signed: ['p-research'] }), player({ upgrades: { 'u-flat': 1 } }))
    owner.resources.r0 = 74
    expect(purchaseBlockReason(owner, 'u-flat', map, MODE)).toBe('unaffordable')
    owner.resources.r0 = 75
    expect(purchaseBlockReason(owner, 'u-flat', map, MODE)).toBeNull()
  })

  // Both are multiplicative factors, so an embargoed-and-mirrored item costs
  // `base × 1.25 × 0.75` on both sides of the wire with no ordering rule.
  it('commutes with an enemy inflation on the same item', () => {
    const partner = player({ armed: ['a-tariff'], upgrades: { 'u-flat': 1 } })
    const owner = stamped(player({ signed: ['p-research'] }), partner)
    expect(owner.incomingCostFactors).toEqual([{ scope: 'upgrade', costFactor: 1.25 }])
    // The partner is ahead on `u-flat` and on the attack's unlock node.
    expect(owner.pactCostFactors?.map((f) => f.id)).toEqual(['u-flat', 'arm-a-tariff'])
    const factors = upgradeCostFactors(owner, 'u-flat')
    expect(factors.costFactor).toBeCloseTo(0.9375)
    expect(getUpgradeNextCost(U_FLAT, 0, factors)).toEqual({ r0: 94 })
    // The un-mirrored upgrade still pays the full tariff.
    expect(getUpgradeNextCost(U_EXPO, 0, upgradeCostFactors(owner, 'u-expo'))).toEqual({ r0: 125 })
  })

  it('folds into the generator buy map and stays out of the sell map', () => {
    const owner = stamped(player({ signed: ['p-trade'] }), player({ generators: { g0: 2 } }))
    expect(collectGeneratorCostFactors(owner, MODE, 'buy').get('g0')).toEqual({
      costFactor: 0.5,
      scalingFactor: 0.5,
    })
    expect(collectGeneratorCostFactors(owner, MODE, 'buy').has('g1')).toBe(false)
    expect(collectGeneratorCostFactors(owner, MODE, 'sell').has('g0')).toBe(false)

    // 100 × 0.5 at copy 0; growth 1 + (2 − 1) × 0.5 = 1.5 → 75 at copy 1.
    const buy = resolveGeneratorDef(G0, owner, MODE, 'buy')
    expect(getGeneratorCost(buy, 0)).toBe(50)
    expect(getGeneratorCost(buy, 1)).toBe(75)
    const before = owner.resources.r0
    applyGeneratorPurchase(owner, 'g0', MODE)
    expect(before - owner.resources.r0).toBe(50)
    // The refund is the player's own price — a discount never inflates it.
    expect(getGeneratorSellRefund(resolveGeneratorDef(G0, owner, MODE, 'sell'), 1)).toBe(50)
  })
})

// ─── collectPactBonuses ──────────────────────────────────────────────

describe('collectPactBonuses', () => {
  const snap = (state: PlayerState, rates: Record<string, number> = {}): PartnerSnapshot => ({
    state,
    rates,
  })

  it('yields nothing when no pact is in force', () => {
    expect(collectPactBonuses(player(), snap(player({ generators: { g0: 9 } })), MODE)).toEqual([])
  })

  it('resolves a multiplicative rule to 1 + perUnit × stat, per pact', () => {
    const owner = player({ signed: ['p-route'] })
    expect(collectPactBonuses(owner, snap(player({ generators: { g0: 5 } })), MODE)).toEqual([
      { pact: 'p-route', modifiers: [{ stage: 'multiplicative', field: 'r0', value: 1.1 }] },
    ])
  })

  it('caps the bonus, not the value', () => {
    const owner = player({ signed: ['p-route'] })
    const [bonus] = collectPactBonuses(owner, snap(player({ generators: { g0: 100 } })), MODE)
    expect(bonus.modifiers).toEqual([{ stage: 'multiplicative', field: 'r0', value: 1.5 }])
  })

  it('resolves an additive rule to perUnit × stat, and drops a rule worth nothing', () => {
    const owner = player({ signed: ['p-taps'] })
    const partner = player()
    partner.meta.peakCps = 6
    // The rate rule reads the snapshot's rates — none given, so it is worth
    // nothing and is left out rather than reported as +0.
    expect(collectPactBonuses(owner, snap(partner), MODE)).toEqual([
      { pact: 'p-taps', modifiers: [{ stage: 'additive', field: 'clickIncome', value: 3 }] },
    ])
  })

  // The rule that keeps two rate-mirroring pacts a single pass: the rate read
  // is the snapshot's pact-free figure, never derived from the state.
  it('reads a :rate source off the snapshot rates', () => {
    const owner = player({ signed: ['p-taps'] })
    const partner = player({ generators: { g0: 50 } }) // would produce plenty — irrelevant
    expect(collectPactBonuses(owner, snap(partner, { r0: 20 }), MODE)).toEqual([
      { pact: 'p-taps', modifiers: [{ stage: 'additive', field: 'r0', value: 2 }] },
    ])
  })

  it('omits a pact whose every rule resolves to nothing', () => {
    const owner = player({ signed: ['p-route', 'p-taps', 'p-empty'] })
    expect(collectPactBonuses(owner, snap(player()), MODE)).toEqual([])
  })

  it('passes the virtual highlightFactor target through unresolved', () => {
    const owner = player({ signed: ['p-glow'] })
    const partner = player()
    partner.score = 250
    const [bonus] = collectPactBonuses(owner, snap(partner), MODE)
    expect(bonus.modifiers).toEqual([
      { stage: 'multiplicative', field: 'highlightFactor', value: 1.25 },
    ])
    // Resolved against the beneficiary exactly as a debuff is (see
    // `debuffedHighlightFactor`): it scales the *bonus* of their own highlight
    // and lands on whatever they hold. Nothing while released — or with no
    // highlight bonus to scale, so the bare test mode reads as neutral.
    owner.meta.highlight = 'r0'
    expect(resolveEnemyDebuffs(pactModifiers([bonus]), owner, MODE)).toEqual([])
    const glow: UpgradeDefinition = {
      id: 'u-glow',
      cost: {},
      purchaseLimit: 1,
      effects: [{ type: 'highlightMultiplier', multiplier: 2 }],
    }
    const glowMode: ModeDefinition = {
      ...MODE,
      highlightEnabled: true,
      upgrades: [...MODE.upgrades, glow],
    }
    owner.upgrades[glow.id] = 1
    // F = 2 → F' = 1 + (2 − 1) × 1.25 = 2.25, shipped as the ratio F' / F.
    expect(resolveEnemyDebuffs(pactModifiers([bonus]), owner, glowMode)).toEqual([
      { stage: 'multiplicative', field: 'r0', value: 1.125 },
    ])
    owner.meta.highlight = null
    expect(resolveEnemyDebuffs(pactModifiers([bonus]), owner, glowMode)).toEqual([])
  })

  it('grants a partner-held mutual pact to the owner, reading the holder', () => {
    // The owner signed nothing; the partner's trade route is mutual and the
    // partner has the woodcutters — so the owner gains from them.
    const partner = player({ signed: ['p-route'], generators: { g0: 10 } })
    expect(collectPactBonuses(player(), snap(partner), MODE)).toEqual([
      { pact: 'p-route', modifiers: [{ stage: 'multiplicative', field: 'r0', value: 1.2 }] },
    ])
    // And the holder gains from the owner's — none here.
    expect(collectPactBonuses(partner, snap(player()), MODE)).toEqual([])
  })

  it('flattens for the pipeline in pact order', () => {
    const owner = player({ signed: ['p-route', 'p-taps'] })
    const partner = player({ generators: { g0: 5 } })
    partner.meta.peakCps = 2
    const bonuses = collectPactBonuses(owner, snap(partner, { r0: 10 }), MODE)
    expect(pactModifiers(bonuses)).toEqual([
      { stage: 'multiplicative', field: 'r0', value: 1.1 },
      { stage: 'additive', field: 'clickIncome', value: 1 },
      { stage: 'additive', field: 'r0', value: 1 },
    ])
  })
})

// ─── Idler authoring ─────────────────────────────────────────────────

describe('the idler authors Shared research and Trade route', () => {
  const idler = getModeDefinition('idler')
  const pact = (id: string) => idler.pacts.find((p) => p.id === id)!

  it('boots with the two passive pacts carrying effects, p3 mutual', () => {
    expect(pact('p2')).toEqual({
      id: 'p2',
      kind: 'passive',
      effects: [{ type: 'mirrorCostModifier', target: 'upgrades', costFactor: 0.75 }],
    })
    expect(pact('p3')).toEqual({
      id: 'p3',
      kind: 'passive',
      mutual: true,
      effects: [
        {
          type: 'mirrorStatModifier',
          source: 'generator:g0',
          field: 'r0',
          stage: 'multiplicative',
          perUnit: 0.02,
          cap: 0.5,
        },
      ],
    })
    // The active pair stays a placeholder for plan 44.
    expect(pact('p0').effects).toBeUndefined()
    expect(pact('p1').effects).toBeUndefined()
  })

  it('resolves the trade route to +2% wood per enemy woodcutter, capped at +50%', () => {
    const sign = idler.upgrades.find((u) =>
      u.effects?.some((e) => e.type === 'unlockPact' && e.pact === 'p3'),
    )!
    const owner = createInitialState(idler)
    owner.upgrades[sign.id] = 1
    const partner = createInitialState(idler)
    partner.generators.g0 = 10
    expect(collectPactBonuses(owner, { state: partner, rates: {} }, idler)).toEqual([
      { pact: 'p3', modifiers: [{ stage: 'multiplicative', field: 'r0', value: 1.2 }] },
    ])
    partner.generators.g0 = 100
    expect(collectPactBonuses(owner, { state: partner, rates: {} }, idler)[0].modifiers).toEqual([
      { stage: 'multiplicative', field: 'r0', value: 1.5 },
    ])
  })
})
