import { describe, expect, it } from 'vitest'
import type { ModeDefinition } from '../src/modes/types.js'
import type { AttackDefinition, PlayerState, UpgradeDefinition } from '../src/types.js'
import {
  attackBlockReason,
  collectAttackParams,
  isValidAttackActivation,
  getAttackPrepareCost,
  getAttackPrepareTimeSec,
  applyAttackActivation,
  dueAttacks,
  MAX_ATTACK_PARAM,
  NEUTRAL_ATTACK_PARAMS,
  resolveAttackStrike,
} from '../src/attacks.js'
import type { AttackParams } from '../src/attacks.js'
import { collectModifiers } from '../src/modes/index.js'
import { computePassiveRates } from '../src/modifiers/pipeline.js'
import { getGeneratorCost, isGeneratorUnlocked } from '../src/generators.js'
import { generatorBlockReason } from '../src/purchase-validation.js'

// ─── Fixtures ────────────────────────────────────────────────────────

const STEAL_ATTACK: AttackDefinition = {
  id: 'a0',
  kind: 'active',
  prepareCost: { r0: { baseCost: 1000 } },
  prepareTimeSec: 3,
  effects: [{ type: 'stealResource', resource: 'r0', fraction: 0.1 }],
}

/** The same steal, authored as a flat quantity rather than a share. */
const FLAT_STEAL_ATTACK: AttackDefinition = {
  ...STEAL_ATTACK,
  effects: [{ type: 'stealResource', resource: 'r0', amount: 200 }],
}

/** Steals half the victim's copies of `g0` (floored). */
const GEN_STEAL_ATTACK: AttackDefinition = {
  ...STEAL_ATTACK,
  effects: [{ type: 'stealGenerator', generator: 'g0', fraction: 0.5 }],
}

/** The same generator steal, authored as a flat number of copies. */
const FLAT_GEN_STEAL_ATTACK: AttackDefinition = {
  ...STEAL_ATTACK,
  effects: [{ type: 'stealGenerator', generator: 'g0', count: 3 }],
}

const PASSIVE_ATTACK: AttackDefinition = {
  id: 'a1',
  kind: 'passive',
  effects: [{ type: 'enemyProductionModifier', field: 'rate:r0', multiplier: 0.9 }],
}

const PLACEHOLDER_ATTACK: AttackDefinition = {
  id: 'a2',
  kind: 'active',
}

/** Upgrade that unlocks a0 when owned. */
const UNLOCK_A0: UpgradeDefinition = {
  id: 'unlock-a0',
  cost: { r0: { baseCost: 0 } },
  purchaseLimit: 1,
  effects: [{ type: 'unlockAttack', attack: 'a0' }],
}

const UNLOCK_A2: UpgradeDefinition = {
  id: 'unlock-a2',
  cost: { r0: { baseCost: 0 } },
  purchaseLimit: 1,
  effects: [{ type: 'unlockAttack', attack: 'a2' }],
}

/** An `attackStat` upgrade, buyable up to three times. */
function statUpgrade(id: string, params: Record<string, unknown>): UpgradeDefinition {
  return {
    id,
    cost: { r0: { baseCost: 0 } },
    purchaseLimit: 3,
    effects: [{ type: 'attackStat', ...params }],
  }
}

/** +50% to a0's magnitude per level. */
const A0_POWER_ADD = statUpgrade('a0-power-add', {
  attack: 'a0',
  stat: 'power',
  op: 'add',
  value: 0.5,
})

/** Doubles a0's magnitude per level. */
const A0_POWER_MULT = statUpgrade('a0-power-mult', {
  attack: 'a0',
  stat: 'power',
  op: 'mult',
  value: 2,
})

/** Doubles *every* attack's magnitude — no `attack` named. */
const ALL_POWER_MULT = statUpgrade('all-power-mult', { stat: 'power', op: 'mult', value: 2 })

/** Buffs a2 only, so a0 must not see it. */
const A2_POWER_MULT = statUpgrade('a2-power-mult', {
  attack: 'a2',
  stat: 'power',
  op: 'mult',
  value: 5,
})

