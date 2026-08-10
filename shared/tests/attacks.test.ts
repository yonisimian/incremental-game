import { describe, expect, it } from 'vitest'
import type { ModeDefinition } from '../src/modes/types.js'
import type { AttackDefinition, PlayerState, UpgradeDefinition } from '../src/types.js'
import {
  attackBlockReason,
  isValidAttackActivation,
  getAttackPrepareCost,
  applyAttackActivation,
  dueAttacks,
  resolveAttackStrike,
} from '../src/attacks.js'

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

function makeMode(): ModeDefinition {
  return {
    resources: ['r0'],
    scoreResource: 'r0',
    upgrades: [UNLOCK_A0, UNLOCK_A2],
    goals: [{ type: 'timed', label: '⏱ Timed', durationSec: 30 }],
    nativeModifiers: [],
    clicksEnabled: false,
    highlightEnabled: false,
    initialResources: { r0: 0 },
    initialMeta: {},
    generators: [],
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
        upgrades: [
          { id: 'unlock-a0', name: 'Unlock A0', icon: '⚙️', description: 'unlock a0' },
          { id: 'unlock-a2', name: 'Unlock A2', icon: '⚙️', description: 'unlock a2' },
        ],
        generators: [],
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

// ─── getAttackPrepareCost ────────────────────────────────────────────

describe('getAttackPrepareCost', () => {
  it('evaluates each currency at level 0', () => {
    expect(getAttackPrepareCost(STEAL_ATTACK)).toEqual({ r0: 1000 })
  })

  it('returns an empty map when there is no prepareCost', () => {
    expect(getAttackPrepareCost(PLACEHOLDER_ATTACK)).toEqual({})
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
    expect(results).toEqual([{ resource: 'r0', amount: 50 }])
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
    expect(results).toEqual([{ resource: 'r0', amount: 200 }])
  })

  it('caps a flat steal at what the victim holds', () => {
    const mode = makeMode()
    const attacker = makeState({ resources: { r0: 0 } })
    const victim = makeState({ resources: { r0: 50 } })
    const results = resolveAttackStrike(attacker, victim, FLAT_STEAL_ATTACK, mode)
    expect(victim.resources.r0).toBe(0)
    expect(attacker.resources.r0).toBe(50)
    expect(results).toEqual([{ resource: 'r0', amount: 50 }])
  })

  it('does not credit the attacker score for a flat steal either', () => {
    const mode = makeMode()
    const attacker = makeState({ score: 100, resources: { r0: 0 } })
    const victim = makeState({ resources: { r0: 500 } })
    resolveAttackStrike(attacker, victim, FLAT_STEAL_ATTACK, mode)
    expect(attacker.score).toBe(100)
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
