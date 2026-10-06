// Passive pacts: the enemy-stat catalog the pact effects read from,
// and the resolvers that turn a pact's description into concrete numbers
// against the partner. Logic tier throughout: every assertion is on a value.

import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  activePactExpiresAtSec,
  applyGeneratorPurchase,
  applyPactActivation,
  applyPurchase,
  collectEnemyCostFactors,
  collectGeneratorCostFactors,
  collectPactBonuses,
  collectPactCostFactors,
  collectPartnerAutoClicks,
  createInitialState,
  ENEMY_STAT_SCORE_KEY,
  enemyStatKeys,
  enemyStatKeysFor,
  getGeneratorCost,
  getGeneratorSellRefund,
  getModeDefinition,
  getPactActivationCost,
  hasPactSlotsFor,
  isPactKindCapped,
  pactLimit,
  pactSlotsHeld,
  getUpgradeNextCost,
  isValidPactActivation,
  NEUTRAL_COST_FACTORS,
  pactCostFactors,
  openPactWindows,
  pactBlockReason,
  pactModifiers,
  pactsInForce,
  purchaseBlockReason,
  readEnemyStat,
  registerEffect,
  resolveEnemyDebuffs,
  resolveGeneratorDef,
  sharedPacts,
  sharedPactWindows,
  sweepPactWindows,
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
// placeholder, and an effect-less active placeholder. Prices are small and
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
/** An active placeholder: legal, but never in force until active pacts have a lifecycle. */
const ACTIVE: PactDefinition = { id: 'p-active', kind: 'active' }
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

  it('skips a signed active pact with no open window, and locked ones', () => {
    // Signed active pact: in force only while activated. Unsigned passive pact:
    // locked, whatever its `mutual`.
    expect(pactsInForce(player({ signed: ['p-active'] }), player(), MODE)).toEqual([])
    expect(pactsInForce(player(), player({ signed: ['p-active'] }), MODE)).toEqual([])
  })
})

// ─── Activation ──────────────────────────────────────────────────────