/** Halves a0's prepare cost. */
const A0_CHEAP = statUpgrade('a0-cheap', {
  attack: 'a0',
  stat: 'prepareCost',
  op: 'mult',
  value: 0.5,
})

/**
 * Two −30%-per-level cost lines. Each is legal alone — three copies leave ×0.1 —
 * but together their adds cross zero, which is the product no schema guard can
 * see and the collector's floor must catch.
 */
const A0_CHEAP_STEP_A = statUpgrade('a0-cheap-step-a', {
  attack: 'a0',
  stat: 'prepareCost',
  op: 'add',
  value: -0.3,
})
const A0_CHEAP_STEP_B = statUpgrade('a0-cheap-step-b', {
  attack: 'a0',
  stat: 'prepareCost',
  op: 'add',
  value: -0.3,
})

/** The largest magnitude the schema accepts, for the ceiling case. */
const A0_POWER_HUGE = statUpgrade('a0-power-huge', {
  attack: 'a0',
  stat: 'power',
  op: 'mult',
  value: 1e6,
})

/** Halves a0's prepare delay. */
const A0_FAST = statUpgrade('a0-fast', {
  attack: 'a0',
  stat: 'prepareTime',
  op: 'mult',
  value: 0.5,
})

/** Takes a literal second off a0's prepare delay, per level. */
const A0_SOONER = statUpgrade('a0-sooner', {
  attack: 'a0',
  stat: 'prepareTime',
  op: 'offset',
  value: -1,
})

const STAT_UPGRADES = [
  A0_POWER_ADD,
  A0_POWER_MULT,
  ALL_POWER_MULT,
  A2_POWER_MULT,
  A0_POWER_HUGE,
  A0_CHEAP,
  A0_CHEAP_STEP_A,
  A0_CHEAP_STEP_B,
  A0_FAST,
  A0_SOONER,
]

function makeMode(): ModeDefinition {
  return {
    resources: ['r0'],
    scoreResource: 'r0',
    upgrades: [UNLOCK_A0, UNLOCK_A2, ...STAT_UPGRADES],
    goals: [{ type: 'timed', label: '⏱ Timed', durationSec: 30 }],
    clicksEnabled: false,
    highlightEnabled: false,
    initialResources: { r0: 0 },
    initialMeta: {},
    generators: [
      {
        id: 'g0',
        cost: { r0: { baseCost: 100, scaleType: 'exponential', scaleFactor: 1.5 } },
        production: { resource: 'r0', rate: 2 },
      },
    ],
    attacks: [STEAL_ATTACK, PASSIVE_ATTACK, PLACEHOLDER_ATTACK],
    pacts: [],
    flavors: [
      {
        id: 'test',
        displayName: 'Test',
        themeClass: 'test',
        scoreLabel: 'Score',
        showClickStats: false,
        resources: [{ key: 'r0', displayName: 'Res', icon: '🔵' }],
        upgrades: [UNLOCK_A0, UNLOCK_A2, ...STAT_UPGRADES].map((u) => ({
          id: u.id,
          name: u.id,
          icon: '⚙️',
          description: '',
        })),
        generators: [{ id: 'g0', name: 'Gen', icon: '🏭' }],
        attacks: [
          { id: 'a0', name: 'Steal', icon: '🪓', description: 'steal' },
          { id: 'a1', name: 'Debuff', icon: '💥', description: 'debuff' },
          { id: 'a2', name: 'Placeholder', icon: '❓', description: 'todo' },
        ],
        pacts: [],
      },
    ],
  }
}

function makeState(overrides?: Partial<PlayerState>): PlayerState {
  return {
    score: 0,
    resources: { r0: 5000 },
    upgrades: { 'unlock-a0': 1, 'unlock-a2': 1 },
    generators: {},
    pendingAttacks: [],
    meta: {},
    ...overrides,
  }
}

// ─── collectAttackParams ─────────────────────────────────────────────

