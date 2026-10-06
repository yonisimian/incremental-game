import { describe, expect, it } from 'vitest'
import type { ModeDefinition } from '../src/modes/types.js'
import type { AttackDefinition, PlayerState, UpgradeDefinition } from '../src/types.js'
import {
  activeDebuffExpiresAtSec,
  attackBlockReason,
  collectAttackParams,
  isValidAttackActivation,
  getAttackDurationSec,
  getAttackPrepareCost,
  getAttackPrepareTimeSec,
  applyAttackActivation,
  dueAttacks,
  getAttackCooldownSec,
  MAX_ATTACK_PARAM,
  NEUTRAL_ATTACK_PARAMS,
  openDebuffWindows,
  sweepDebuffWindows,
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

/** A duration attack: halves the victim's r0 for 10s after the strike. */
const DEBUFF_ATTACK: AttackDefinition = {
  id: 'a3',
  kind: 'active',
  prepareCost: { r0: { baseCost: 100 } },
  prepareTimeSec: 2,
  durationSec: 10,
  effects: [{ type: 'enemyProductionModifier', stage: 'multiplicative', field: 'r0', value: 0.5 }],
}

/** A raid: the steal *and* the debuff, sharing one window. */
const RAID_ATTACK: AttackDefinition = {
  ...DEBUFF_ATTACK,
  id: 'a4',
  effects: [
    { type: 'stealResource', resource: 'r0', fraction: 0.1 },
    { type: 'enemyProductionModifier', stage: 'multiplicative', field: 'r0', value: 0.5 },
    { type: 'enemyCostModifier', target: 'upgrades', costFactor: 2 },
  ],
}

/** The debuff attack authored without a window — invalid, and inert here. */
const WINDOWLESS_DEBUFF_ATTACK: AttackDefinition = {
  ...DEBUFF_ATTACK,
  id: 'a5',
  durationSec: undefined,
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

const UNLOCK_A3: UpgradeDefinition = {
  id: 'unlock-a3',
  cost: { r0: { baseCost: 0 } },
  purchaseLimit: 1,
  effects: [{ type: 'unlockAttack', attack: 'a3' }],
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

/** A second, independent doubling of a0's magnitude. */
const A0_POWER_MULT_B = statUpgrade('a0-power-mult-b', {
  attack: 'a0',
  stat: 'power',
  op: 'mult',
  value: 2,
})

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

/** Stretches a3's debuff window by half, per level. */
const A3_LONGER = statUpgrade('a3-longer', {
  attack: 'a3',
  stat: 'duration',
  op: 'mult',
  value: 1.5,
})

/** Adds two literal seconds to a3's window, per level. */
const A3_EXTEND = statUpgrade('a3-extend', {
  attack: 'a3',
  stat: 'duration',
  op: 'offset',
  value: 2,
})

const STAT_UPGRADES = [
  A0_POWER_ADD,
  A0_POWER_MULT,
  A0_POWER_MULT_B,
  A2_POWER_MULT,
  A0_POWER_HUGE,
  A0_CHEAP,
  A0_CHEAP_STEP_A,
  A0_CHEAP_STEP_B,
  A0_FAST,
  A0_SOONER,
  A3_LONGER,
  A3_EXTEND,
]

function makeMode(): ModeDefinition {
  return {
    resources: ['r0'],
    scoreResource: 'r0',
    upgrades: [UNLOCK_A0, UNLOCK_A2, UNLOCK_A3, ...STAT_UPGRADES],
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
    attacks: [
      STEAL_ATTACK,
      PASSIVE_ATTACK,
      PLACEHOLDER_ATTACK,
      DEBUFF_ATTACK,
      RAID_ATTACK,
      WINDOWLESS_DEBUFF_ATTACK,
    ],
    pacts: [],
    flavors: [
      {
        id: 'test',
        displayName: 'Test',
        themeClass: 'test',
        scoreLabel: 'Score',
        showClickStats: false,
        resources: [{ key: 'r0', displayName: 'Res', icon: '🔵' }],
        upgrades: [UNLOCK_A0, UNLOCK_A2, UNLOCK_A3, ...STAT_UPGRADES].map((u) => ({
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
          { id: 'a3', name: 'Blockade', icon: '⛓️', description: 'window' },
          { id: 'a4', name: 'Raid', icon: '🏴‍☠️', description: 'steal + window' },
          { id: 'a5', name: 'Windowless', icon: '🚫', description: 'invalid' },
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
    upgrades: { 'unlock-a0': 1, 'unlock-a2': 1, 'unlock-a3': 1 },
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
    const state = withStats({ 'a0-power-mult': 1, 'a0-power-mult-b': 1 })
    expect(collectAttackParams(state, mode, 'a0').power).toBe(4)
  })

  it('applies a mode-level ref at owned 1, with no upgrade involved', () => {
    const modeWithStat: ModeDefinition = {
      ...mode,
      effects: [{ type: 'attackStat', attack: 'a0', stat: 'power', op: 'mult', value: 3 }],
    }
    expect(collectAttackParams(makeState(), modeWithStat, 'a0').power).toBe(3)
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
      duration: 1,
      durationOffsetSec: 0,
      cooldown: 1,
      cooldownOffsetSec: 0,
    })
  })

  it('collects the duration stat, factor and offset apart, like prepareTime', () => {
    const state = withStats({ 'a3-longer': 2, 'a3-extend': 2 })
    const params = collectAttackParams(state, mode, 'a3')
    expect(params.duration).toBe(2.25) // 1.5 ** 2
    expect(params.durationOffsetSec).toBe(4) // +2s × 2
    // Neither leaks into the delay's pair.
    expect(params.prepareTime).toBe(1)
    expect(params.prepareTimeOffsetSec).toBe(0)
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

  it('resolves the debuff window the same way — scaled, then shifted, floored', () => {
    const at = (duration: number, durationOffsetSec: number): AttackParams => ({
      ...NEUTRAL_ATTACK_PARAMS,
      duration,
      durationOffsetSec,
    })
    expect(getAttackDurationSec(DEBUFF_ATTACK, NEUTRAL_ATTACK_PARAMS)).toBe(10)
    expect(getAttackDurationSec(DEBUFF_ATTACK, at(1.5, 0))).toBe(15)
    expect(getAttackDurationSec(DEBUFF_ATTACK, at(1, 2))).toBe(12)
    expect(getAttackDurationSec(DEBUFF_ATTACK, at(1.5, 2))).toBe(17)
    expect(getAttackDurationSec(DEBUFF_ATTACK, at(1, -20))).toBe(0)
    // No authored window: nothing to scale, whatever the stats say.
    expect(getAttackDurationSec(STEAL_ATTACK, at(3, 5))).toBe(0)
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

  it('returns already-active while the debuff window is open, and null once it closes', () => {
    const open = makeState({
      meta: { gameSec: 12 },
      activeDebuffs: [{ attack: 'a3', expiresAtSec: 15 }],
    })
    expect(attackBlockReason(open, 'a3', mode)).toBe('already-active')
    expect(isValidAttackActivation(open, 'a3', mode)).toBe(false)
    // The window closes at 15 exactly — `expiresAtSec <= gameSec` is closed.
    const closed = makeState({
      meta: { gameSec: 15 },
      activeDebuffs: [{ attack: 'a3', expiresAtSec: 15 }],
    })
    expect(attackBlockReason(closed, 'a3', mode)).toBeNull()
  })

  it('does not let one attack’s open window block a different attack', () => {
    const state = makeState({
      meta: { gameSec: 12 },
      activeDebuffs: [{ attack: 'a3', expiresAtSec: 15 }],
    })
    expect(attackBlockReason(state, 'a0', mode)).toBeNull()
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

// ─── resolveAttackStrike — debuff windows ────────────────────────────

describe('resolveAttackStrike — debuff window', () => {
  it('opens one window at gameSec + durationSec, reports it, and moves nothing', () => {
    const mode = makeMode()
    const attacker = makeState({ resources: { r0: 100 }, meta: { gameSec: 20 } })
    const victim = makeState({ resources: { r0: 500 } })
    const results = resolveAttackStrike(attacker, victim, DEBUFF_ATTACK, mode)
    expect(results).toEqual([{ kind: 'debuff', durationSec: 10 }])
    expect(attacker.activeDebuffs).toEqual([{ attack: 'a3', expiresAtSec: 30 }])
    expect(victim.resources.r0).toBe(500)
    expect(attacker.resources.r0).toBe(100)
  })

  it('scales the window by the attacker’s duration stat, frozen at the strike', () => {
    const mode = makeMode()
    const attacker = makeState({
      upgrades: { 'unlock-a3': 1, 'a3-longer': 1, 'a3-extend': 1 },
      meta: { gameSec: 0 },
    })
    const victim = makeState()
    const results = resolveAttackStrike(attacker, victim, DEBUFF_ATTACK, mode)
    // 10 × 1.5 + 2
    expect(results).toEqual([{ kind: 'debuff', durationSec: 17 }])
    expect(attacker.activeDebuffs).toEqual([{ attack: 'a3', expiresAtSec: 17 }])
  })

  it('does both on a raid — the steal lands and one window opens, however many debuff effects', () => {
    const mode = makeMode()
    const attacker = makeState({ resources: { r0: 0 }, meta: { gameSec: 5 } })
    const victim = makeState({ resources: { r0: 1000 } })
    const results = resolveAttackStrike(attacker, victim, RAID_ATTACK, mode)
    expect(results).toEqual([
      { kind: 'resource', resource: 'r0', amount: 100 },
      { kind: 'debuff', durationSec: 10 },
    ])
    expect(victim.resources.r0).toBe(900)
    expect(attacker.resources.r0).toBe(100)
    // Two debuff effects on the attack, one window.
    expect(attacker.activeDebuffs).toEqual([{ attack: 'a4', expiresAtSec: 15 }])
  })

  it('appends to windows already open from other attacks', () => {
    const mode = makeMode()
    const attacker = makeState({
      meta: { gameSec: 5 },
      activeDebuffs: [{ attack: 'a4', expiresAtSec: 8 }],
    })
    resolveAttackStrike(attacker, makeState(), DEBUFF_ATTACK, mode)
    expect(attacker.activeDebuffs).toEqual([
      { attack: 'a4', expiresAtSec: 8 },
      { attack: 'a3', expiresAtSec: 15 },
    ])
  })

  it('opens no window for a debuff attack authored without a duration', () => {
    // Boot validation rejects this authoring; the strike still has to be inert
    // rather than push a zero-length window no tick could gather.
    const mode = makeMode()
    const attacker = makeState({ meta: { gameSec: 5 } })
    expect(resolveAttackStrike(attacker, makeState(), WINDOWLESS_DEBUFF_ATTACK, mode)).toEqual([])
    expect(attacker.activeDebuffs).toBeUndefined()
  })

  it('treats a missing gameSec as 0, like activation does', () => {
    const mode = makeMode()
    const attacker = makeState()
    resolveAttackStrike(attacker, makeState(), DEBUFF_ATTACK, mode)
    expect(attacker.activeDebuffs).toEqual([{ attack: 'a3', expiresAtSec: 10 }])
  })
})

// ─── activeDebuffExpiresAtSec / openDebuffWindows ────────────────────

describe('activeDebuffExpiresAtSec', () => {
  it('is null with no windows at all', () => {
    expect(activeDebuffExpiresAtSec(makeState(), 'a3')).toBeNull()
  })

  it('reports when an open window for that attack only closes', () => {
    const state = makeState({
      meta: { gameSec: 12.5 },
      activeDebuffs: [
        { attack: 'a3', expiresAtSec: 15 },
        { attack: 'a4', expiresAtSec: 40 },
      ],
    })
    expect(activeDebuffExpiresAtSec(state, 'a3')).toBe(15)
    expect(activeDebuffExpiresAtSec(state, 'a4')).toBe(40)
    expect(activeDebuffExpiresAtSec(state, 'a0')).toBeNull()
  })

  it('reads an expired-but-unswept window as null', () => {
    const state = makeState({
      meta: { gameSec: 15 },
      activeDebuffs: [{ attack: 'a3', expiresAtSec: 15 }],
    })
    expect(activeDebuffExpiresAtSec(state, 'a3')).toBeNull()
  })
})

describe('openDebuffWindows', () => {
  it('keeps only windows that are strictly still open', () => {
    const state = makeState({
      activeDebuffs: [
        { attack: 'a3', expiresAtSec: 10 },
        { attack: 'a4', expiresAtSec: 20 },
      ],
    })
    expect(openDebuffWindows(state, 10)).toEqual([{ attack: 'a4', expiresAtSec: 20 }])
    expect(openDebuffWindows(state, 20)).toEqual([])
    expect(openDebuffWindows(state, 0)).toHaveLength(2)
    // Pure.
    expect(state.activeDebuffs).toHaveLength(2)
  })

  it('is empty when the field is absent', () => {
    expect(openDebuffWindows(makeState(), 0)).toEqual([])
  })
})

describe('sweepDebuffWindows', () => {
  it('drops the closed windows and keeps the open ones', () => {
    const state = makeState({
      activeDebuffs: [
        { attack: 'a3', expiresAtSec: 10 },
        { attack: 'a4', expiresAtSec: 20 },
      ],
    })
    sweepDebuffWindows(state, 10)
    expect(state.activeDebuffs).toEqual([{ attack: 'a4', expiresAtSec: 20 }])
  })

  it('deletes the field once nothing is left', () => {
    const state = makeState({ activeDebuffs: [{ attack: 'a3', expiresAtSec: 10 }] })
    sweepDebuffWindows(state, 11)
    expect(state).not.toHaveProperty('activeDebuffs')
  })

  it('keeps the same array when nothing closed', () => {
    const windows = [{ attack: 'a3', expiresAtSec: 10 }]
    const state = makeState({ activeDebuffs: windows })
    sweepDebuffWindows(state, 5)
    expect(state.activeDebuffs).toBe(windows)
  })

  it('leaves a state with no windows untouched', () => {
    const state = makeState()
    sweepDebuffWindows(state, 5)
    expect(state).not.toHaveProperty('activeDebuffs')
  })
})

// ─── Cooldowns ───────────────────────────────────────────────────────

describe('attack cooldown', () => {
  /** The steal (no window) and the debuff (10s window), each resting 20s. */
  const RESTING_STEAL: AttackDefinition = { ...STEAL_ATTACK, cooldownSec: 20 }
  const RESTING_DEBUFF: AttackDefinition = { ...DEBUFF_ATTACK, cooldownSec: 20 }
  const A0_REST_HALF = statUpgrade('a0-rest-half', {
    attack: 'a0',
    stat: 'cooldown',
    op: 'mult',
    value: 0.5,
  })
  const A0_REST_LESS = statUpgrade('a0-rest-less', {
    attack: 'a0',
    stat: 'cooldown',
    op: 'offset',
    value: -3,
  })

  function restingMode(): ModeDefinition {
    const base = makeMode()
    return {
      ...base,
      upgrades: [...base.upgrades, A0_REST_HALF, A0_REST_LESS],
      attacks: base.attacks.map((a) =>
        a.id === 'a0' ? RESTING_STEAL : a.id === 'a3' ? RESTING_DEBUFF : a,
      ),
    }
  }

  describe('getAttackCooldownSec', () => {
    const at = (cooldown: number, cooldownOffsetSec: number): AttackParams => ({
      ...NEUTRAL_ATTACK_PARAMS,
      cooldown,
      cooldownOffsetSec,
    })

    it('scales, then shifts, then floors at zero', () => {
      expect(getAttackCooldownSec(RESTING_STEAL, NEUTRAL_ATTACK_PARAMS)).toBe(20)
      expect(getAttackCooldownSec(RESTING_STEAL, at(0.5, 0))).toBe(10)
      expect(getAttackCooldownSec(RESTING_STEAL, at(1, -3))).toBe(17)
      // 20 × 0.5 − 3, not (20 − 3) × 0.5.
      expect(getAttackCooldownSec(RESTING_STEAL, at(0.5, -3))).toBe(7)
      expect(getAttackCooldownSec(RESTING_STEAL, at(1, -50))).toBe(0)
    })

    it('is 0 for an attack with no authored cooldown, whatever the stats say', () => {
      expect(getAttackCooldownSec(STEAL_ATTACK, at(3, 5))).toBe(0)
    })
  })

  it('collects the cooldown stat, factor and offset apart', () => {
    const state = makeState({ upgrades: { 'unlock-a0': 1, 'a0-rest-half': 2, 'a0-rest-less': 2 } })
    const params = collectAttackParams(state, restingMode(), 'a0')
    expect(params.cooldown).toBe(0.25) // 0.5 ** 2
    expect(params.cooldownOffsetSec).toBe(-6) // −3s × 2
    expect(params.prepareTime).toBe(1)
    expect(params.prepareTimeOffsetSec).toBe(0)
  })

  describe('attackBlockReason', () => {
    const cooling = (gameSec: number, overrides?: Partial<PlayerState>): PlayerState =>
      makeState({
        meta: { gameSec },
        cooldowns: [{ kind: 'attack', id: 'a0', untilSec: 30 }],
        ...overrides,
      })

    it('returns cooling-down during the rest, and null once it lifts', () => {
      const mode = restingMode()
      expect(attackBlockReason(cooling(29), 'a0', mode)).toBe('cooling-down')
      expect(isValidAttackActivation(cooling(29), 'a0', mode)).toBe(false)
      // Lifts at 30 exactly.
      expect(attackBlockReason(cooling(30), 'a0', mode)).toBeNull()
    })

    it('refuses even a player who can easily pay', () => {
      const state = cooling(10, { resources: { r0: 1_000_000 } })
      expect(attackBlockReason(state, 'a0', restingMode())).toBe('cooling-down')
    })

    it('outranks unaffordable', () => {
      const state = cooling(10, { resources: { r0: 0 } })
      expect(attackBlockReason(state, 'a0', restingMode())).toBe('cooling-down')
    })

    it('yields to an open window — a rest queued behind the window reads as the window', () => {
      const state = makeState({
        meta: { gameSec: 12 },
        activeDebuffs: [{ attack: 'a3', expiresAtSec: 15 }],
        cooldowns: [{ kind: 'attack', id: 'a3', untilSec: 35 }],
      })
      expect(attackBlockReason(state, 'a3', restingMode())).toBe('already-active')
      expect(attackBlockReason({ ...state, meta: { gameSec: 15 } }, 'a3', restingMode())).toBe(
        'cooling-down',
      )
    })

    it('ignores a pact cooldown that shares the id', () => {
      const state = makeState({
        meta: { gameSec: 10 },
        cooldowns: [{ kind: 'pact', id: 'a0', untilSec: 30 }],
      })
      expect(attackBlockReason(state, 'a0', restingMode())).toBeNull()
    })

    it('does not let one attack’s rest block another', () => {
      const state = makeState({
        meta: { gameSec: 10 },
        cooldowns: [{ kind: 'attack', id: 'a3', untilSec: 30 }],
      })
      expect(attackBlockReason(state, 'a0', restingMode())).toBeNull()
    })
  })

  describe('resolveAttackStrike', () => {
    it('starts the rest at the strike for an attack with no window', () => {
      const attacker = makeState({ meta: { gameSec: 8 } })
      const victim = makeState({ resources: { r0: 1000 } })
      resolveAttackStrike(attacker, victim, RESTING_STEAL, restingMode())
      expect(attacker.cooldowns).toEqual([{ kind: 'attack', id: 'a0', untilSec: 28 }])
    })

    it('starts the rest when the window closes for a debuff attack', () => {
      const attacker = makeState({ meta: { gameSec: 8 } })
      resolveAttackStrike(attacker, makeState(), RESTING_DEBUFF, restingMode())
      // Window 8 → 18, then 20s of rest.
      expect(attacker.cooldowns).toEqual([{ kind: 'attack', id: 'a3', untilSec: 38 }])
    })

    it('still rests after a strike that moved nothing', () => {
      const attacker = makeState({ meta: { gameSec: 0 } })
      const victim = makeState({ resources: { r0: 0 } })
      expect(resolveAttackStrike(attacker, victim, RESTING_STEAL, restingMode())).toEqual([])
      expect(attacker.cooldowns).toEqual([{ kind: 'attack', id: 'a0', untilSec: 20 }])
    })

    it('stamps nothing for an attack with no cooldown', () => {
      const attacker = makeState({ meta: { gameSec: 0 } })
      resolveAttackStrike(attacker, makeState({ resources: { r0: 10 } }), STEAL_ATTACK, makeMode())
      expect(attacker).not.toHaveProperty('cooldowns')
    })

    it('applies the attacker’s cooldown stat at the strike', () => {
      const attacker = makeState({
        upgrades: { 'unlock-a0': 1, 'a0-rest-half': 1, 'a0-rest-less': 1 },
        meta: { gameSec: 0 },
      })
      resolveAttackStrike(attacker, makeState(), RESTING_STEAL, restingMode())
      // 20 × 0.5 − 3
      expect(attacker.cooldowns).toEqual([{ kind: 'attack', id: 'a0', untilSec: 7 }])
    })

    it('replaces the previous rest instead of listing the attack twice', () => {
      const attacker = makeState({
        meta: { gameSec: 50 },
        cooldowns: [{ kind: 'attack', id: 'a0', untilSec: 20 }],
      })
      resolveAttackStrike(attacker, makeState(), RESTING_STEAL, restingMode())
      expect(attacker.cooldowns).toEqual([{ kind: 'attack', id: 'a0', untilSec: 70 }])
    })
  })
})