describe('active pact activation', () => {
  /** An active pact carrying an effect: 300 r0, in force 15s, resting 45s after. */
  const ACCORD: PactDefinition = {
    id: 'p-accord',
    kind: 'active',
    activationCost: { r0: { baseCost: 300 } },
    durationSec: 15,
    cooldownSec: 45,
    effects: [
      { type: 'mirrorStatModifier', source: 'r0', field: 'r0', stage: 'additive', perUnit: 1 },
    ],
  }
  /** The same pact with no cooldown. */
  const QUICK: PactDefinition = { ...ACCORD, id: 'p-quick', cooldownSec: undefined }
  const mode: ModeDefinition = {
    ...MODE,
    upgrades: [...MODE.upgrades, sign(ACCORD.id), sign(QUICK.id)],
    pacts: [...MODE.pacts, ACCORD, QUICK],
  }

  /** A player at `gameSec` who has signed the given pacts and holds `r0`. */
  function signer(gameSec: number, patch: Partial<PlayerState> = {}, r0 = 1000): PlayerState {
    const state = createInitialState(mode)
    state.upgrades[`sign-${ACCORD.id}`] = 1
    state.upgrades[`sign-${QUICK.id}`] = 1
    state.resources.r0 = r0
    state.meta.gameSec = gameSec
    return Object.assign(state, patch)
  }

  it('prices the activation at level 0', () => {
    expect(getPactActivationCost(ACCORD)).toEqual({ r0: 300 })
    expect(getPactActivationCost({ id: 'x', kind: 'active' })).toEqual({})
  })

  describe('pactBlockReason', () => {
    it('allows a signed, affordable, resting-free active pact', () => {
      expect(pactBlockReason(signer(0), ACCORD.id, mode)).toBeNull()
      expect(isValidPactActivation(signer(0), ACCORD.id, mode)).toBe(true)
    })

    it('names each permanent reason, in order', () => {
      expect(pactBlockReason(signer(0), 'nope', mode)).toBe('unknown')
      expect(pactBlockReason(player({ signed: ['p-trade'] }), 'p-trade', mode)).toBe('not-active')
      expect(pactBlockReason(createInitialState(mode), ACCORD.id, mode)).toBe('locked')
      expect(pactBlockReason(player({ signed: ['p-active'] }), 'p-active', mode)).toBe('no-effects')
    })

    it('is already-active while the window is open, then cooling-down, then free', () => {
      const state = signer(10, {
        activePacts: [{ pact: ACCORD.id, expiresAtSec: 25 }],
        cooldowns: [{ kind: 'pact', id: ACCORD.id, untilSec: 70 }],
      })
      expect(pactBlockReason(state, ACCORD.id, mode)).toBe('already-active')
      state.meta.gameSec = 25
      expect(pactBlockReason(state, ACCORD.id, mode)).toBe('cooling-down')
      state.meta.gameSec = 70
      expect(pactBlockReason(state, ACCORD.id, mode)).toBeNull()
    })

    it('refuses while cooling down however rich the signer is, and ignores an attack cooldown', () => {
      const cooling = signer(0, { cooldowns: [{ kind: 'pact', id: ACCORD.id, untilSec: 9 }] }, 1e9)
      expect(pactBlockReason(cooling, ACCORD.id, mode)).toBe('cooling-down')
      const attackRest = signer(0, { cooldowns: [{ kind: 'attack', id: ACCORD.id, untilSec: 9 }] })
      expect(pactBlockReason(attackRest, ACCORD.id, mode)).toBeNull()
    })

    it('is unaffordable short of the activation cost', () => {
      expect(pactBlockReason(signer(0, {}, 299), ACCORD.id, mode)).toBe('unaffordable')
    })
  })

  describe('applyPactActivation', () => {
    it('pays, opens the window, and stamps the cooldown behind it', () => {
      const state = signer(10)
      applyPactActivation(state, ACCORD.id, mode)
      expect(state.resources.r0).toBe(700)
      expect(state.score).toBe(0)
      expect(state.activePacts).toEqual([{ pact: ACCORD.id, expiresAtSec: 25 }])
      expect(state.cooldowns).toEqual([{ kind: 'pact', id: ACCORD.id, untilSec: 70 }])
      expect(activePactExpiresAtSec(state, ACCORD.id)).toBe(25)
    })

    it('stamps no cooldown for a pact without one', () => {
      const state = signer(0)
      applyPactActivation(state, QUICK.id, mode)
      expect(state.activePacts).toEqual([{ pact: QUICK.id, expiresAtSec: 15 }])
      expect(state).not.toHaveProperty('cooldowns')
    })

    it('replaces a closed window of the same pact rather than listing it twice', () => {
      const state = signer(30, { activePacts: [{ pact: QUICK.id, expiresAtSec: 15 }] })
      applyPactActivation(state, QUICK.id, mode)
      expect(state.activePacts).toEqual([{ pact: QUICK.id, expiresAtSec: 45 }])
    })
  })

  it('reads a closed window as null before the sweep, and the sweep keeps only open ones', () => {
    const state = signer(25, {
      activePacts: [
        { pact: ACCORD.id, expiresAtSec: 25 },
        { pact: QUICK.id, expiresAtSec: 30 },
      ],
    })
    expect(activePactExpiresAtSec(state, ACCORD.id)).toBeNull()
    expect(activePactExpiresAtSec(state, QUICK.id)).toBe(30)
    expect(openPactWindows(state, 25)).toEqual([{ pact: QUICK.id, expiresAtSec: 30 }])
  })

  describe('sweepPactWindows', () => {
    it('drops the closed windows and keeps the open ones', () => {
      const state = signer(0, {
        activePacts: [
          { pact: ACCORD.id, expiresAtSec: 25 },
          { pact: QUICK.id, expiresAtSec: 30 },
        ],
      })
      sweepPactWindows(state, 25)
      expect(state.activePacts).toEqual([{ pact: QUICK.id, expiresAtSec: 30 }])
    })

    it('deletes the field once nothing is left', () => {
      const state = signer(0, { activePacts: [{ pact: ACCORD.id, expiresAtSec: 25 }] })
      sweepPactWindows(state, 26)
      expect(state).not.toHaveProperty('activePacts')
    })

    it('leaves a state with no windows untouched', () => {
      const state = signer(0)
      sweepPactWindows(state, 5)
      expect(state).not.toHaveProperty('activePacts')
    })
  })

  describe('open windows are in force', () => {
    /** The mutual twin of ACCORD. */
    const CEASEFIRE: PactDefinition = { ...ACCORD, id: 'p-ceasefire', mutual: true }
    const withMutual: ModeDefinition = { ...mode, pacts: [...mode.pacts, CEASEFIRE] }
    const open = (pact: string, gameSec: number, expiresAtSec: number): PlayerState =>
      signer(gameSec, { activePacts: [{ pact, expiresAtSec }] })

    it('lists the owner’s open window after the passive pacts, and drops it once closed', () => {
      const owner = open(ACCORD.id, 10, 25)
      owner.upgrades['sign-p-trade'] = 1
      expect(ids(pactsInForce(owner, player(), mode))).toEqual(['p-trade', ACCORD.id])
      owner.meta.gameSec = 25
      expect(ids(pactsInForce(owner, player(), mode))).toEqual(['p-trade'])
    })

    it('shares a partner’s open window only when the pact is mutual', () => {
      expect(ids(pactsInForce(player(), open(ACCORD.id, 10, 25), withMutual))).toEqual([])
      expect(ids(pactsInForce(player(), open(CEASEFIRE.id, 10, 25), withMutual))).toEqual([
        CEASEFIRE.id,
      ])
      // Judged on the partner's clock: closed for them, gone for the owner too.
      expect(pactsInForce(player(), open(CEASEFIRE.id, 25, 25), withMutual)).toEqual([])
    })

    it('lists a window both sides have open once', () => {
      const both = pactsInForce(open(CEASEFIRE.id, 10, 25), open(CEASEFIRE.id, 10, 30), withMutual)
      expect(ids(both)).toEqual([CEASEFIRE.id])
    })

    it('makes the window’s effects pay while it is open', () => {
      // ACCORD mirrors +1 r0 rate per enemy r0 held.
      const partner = { state: player({ r0: 40 }), rates: {} }
      expect(collectPactBonuses(open(ACCORD.id, 10, 25), partner, mode)).toEqual([
        { pact: ACCORD.id, modifiers: [{ stage: 'additive', field: 'r0', value: 40 }] },
      ])
      expect(collectPactBonuses(open(ACCORD.id, 25, 25), partner, mode)).toEqual([])
    })

    it('keeps a flat pactModifier verbatim, beside the mirrors, while the window is open', () => {
      const FRENZY: PactDefinition = {
        ...ACCORD,
        id: 'p-frenzy',
        effects: [
          {
            type: 'pactProductionModifier',
            stage: 'multiplicative',
            field: 'clickIncome',
            value: 2,
          },
          ...(ACCORD.effects ?? []),
        ],
      }
      const withFrenzy: ModeDefinition = { ...mode, pacts: [...mode.pacts, FRENZY] }
      const partner = { state: player({ r0: 40 }), rates: {} }
      expect(collectPactBonuses(open(FRENZY.id, 10, 25), partner, withFrenzy)).toEqual([
        {
          pact: FRENZY.id,
          modifiers: [
            { stage: 'multiplicative', field: 'clickIncome', value: 2 },
            { stage: 'additive', field: 'r0', value: 40 },
          ],
        },
      ])
      expect(collectPactBonuses(open(FRENZY.id, 25, 25), partner, withFrenzy)).toEqual([])
    })

    it('sums the auto-clicks a signer’s open windows grant the partner, and none once closed', () => {
      const gift = (id: string, clicksPerSec: number): PactDefinition => ({
        ...ACCORD,
        id,
        effects: [{ type: 'partnerAutoClick', clicksPerSec }],
      })
      const withGifts: ModeDefinition = {
        ...mode,
        pacts: [...mode.pacts, gift('p-drums', 3), gift('p-horns', 2)],
      }
      const signer = (gameSec: number) => open('p-drums', gameSec, 25)
      const both = signer(10)
      both.activePacts = [...both.activePacts!, { pact: 'p-horns', expiresAtSec: 20 }]
      expect(collectPartnerAutoClicks(both, withGifts)).toBe(5)
      both.meta.gameSec = 20
      expect(collectPartnerAutoClicks(both, withGifts)).toBe(3)
      expect(collectPartnerAutoClicks(signer(25), withGifts)).toBe(0)
      // A window without the effect grants nothing.
      expect(collectPartnerAutoClicks(open(ACCORD.id, 10, 25), withGifts)).toBe(0)
    })

    it('reveals a one-sided window that carries a gift, with its closing time', () => {
      const DRUMS: PactDefinition = {
        ...ACCORD,
        id: 'p-drums',
        effects: [{ type: 'partnerAutoClick', clicksPerSec: 3 }],
      }
      const withDrums: ModeDefinition = { ...mode, pacts: [...mode.pacts, DRUMS] }
      const signer = open(DRUMS.id, 10, 25)
      expect(sharedPacts(signer, withDrums)).toEqual([DRUMS.id])
      expect(sharedPactWindows(signer, withDrums)).toEqual([{ pact: DRUMS.id, expiresAtSec: 25 }])
      // A plain one-sided window stays hidden.
      expect(sharedPactWindows(open(ACCORD.id, 10, 25), withDrums)).toEqual([])
      // And a closed one is gone.
      expect(sharedPactWindows(open(DRUMS.id, 25, 25), withDrums)).toEqual([])
    })

    it('judges "reaches the partner" by the registry trait, not the effect name', () => {
      // A gift that is not partnerAutoClick: flagged partner-directed, nothing else.
      registerEffect('testGift', {
        schema: z.strictObject({}),
        apply: () => null,
        hosts: ['activePact'],
        partnerDirected: true,
      })
      const GIFT: PactDefinition = { ...ACCORD, id: 'p-gift', effects: [{ type: 'testGift' }] }
      const withGift: ModeDefinition = {
        ...mode,
        upgrades: [...mode.upgrades, sign(GIFT.id)],
        pacts: [...mode.pacts, GIFT],
      }
      expect(sharedPactWindows(open(GIFT.id, 10, 25), withGift)).toEqual([
        { pact: GIFT.id, expiresAtSec: 25 },
      ])
      expect(sharedPacts(open(GIFT.id, 10, 25), withGift)).toEqual([GIFT.id])

      const flavored = (def: ModeDefinition): ModeDefinition => ({
        ...def,
        flavors: def.flavors.map((f) => ({
          ...f,
          upgrades: def.upgrades.map((u) => ({
            id: u.id,
            name: u.id,
            icon: '🔧',
            description: '',
          })),
          pacts: def.pacts.map((p) => ({ id: p.id, name: p.id, icon: '🤝', description: '' })),
        })),
      })
      expect(() => {
        validateModeDefinition('test', flavored(withGift))
      }).not.toThrow()
      expect(() => {
        validateModeDefinition(
          'test',
          flavored({ ...withGift, pacts: [...mode.pacts, { ...GIFT, mutual: true }] }),
        )
      }).toThrow(/partner-directed effect 'testGift' but is mutual/)
    })

    it('reveals the partner’s open mutual windows, never a one-sided one', () => {
      expect(sharedPacts(open(CEASEFIRE.id, 10, 25), withMutual)).toEqual([CEASEFIRE.id])
      expect(sharedPacts(open(ACCORD.id, 10, 25), withMutual)).toEqual([])
    })

    it('boots with the mirror effects on an active pact', () => {
      expect(() => {
        validateModeDefinition('test', {
          ...withMutual,
          flavors: withMutual.flavors.map((f) => ({
            ...f,
            upgrades: withMutual.upgrades.map((u) => ({
              id: u.id,
              name: u.id,
              icon: '🔧',
              description: '',
            })),
            pacts: withMutual.pacts.map((p) => ({
              id: p.id,
              name: p.id,
              icon: '🤝',
              description: '',
            })),
          })),
        })
      }).not.toThrow()
    })
  })
})