describe('collectAttackParams', () => {
  const mode = makeMode()

  /** A state owning the named stat upgrades at the given levels. */
  function withStats(levels: Record<string, number>): PlayerState {
    return makeState({ upgrades: { 'unlock-a0': 1, 'unlock-a2': 1, ...levels } })
  }

  it('is neutral with no stat upgrade owned', () => {
    expect(collectAttackParams(makeState(), mode, 'a0')).toEqual(NEUTRAL_ATTACK_PARAMS)
  })

  it('scales an add linearly with the owned count', () => {
    expect(collectAttackParams(withStats({ 'a0-power-add': 1 }), mode, 'a0').power).toBe(1.5)
    expect(collectAttackParams(withStats({ 'a0-power-add': 3 }), mode, 'a0').power).toBe(2.5)
  })

  it('compounds a mult with the owned count', () => {
    expect(collectAttackParams(withStats({ 'a0-power-mult': 1 }), mode, 'a0').power).toBe(2)
    expect(collectAttackParams(withStats({ 'a0-power-mult': 3 }), mode, 'a0').power).toBe(8)
  })

  it('applies every add before any mult, so authoring order cannot matter', () => {
    // (1 + 0.5) × 2, not (1 × 2) + 0.5.
    const state = withStats({ 'a0-power-add': 1, 'a0-power-mult': 1 })
    expect(collectAttackParams(state, mode, 'a0').power).toBe(3)
  })

  it('stacks two mult upgrades', () => {
    const state = withStats({ 'a0-power-mult': 1, 'all-power-mult': 1 })
    expect(collectAttackParams(state, mode, 'a0').power).toBe(4)
  })

  it('applies a mode-level ref at owned 1, with no upgrade involved', () => {
    const modeWithStat: ModeDefinition = {
      ...mode,
      effects: [{ type: 'attackStat', attack: 'a0', stat: 'power', op: 'mult', value: 3 }],
    }
    expect(collectAttackParams(makeState(), modeWithStat, 'a0').power).toBe(3)
  })

  it('lets an attack-less ref buff every attack', () => {
    const state = withStats({ 'all-power-mult': 1 })
    expect(collectAttackParams(state, mode, 'a0').power).toBe(2)
    expect(collectAttackParams(state, mode, 'a2').power).toBe(2)
  })

  it('ignores a ref naming a different attack', () => {
    const state = withStats({ 'a2-power-mult': 1 })
    expect(collectAttackParams(state, mode, 'a0').power).toBe(1)
    expect(collectAttackParams(state, mode, 'a2').power).toBe(5)
  })

  it('keeps each stat independent', () => {
    const state = withStats({ 'a0-cheap': 1, 'a0-fast': 1 })
    expect(collectAttackParams(state, mode, 'a0')).toEqual({
      power: 1,
      prepareCost: 0.5,
      prepareTime: 0.5,
      prepareTimeOffsetSec: 0,
    })
  })

  it('floors a stacked reduction at zero, so nothing inverts', () => {
    // Each line is legal on its own (three copies leave ×0.1); together their
    // adds cross zero. The schema judges one ref at a time, so the floor is the
    // only thing standing between this and a cost that *credits* the attacker.
    const state = withStats({ 'a0-cheap-step-a': 3, 'a0-cheap-step-b': 3 })
    expect(collectAttackParams(state, mode, 'a0').prepareCost).toBe(0)
  })

  it('caps a compounded overflow at the ceiling, so no param is ever infinite', () => {
    // The schema caps one value at 1e6; nothing caps the owned count it is
    // raised to, and `Infinity` is the reading that turns into `NaN` downstream.
    const state = withStats({ 'a0-power-huge': 60 })
    expect(collectAttackParams(state, mode, 'a0').power).toBe(MAX_ATTACK_PARAM)
  })

  it('reads a NaN product as the neutral multiplier, not as a free attack', () => {
    // Unreachable by purchasing — an infinite owned count with an underflowed
    // multiplier beside it — but `Infinity × 0` is the one arithmetic that gets
    // past both bounds, and "as authored" is the only safe reading of it.
    const state = withStats({ 'a0-cheap-step-a': Infinity, 'a0-cheap': 2000 })
    expect(collectAttackParams(state, mode, 'a0').prepareCost).toBe(1)
  })

  it('collects an offset in seconds, apart from the multiplier', () => {
    const one = collectAttackParams(withStats({ 'a0-sooner': 1 }), mode, 'a0')
    expect(one.prepareTimeOffsetSec).toBe(-1)
    // The multiplier is untouched: the two ops are different currencies.
    expect(one.prepareTime).toBe(1)
    // Linear in the owned count, like `add`.
    expect(
      collectAttackParams(withStats({ 'a0-sooner': 3 }), mode, 'a0').prepareTimeOffsetSec,
    ).toBe(-3)
  })

  it('keeps an offset off an attack it does not name', () => {
    const state = withStats({ 'a0-sooner': 1 })
    expect(collectAttackParams(state, mode, 'a2').prepareTimeOffsetSec).toBe(0)
  })
})

// ─── getAttackPrepareTimeSec ─────────────────────────────────────────

describe('getAttackPrepareTimeSec', () => {
  const mode = makeMode()
  const params = (levels: Record<string, number>): AttackParams =>
    collectAttackParams(makeState({ upgrades: levels }), mode, 'a0')

  it('returns the authored delay with no stat owned', () => {
    expect(getAttackPrepareTimeSec(STEAL_ATTACK, NEUTRAL_ATTACK_PARAMS)).toBe(3)
  })

  it('takes literal seconds off for an offset', () => {
    expect(getAttackPrepareTimeSec(STEAL_ATTACK, params({ 'a0-sooner': 1 }))).toBe(2)
    expect(getAttackPrepareTimeSec(STEAL_ATTACK, params({ 'a0-sooner': 2 }))).toBe(1)
  })

  it('scales before it shifts, so the two ops cannot be reordered', () => {
    // 3s × 0.5 = 1.5s, then -1s = 0.5s. Shifting first would give 1s.
    const fasterAndSooner = params({ 'a0-fast': 1, 'a0-sooner': 1 })
    expect(getAttackPrepareTimeSec(STEAL_ATTACK, fasterAndSooner)).toBe(0.5)
  })

  it('floors at zero — an oversized offset strikes on the next tick', () => {
    expect(getAttackPrepareTimeSec(STEAL_ATTACK, params({ 'a0-sooner': 3 }))).toBe(0)
    expect(getAttackPrepareTimeSec(STEAL_ATTACK, params({ 'a0-sooner': 9 }))).toBe(0)
  })

  it('treats an attack with no authored delay as 0, offset included', () => {
    expect(getAttackPrepareTimeSec(PLACEHOLDER_ATTACK, params({ 'a0-sooner': 1 }))).toBe(0)
  })
})

// ─── getAttackPrepareCost ────────────────────────────────────────────

describe('getAttackPrepareCost', () => {
  it('evaluates each currency at level 0', () => {
    expect(getAttackPrepareCost(STEAL_ATTACK, NEUTRAL_ATTACK_PARAMS)).toEqual({ r0: 1000 })
  })

  it('returns an empty map when there is no prepareCost', () => {
    expect(getAttackPrepareCost(PLACEHOLDER_ATTACK, NEUTRAL_ATTACK_PARAMS)).toEqual({})
  })

  it('scales every currency by the prepareCost param', () => {
    const twoCurrency: AttackDefinition = {
      ...STEAL_ATTACK,
      prepareCost: { r0: { baseCost: 1000 }, r1: { baseCost: 250 } },
    }
    const params = { ...NEUTRAL_ATTACK_PARAMS, prepareCost: 0.5 }
    expect(getAttackPrepareCost(twoCurrency, params)).toEqual({ r0: 500, r1: 125 })
  })
})

// ─── attackBlockReason / isValidAttackActivation ─────────────────────