// ─── Pact slots ──────────────────────────────────────────────────────

describe('pact slots', () => {
  /** One more passive pact reachable two ways, plus a raise and an unlock-and-raise node. */
  const EXTRA: PactDefinition = { id: 'p-extra', kind: 'passive' }
  const SECOND_ROUTE: UpgradeDefinition = {
    id: 'route-research',
    cost: {},
    purchaseLimit: 1,
    effects: [{ type: 'unlockPact', pact: 'p-research' }],
  }
  const RAISE: UpgradeDefinition = {
    id: 'raise',
    cost: {},
    purchaseLimit: 3,
    effects: [{ type: 'pactSlots', pactKind: 'passive', value: 1 }],
  }
  const UNLOCK_AND_RAISE: UpgradeDefinition = {
    id: 'unlock-and-raise',
    cost: {},
    purchaseLimit: 1,
    effects: [
      { type: 'unlockPact', pact: EXTRA.id },
      { type: 'pactSlots', pactKind: 'passive', value: 1 },
    ],
  }
  /** One node signing two passive pacts at once. */
  const TWO_AT_ONCE: UpgradeDefinition = {
    id: 'sign-two',
    cost: {},
    purchaseLimit: 1,
    effects: [
      { type: 'unlockPact', pact: EXTRA.id },
      { type: 'unlockPact', pact: TAPS.id },
    ],
  }
  /** MODE, capped at two passive pacts by its own grant; actives left uncapped. */
  const capped: ModeDefinition = {
    ...MODE,
    effects: [{ type: 'pactSlots', pactKind: 'passive', value: 2 }],
    upgrades: [...MODE.upgrades, SECOND_ROUTE, RAISE, UNLOCK_AND_RAISE, TWO_AT_ONCE],
    pacts: [...MODE.pacts, EXTRA],
  }
  /** `capped`, with one passive pact unlocked by the mode's starting effects. */
  const startingGlow: ModeDefinition = {
    ...capped,
    effects: [...(capped.effects ?? []), { type: 'unlockPact', pact: GLOW.id }],
  }
  const byId = (id: string) => capped.upgrades.find((u) => u.id === id)!

  it('leaves a kind no grant names uncapped', () => {
    expect(isPactKindCapped(MODE, 'passive')).toBe(false)
    expect(pactLimit(player(), MODE, 'passive')).toBe(Infinity)
    expect(isPactKindCapped(capped, 'active')).toBe(false)
    expect(pactLimit(player(), capped, 'active')).toBe(Infinity)
  })

  it('sums the base grant and every owned raise, times its level', () => {
    const state = player()
    expect(pactLimit(state, capped, 'passive')).toBe(2)
    state.upgrades.raise = 3
    expect(pactLimit(state, capped, 'passive')).toBe(5)
  })

  it('counts held pacts by kind, not by route', () => {
    const state = player({ signed: ['p-research', 'p-trade', 'p-active'] })
    state.upgrades['route-research'] = 1
    expect(pactSlotsHeld(state, capped, 'passive')).toBe(2)
    expect(pactSlotsHeld(state, capped, 'active')).toBe(1)
  })

  it('counts a pact the mode’s starting effects unlock as held', () => {
    const state = player()
    expect(pactSlotsHeld(state, capped, 'passive')).toBe(0)
    expect(pactSlotsHeld(state, startingGlow, 'passive')).toBe(1)
    // The starting pact fills one of the two slots: one sign fits, the next does not.
    expect(hasPactSlotsFor(state, byId('sign-p-research'), startingGlow)).toBe(true)
    const one = player({ signed: ['p-research'] })
    expect(hasPactSlotsFor(one, byId('sign-p-empty'), capped)).toBe(true)
    expect(hasPactSlotsFor(one, byId('sign-p-empty'), startingGlow)).toBe(false)
  })

  it('is all-or-nothing for a node signing two pacts with one slot free', () => {
    // Two free: both fit. One free: neither — a partial unlock is not representable.
    expect(hasPactSlotsFor(player(), byId('sign-two'), capped)).toBe(true)
    expect(hasPactSlotsFor(player({ signed: ['p-research'] }), byId('sign-two'), capped)).toBe(
      false,
    )
  })

  it('refuses the unlock that would exceed the budget, all the way to purchaseBlockReason', () => {
    const full = player({ signed: ['p-research', 'p-trade'] })
    expect(hasPactSlotsFor(full, byId('sign-p-empty'), capped)).toBe(false)
    const map = new Map(capped.upgrades.map((u) => [u.id, u]))
    expect(purchaseBlockReason(full, 'sign-p-empty', map, capped)).toBe('pact-slots')
    // An upgrade that unlocks nothing, and one unlocking an uncapped kind, are fine.
    expect(hasPactSlotsFor(full, byId('raise'), capped)).toBe(true)
    expect(hasPactSlotsFor(full, byId('sign-p-active'), capped)).toBe(true)
    // With room, the same unlock goes through.
    expect(hasPactSlotsFor(player({ signed: ['p-research'] }), byId('sign-p-empty'), capped)).toBe(
      true,
    )
  })

  it('charges nothing for a second route to a held pact', () => {
    const full = player({ signed: ['p-research', 'p-trade'] })
    expect(hasPactSlotsFor(full, byId('route-research'), capped)).toBe(true)
  })

  it('lets one purchase unlock a pact and grant the slot it fills', () => {
    const full = player({ signed: ['p-research', 'p-trade'] })
    expect(hasPactSlotsFor(full, byId('unlock-and-raise'), capped)).toBe(true)
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

describe('the idler’s authored pacts', () => {
  const idler = getModeDefinition('idler')
  const pact = (id: string) => idler.pacts.find((p) => p.id === id)!

  it('boots with every pact carrying effects, p1 and p3 mutual', () => {
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
    for (const p of idler.pacts) expect(p.effects?.length ?? 0).toBeGreaterThan(0)
    expect(idler.pacts.filter((p) => p.kind === 'active').map((p) => p.id)).toEqual(['drum-accord'])
    expect(pact('p1').mutual).toBe(true)
  })

  it('authors Drum Accord: clicks ×2 for 15s, 3 clicks/s to the enemy, resting 45s', () => {
    const drums = pact('drum-accord')
    expect(drums).toMatchObject({
      kind: 'active',
      activationCost: { r0: { baseCost: 300 } },
      durationSec: 15,
      cooldownSec: 45,
    })
    expect(drums.mutual).toBeUndefined()
    const signer = createInitialState(idler)
    signer.meta.gameSec = 0
    signer.activePacts = [{ pact: 'drum-accord', expiresAtSec: 15 }]
    expect(
      collectPactBonuses(signer, { state: createInitialState(idler), rates: {} }, idler),
    ).toEqual([
      {
        pact: 'drum-accord',
        modifiers: [{ stage: 'multiplicative', field: 'clickIncome', value: 2 }],
      },
    ])
    expect(collectPartnerAutoClicks(signer, idler)).toBe(3)
    // Its unlock node sits under the relations panel unlock.
    const node = idler.upgrades.find((u) =>
      u.effects?.some((e) => e.type === 'unlockPact' && e.pact === 'drum-accord'),
    )!
    expect(node.prerequisites).toEqual({ type: 'upgrade', id: 'ir-unlock' })
  })

  it('pays +2 click income per level of sh-mf-hp the partner owns, both ways', () => {
    const sign = idler.upgrades.find((u) =>
      u.effects?.some((e) => e.type === 'unlockPact' && e.pact === 'p1'),
    )!
    const signer = createInitialState(idler)
    signer.upgrades[sign.id] = 1
    const other = createInitialState(idler)
    other.upgrades['sh-mf-hp'] = 3
    const worth = [
      { pact: 'p1', modifiers: [{ stage: 'additive', field: 'clickIncome', value: 6 }] },
    ]
    expect(collectPactBonuses(signer, { state: other, rates: {} }, idler)).toEqual(worth)
    // Mutual: the side that never signed reads the signer's levels the same way.
    signer.upgrades['sh-mf-hp'] = 3
    expect(collectPactBonuses(other, { state: signer, rates: {} }, idler)).toEqual(worth)
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