describe('attackBlockReason', () => {
  const mode = makeMode()

  it('returns null when the attack can be activated', () => {
    expect(attackBlockReason(makeState(), 'a0', mode)).toBeNull()
    expect(isValidAttackActivation(makeState(), 'a0', mode)).toBe(true)
  })

  it('returns unknown for a missing attack', () => {
    expect(attackBlockReason(makeState(), 'nope', mode)).toBe('unknown')
  })

  it('returns not-active for a passive attack', () => {
    expect(attackBlockReason(makeState(), 'a1', mode)).toBe('not-active')
  })

  it('returns locked when no owned upgrade unlocks it', () => {
    const state = makeState({ upgrades: {} })
    expect(attackBlockReason(state, 'a0', mode)).toBe('locked')
  })

  it('returns no-effects for an effect-less placeholder', () => {
    expect(attackBlockReason(makeState(), 'a2', mode)).toBe('no-effects')
  })

  it('returns already-preparing when an activation is pending', () => {
    const state = makeState({ pendingAttacks: [{ attack: 'a0', readyAtSec: 3 }] })
    expect(attackBlockReason(state, 'a0', mode)).toBe('already-preparing')
  })

  it('returns unaffordable when the prepare cost cannot be paid', () => {
    const state = makeState({ resources: { r0: 999 } })
    expect(attackBlockReason(state, 'a0', mode)).toBe('unaffordable')
    expect(isValidAttackActivation(state, 'a0', mode)).toBe(false)
  })

  it('checks affordability against the discounted price', () => {
    // 500 held is short of the authored 1000 and exactly the halved price.
    const broke = makeState({ resources: { r0: 500 } })
    expect(attackBlockReason(broke, 'a0', mode)).toBe('unaffordable')
    const discounted = makeState({
      resources: { r0: 500 },
      upgrades: { 'unlock-a0': 1, 'a0-cheap': 1 },
    })
    expect(attackBlockReason(discounted, 'a0', mode)).toBeNull()
  })
})

// ─── applyAttackActivation ───────────────────────────────────────────

describe('applyAttackActivation', () => {
  it('deducts the prepare cost and queues a pending strike', () => {
    const mode = makeMode()
    const state = makeState({ resources: { r0: 5000 }, meta: { gameSec: 10 } })
    applyAttackActivation(state, 'a0', mode)
    expect(state.resources.r0).toBe(4000)
    expect(state.pendingAttacks).toEqual([{ attack: 'a0', readyAtSec: 13 }])
  })

  it('never touches score', () => {
    const mode = makeMode()
    const state = makeState({ score: 250, resources: { r0: 5000 }, meta: { gameSec: 0 } })
    applyAttackActivation(state, 'a0', mode)
    expect(state.score).toBe(250)
  })

  it('treats a missing gameSec as 0', () => {
    const mode = makeMode()
    const state = makeState({ resources: { r0: 5000 } })
    applyAttackActivation(state, 'a0', mode)
    expect(state.pendingAttacks[0].readyAtSec).toBe(3)
  })

  it('charges the discounted cost and stamps the scaled delay', () => {
    const mode = makeMode()
    const state = makeState({
      resources: { r0: 5000 },
      upgrades: { 'unlock-a0': 1, 'a0-cheap': 1, 'a0-fast': 1 },
      meta: { gameSec: 10 },
    })
    applyAttackActivation(state, 'a0', mode)
    expect(state.resources.r0).toBe(4500)
    expect(state.pendingAttacks).toEqual([{ attack: 'a0', readyAtSec: 11.5 }])
  })

  it('freezes the delay at activation — a later stat purchase does not pull it in', () => {
    const mode = makeMode()
    const state = makeState({ resources: { r0: 5000 }, meta: { gameSec: 0 } })
    applyAttackActivation(state, 'a0', mode)
    expect(state.pendingAttacks[0].readyAtSec).toBe(3)
    state.upgrades['a0-fast'] = 1
    expect(state.pendingAttacks[0].readyAtSec).toBe(3)
    expect(dueAttacks(state, 1.5)).toEqual([])
  })
})

// ─── dueAttacks ──────────────────────────────────────────────────────

describe('dueAttacks', () => {
  const state = makeState({
    pendingAttacks: [
      { attack: 'a0', readyAtSec: 3 },
      { attack: 'a0', readyAtSec: 8 },
    ],
  })

  it('excludes attacks not yet ready', () => {
    expect(dueAttacks(state, 2)).toEqual([])
  })

  it('includes an attack exactly at its ready time', () => {
    expect(dueAttacks(state, 3)).toEqual([{ attack: 'a0', readyAtSec: 3 }])
  })

  it('returns every due attack in activation order', () => {
    expect(dueAttacks(state, 10)).toEqual([
      { attack: 'a0', readyAtSec: 3 },
      { attack: 'a0', readyAtSec: 8 },
    ])
  })
})

// ─── resolveAttackStrike ─────────────────────────────────────────────

describe('resolveAttackStrike', () => {
  it('moves a fraction of the victim resource to the attacker', () => {
    const mode = makeMode()
    const attacker = makeState({ resources: { r0: 100 } })
    const victim = makeState({ resources: { r0: 500 } })
    const results = resolveAttackStrike(attacker, victim, STEAL_ATTACK, mode)
    expect(victim.resources.r0).toBe(450)
    expect(attacker.resources.r0).toBe(150)
    expect(results).toEqual([{ kind: 'resource', resource: 'r0', amount: 50 }])
  })

  it('does not credit the attacker score', () => {
    const mode = makeMode()
    const attacker = makeState({ score: 100, resources: { r0: 0 } })
    const victim = makeState({ resources: { r0: 500 } })
    resolveAttackStrike(attacker, victim, STEAL_ATTACK, mode)
    expect(attacker.score).toBe(100)
  })

  it('steals nothing when the victim holds none', () => {
    const mode = makeMode()
    const attacker = makeState({ resources: { r0: 0 } })
    const victim = makeState({ resources: { r0: 0 } })
    expect(resolveAttackStrike(attacker, victim, STEAL_ATTACK, mode)).toEqual([])
    expect(attacker.resources.r0).toBe(0)
  })

  it('moves a flat amount when the effect authors one', () => {
    const mode = makeMode()
    const attacker = makeState({ resources: { r0: 100 } })
    const victim = makeState({ resources: { r0: 500 } })
    const results = resolveAttackStrike(attacker, victim, FLAT_STEAL_ATTACK, mode)
    expect(victim.resources.r0).toBe(300)
    expect(attacker.resources.r0).toBe(300)
    expect(results).toEqual([{ kind: 'resource', resource: 'r0', amount: 200 }])
  })

  it('caps a flat steal at what the victim holds', () => {
    const mode = makeMode()
    const attacker = makeState({ resources: { r0: 0 } })
    const victim = makeState({ resources: { r0: 50 } })
    const results = resolveAttackStrike(attacker, victim, FLAT_STEAL_ATTACK, mode)
    expect(victim.resources.r0).toBe(0)
    expect(attacker.resources.r0).toBe(50)
    expect(results).toEqual([{ kind: 'resource', resource: 'r0', amount: 50 }])
  })

  it('does not credit the attacker score for a flat steal either', () => {
    const mode = makeMode()
    const attacker = makeState({ score: 100, resources: { r0: 0 } })
    const victim = makeState({ resources: { r0: 500 } })
    resolveAttackStrike(attacker, victim, FLAT_STEAL_ATTACK, mode)
    expect(attacker.score).toBe(100)
  })

  it('scales a share steal by the attacker’s power', () => {
    const mode = makeMode()
    const attacker = makeState({ resources: { r0: 0 }, upgrades: { 'a0-power-mult': 1 } })
    const victim = makeState({ resources: { r0: 500 } })
    // 10% of the stockpile, doubled.
    const results = resolveAttackStrike(attacker, victim, STEAL_ATTACK, mode)
    expect(results).toEqual([{ kind: 'resource', resource: 'r0', amount: 100 }])
    expect(victim.resources.r0).toBe(400)
    expect(attacker.resources.r0).toBe(100)
  })

  it('scales a flat steal by the attacker’s power', () => {
    const mode = makeMode()
    const attacker = makeState({ resources: { r0: 0 }, upgrades: { 'a0-power-mult': 1 } })
    const victim = makeState({ resources: { r0: 500 } })
    const results = resolveAttackStrike(attacker, victim, FLAT_STEAL_ATTACK, mode)
    expect(results).toEqual([{ kind: 'resource', resource: 'r0', amount: 400 }])
  })

  it('takes at most the whole stockpile once a scaled share passes 1', () => {
    const mode = makeMode()
    // power = (1 + 0.5×3) × 2³ = 20, so the authored 10% asks for 200% — the
    // share saturates at "everything" rather than overdrawing.
    const attacker = makeState({
      resources: { r0: 0 },
      upgrades: { 'a0-power-add': 3, 'a0-power-mult': 3 },
    })
    const victim = makeState({ resources: { r0: 500 } })
    const results = resolveAttackStrike(attacker, victim, STEAL_ATTACK, mode)
    expect(results).toEqual([{ kind: 'resource', resource: 'r0', amount: 500 }])
    expect(victim.resources.r0).toBe(0)
  })

  it('steals nothing from a victim holding nothing', () => {
    const mode = makeMode()
    const attacker = makeState({ resources: { r0: 0 } })
    const victim = makeState({ resources: { r0: 0 } })
    // The only route to a zero-magnitude strike now that `power` cannot be
    // authored below 1: an empty stockpile, which yields no result rather than
    // an entry moving nothing.
    expect(resolveAttackStrike(attacker, victim, STEAL_ATTACK, mode)).toEqual([])
    expect(attacker.resources.r0).toBe(0)
  })

  it('rejects a steal that authors both a fraction and an amount', () => {
    const mode = makeMode()
    const attacker = makeState()
    const victim = makeState()
    const bothAttack: AttackDefinition = {
      ...STEAL_ATTACK,
      effects: [{ type: 'stealResource', resource: 'r0', fraction: 0.1, amount: 200 }],
    }
    expect(() => resolveAttackStrike(attacker, victim, bothAttack, mode)).toThrow()
    expect(victim.resources.r0).toBe(5000)
  })
})

// ─── resolveAttackStrike: generator theft ────────────────────────────

describe('resolveAttackStrike — stealGenerator', () => {
  it('moves a floored share of the victim copies to the attacker', () => {
    const mode = makeMode()
    const attacker = makeState({ generators: { g0: 1 } })
    const victim = makeState({ generators: { g0: 5 } })
    const results = resolveAttackStrike(attacker, victim, GEN_STEAL_ATTACK, mode)
    expect(victim.generators.g0).toBe(3)
    expect(attacker.generators.g0).toBe(3)
    expect(results).toEqual([{ kind: 'generator', generator: 'g0', count: 2 }])
  })

  it('steals nothing when a share rounds down to zero copies', () => {
    const mode = makeMode()
    const attacker = makeState({ generators: {} })
    const victim = makeState({ generators: { g0: 1 } })
    expect(resolveAttackStrike(attacker, victim, GEN_STEAL_ATTACK, mode)).toEqual([])
    expect(victim.generators.g0).toBe(1)
    expect(attacker.generators.g0).toBeUndefined()
  })

  it('steals nothing when the victim owns none', () => {
    const mode = makeMode()
    const attacker = makeState({ generators: {} })
    const victim = makeState({ generators: {} })
    expect(resolveAttackStrike(attacker, victim, FLAT_GEN_STEAL_ATTACK, mode)).toEqual([])
    expect(attacker.generators.g0).toBeUndefined()
  })

  it('caps a flat steal at what the victim owns', () => {
    const mode = makeMode()
    const attacker = makeState({ generators: {} })
    const victim = makeState({ generators: { g0: 2 } })
    const results = resolveAttackStrike(attacker, victim, FLAT_GEN_STEAL_ATTACK, mode)
    expect(victim.generators.g0).toBe(0)
    expect(attacker.generators.g0).toBe(2)
    expect(results).toEqual([{ kind: 'generator', generator: 'g0', count: 2 }])
  })

  it('never credits score or resources — only copies move', () => {
    const mode = makeMode()
    const attacker = makeState({ score: 100, resources: { r0: 10 }, generators: {} })
    const victim = makeState({ generators: { g0: 4 } })
    resolveAttackStrike(attacker, victim, FLAT_GEN_STEAL_ATTACK, mode)
    expect(attacker.score).toBe(100)
    expect(attacker.resources.r0).toBe(10)
  })

  it('shifts both cost curves: the victim pays less next, the attacker more', () => {
    const mode = makeMode()
    const def = mode.generators[0]
    const attacker = makeState({ generators: { g0: 1 } })
    const victim = makeState({ generators: { g0: 5 } })
    const attackerCostBefore = getGeneratorCost(def, attacker.generators.g0)
    const victimCostBefore = getGeneratorCost(def, victim.generators.g0)
    resolveAttackStrike(attacker, victim, GEN_STEAL_ATTACK, mode)
    expect(getGeneratorCost(def, attacker.generators.g0)).toBeGreaterThan(attackerCostBefore)
    expect(getGeneratorCost(def, victim.generators.g0)).toBeLessThan(victimCostBefore)
  })

  it('produces for the attacker even though they never unlocked it', () => {
    // The generator is gated by an upgrade the attacker doesn't own, so buying is
    // barred — but stolen copies still feed the pipeline (owned counts, not gates).
    const base = makeMode()
    const mode: ModeDefinition = {
      ...base,
      upgrades: [
        ...base.upgrades,
        {
          id: 'unlock-g0',
          cost: { r0: { baseCost: 0 } },
          purchaseLimit: 1,
          effects: [{ type: 'generatorUnlock', generator: 'g0' }],
        },
      ],
    }
    const attacker = makeState({ generators: {} })
    const victim = makeState({ generators: { g0: 4 } })

    resolveAttackStrike(attacker, victim, FLAT_GEN_STEAL_ATTACK, mode)

    expect(attacker.generators.g0).toBe(3)
    expect(isGeneratorUnlocked(attacker, mode.generators[0], mode)).toBe(false)
    expect(generatorBlockReason(attacker, 'g0', mode)).toBe('locked')
    // 3 stolen copies × rate 2 = +6 r0/s from a generator they can't buy.
    expect(computePassiveRates(collectModifiers(attacker, mode), mode.resources).r0).toBe(6)
  })

  it('scales a share by power, saturating at the victim’s whole holding', () => {
    const mode = makeMode()
    // 0.5 of the copies, doubled, is all of them — and no more than all of them.
    const attacker = makeState({ generators: {}, upgrades: { 'a0-power-mult': 1 } })
    const victim = makeState({ generators: { g0: 5 } })
    const results = resolveAttackStrike(attacker, victim, GEN_STEAL_ATTACK, mode)
    expect(victim.generators.g0).toBe(0)
    expect(results).toEqual([{ kind: 'generator', generator: 'g0', count: 5 }])
  })

  it('still floors a scaled flat count — copies are whole', () => {
    const mode = makeMode()
    const attacker = makeState({ generators: {}, upgrades: { 'a0-power-add': 1 } })
    const victim = makeState({ generators: { g0: 6 } })
    // 3 copies × 1.5 = 4.5 → 4.
    const results = resolveAttackStrike(attacker, victim, FLAT_GEN_STEAL_ATTACK, mode)
    expect(results).toEqual([{ kind: 'generator', generator: 'g0', count: 4 }])
    expect(victim.generators.g0).toBe(2)
  })

  it('rejects a generator steal that authors both a fraction and a count', () => {
    const mode = makeMode()
    const attacker = makeState({ generators: {} })
    const victim = makeState({ generators: { g0: 4 } })
    const bothAttack: AttackDefinition = {
      ...STEAL_ATTACK,
      effects: [{ type: 'stealGenerator', generator: 'g0', fraction: 0.5, count: 3 }],
    }
    expect(() => resolveAttackStrike(attacker, victim, bothAttack, mode)).toThrow()
    expect(victim.generators.g0).toBe(4)
  })
})
