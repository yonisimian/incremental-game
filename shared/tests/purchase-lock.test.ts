// Enemy purchase lock: the collector, the two block reasons, what
// the lock deliberately leaves open (selling, attacking), the strike that opens
// it, and the simulator's reading of the reason.

import { describe, expect, it } from 'vitest'
import {
  attackBlockReason,
  collectEnemyPurchaseLocks,
  generatorBlockReason,
  generatorSellBlockReason,
  isPurchaseLocked,
  purchaseBlockReason,
  purchaseLockRemainingSec,
  resolveAttackStrike,
} from '../src/index.js'
import type {
  AttackDefinition,
  GeneratorDefinition,
  ModeDefinition,
  PlayerState,
  UpgradeDefinition,
} from '../src/index.js'
import { applySimAction } from '../src/simulation/apply.js'

// ─── Fixtures ────────────────────────────────────────────────────────

const FLAT_UPGRADE: UpgradeDefinition = {
  id: 'u-flat',
  cost: { r0: { baseCost: 100 } },
  purchaseLimit: 5,
}

const OTHER_UPGRADE: UpgradeDefinition = { ...FLAT_UPGRADE, id: 'u-other' }

const G0: GeneratorDefinition = {
  id: 'g0',
  cost: { r0: { baseCost: 100 } },
  production: { resource: 'r0', rate: 1 },
}

const G1: GeneratorDefinition = { ...G0, id: 'g1' }

const WINDOW_SEC = 10

/** An active attack carrying the lock `target` and nothing else. */
function lockAttack(id: string, target: string): AttackDefinition {
  return {
    id,
    kind: 'active',
    prepareCost: { r0: { baseCost: 10 } },
    prepareTimeSec: 1,
    durationSec: WINDOW_SEC,
    effects: [{ type: 'enemyPurchaseLock', target }],
  }
}

const LOCK_UPGRADES = lockAttack('a-up', 'upgrades')
const LOCK_GENERATORS = lockAttack('a-gen', 'generators')
const LOCK_ALL = lockAttack('a-all', 'purchases')
const LOCK_ONE_UPGRADE = lockAttack('a-one-up', 'upgrade:u-flat')
const LOCK_ONE_GENERATOR = lockAttack('a-one-gen', 'generator:g0')

/** A raid: take 10% of the stockpile *and* lock upgrades, one window. */
const RAID_LOCK: AttackDefinition = {
  ...lockAttack('a-raid', 'upgrades'),
  effects: [
    { type: 'stealResource', resource: 'r0', fraction: 0.1 },
    { type: 'enemyPurchaseLock', target: 'upgrades' },
  ],
}

const ATTACKS = [
  LOCK_UPGRADES,
  LOCK_GENERATORS,
  LOCK_ALL,
  LOCK_ONE_UPGRADE,
  LOCK_ONE_GENERATOR,
  RAID_LOCK,
]

/** The free upgrade that unlocks `attackId`. */
function gate(attackId: string): UpgradeDefinition {
  return {
    id: `unlock-${attackId}`,
    cost: { r0: { baseCost: 0 } },
    purchaseLimit: 1,
    effects: [{ type: 'unlockAttack', attack: attackId }],
  }
}

const UPGRADES = [FLAT_UPGRADE, OTHER_UPGRADE, ...ATTACKS.map((a) => gate(a.id))]

function makeMode(): ModeDefinition {
  return {
    resources: ['r0'],
    scoreResource: 'r0',
    upgrades: UPGRADES,
    goals: [{ type: 'timed', label: '⏱ Timed', durationSec: 30 }],
    clicksEnabled: false,
    highlightEnabled: false,
    initialResources: { r0: 0 },
    initialMeta: {},
    generators: [G0, G1],
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
        upgrades: UPGRADES.map((u) => ({ id: u.id, name: u.id, icon: '🔧', description: '' })),
        generators: [
          { id: 'g0', name: 'Gen', icon: '🏭' },
          { id: 'g1', name: 'Gen 2', icon: '🏭' },
        ],
        attacks: ATTACKS.map((a) => ({ id: a.id, name: a.id, icon: '🔒', description: '' })),
        pacts: [],
      },
    ],
  }
}

function makeState(overrides?: Partial<PlayerState>): PlayerState {
  return {
    score: 0,
    resources: { r0: 1000 },
    upgrades: {},
    generators: { g0: 1 },
    pendingAttacks: [],
    meta: { gameSec: 20 },
    ...overrides,
  }
}

/** An attacker with the named windows open (unlocks owned, `gameSec` 20). */
function attackerWith(...windows: { attack: string; expiresAtSec: number }[]): PlayerState {
  const upgrades: Record<string, number> = {}
  for (const w of windows) upgrades[`unlock-${w.attack}`] = 1
  return makeState({ upgrades, activeDebuffs: windows })
}

/** A victim stamped with what `attacker` inflicts, as the server does. */
function victimOf(attacker: PlayerState, mode: ModeDefinition, r0 = 1000): PlayerState {
  const locks = collectEnemyPurchaseLocks(attacker, mode)
  const state = makeState({ resources: { r0 } })
  if (locks.length > 0) state.incomingPurchaseLocks = locks
  return state
}

const upgradeMap = (mode: ModeDefinition): Map<string, UpgradeDefinition> =>
  new Map(mode.upgrades.map((u) => [u.id, u]))

// ─── collectEnemyPurchaseLocks ───────────────────────────────────────

describe('collectEnemyPurchaseLocks', () => {
  const mode = makeMode()

  it('yields nothing when no window is open', () => {
    expect(collectEnemyPurchaseLocks(makeState(), mode)).toEqual([])
    // Holding the attack is not inflicting it — only a landed strike locks.
    expect(collectEnemyPurchaseLocks(attackerWith(), mode)).toEqual([])
  })

  it('gathers a lock from an open window, carrying the window’s expiry', () => {
    const attacker = attackerWith({ attack: 'a-up', expiresAtSec: 30 })
    expect(collectEnemyPurchaseLocks(attacker, mode)).toEqual([{ scope: 'upgrade', untilSec: 30 }])
  })

  it('ignores a window that has expired, even before the server sweeps it', () => {
    const attacker = attackerWith({ attack: 'a-up', expiresAtSec: 20 })
    expect(collectEnemyPurchaseLocks(attacker, mode)).toEqual([])
  })

  it('expands `purchases` to both scopes', () => {
    const attacker = attackerWith({ attack: 'a-all', expiresAtSec: 25 })
    expect(collectEnemyPurchaseLocks(attacker, mode)).toEqual([
      { scope: 'upgrade', untilSec: 25 },
      { scope: 'generator', untilSec: 25 },
    ])
  })

  it('collapses two windows on one scope into the one that closes last', () => {
    const attacker = attackerWith(
      { attack: 'a-up', expiresAtSec: 24 },
      { attack: 'a-raid', expiresAtSec: 28 },
    )
    expect(collectEnemyPurchaseLocks(attacker, mode)).toEqual([{ scope: 'upgrade', untilSec: 28 }])
  })

  it('keeps different scopes apart, each with its own expiry', () => {
    const attacker = attackerWith(
      { attack: 'a-up', expiresAtSec: 24 },
      { attack: 'a-gen', expiresAtSec: 28 },
    )
    expect(collectEnemyPurchaseLocks(attacker, mode)).toEqual([
      { scope: 'upgrade', untilSec: 24 },
      { scope: 'generator', untilSec: 28 },
    ])
  })

  it('carries the id of a single-entity target', () => {
    const attacker = attackerWith(
      { attack: 'a-one-up', expiresAtSec: 24 },
      { attack: 'a-one-gen', expiresAtSec: 28 },
    )
    expect(collectEnemyPurchaseLocks(attacker, mode)).toEqual([
      { scope: 'upgrade', id: 'u-flat', untilSec: 24 },
      { scope: 'generator', id: 'g0', untilSec: 28 },
    ])
  })

  it('keeps a whole-scope lock and a single-entity one as separate entries', () => {
    const attacker = attackerWith(
      { attack: 'a-up', expiresAtSec: 24 },
      { attack: 'a-one-up', expiresAtSec: 28 },
    )
    expect(collectEnemyPurchaseLocks(attacker, mode)).toEqual([
      { scope: 'upgrade', untilSec: 24 },
      { scope: 'upgrade', id: 'u-flat', untilSec: 28 },
    ])
  })
})

// ─── Reading the stamp ───────────────────────────────────────────────

describe('isPurchaseLocked / purchaseLockRemainingSec', () => {
  it('reads presence, not the clock', () => {
    // A stale stamp whose expiry has passed still blocks until the server
    // re-stamps: both sides then agree, whatever their clocks say.
    const stale = makeState({ incomingPurchaseLocks: [{ scope: 'upgrade', untilSec: 10 }] })
    expect(isPurchaseLocked(stale, 'upgrade', 'u-flat')).toBe(true)
    expect(isPurchaseLocked(stale, 'generator', 'g0')).toBe(false)
    expect(purchaseLockRemainingSec(stale, 'upgrade', 'u-flat')).toBe(0)
  })

  it('counts down against the victim’s own game clock', () => {
    const state = makeState({ incomingPurchaseLocks: [{ scope: 'generator', untilSec: 27.5 }] })
    expect(purchaseLockRemainingSec(state, 'generator', 'g0')).toBe(7.5)
    expect(purchaseLockRemainingSec(state, 'upgrade', 'u-flat')).toBeNull()
  })

  it('locks only the named entity for a single-entity lock', () => {
    const state = makeState({
      incomingPurchaseLocks: [{ scope: 'upgrade', id: 'u-flat', untilSec: 25 }],
    })
    expect(isPurchaseLocked(state, 'upgrade', 'u-flat')).toBe(true)
    expect(isPurchaseLocked(state, 'upgrade', 'u-other')).toBe(false)
    expect(purchaseLockRemainingSec(state, 'upgrade', 'u-other')).toBeNull()
  })

  it('counts down to the last lock covering the entity', () => {
    const state = makeState({
      incomingPurchaseLocks: [
        { scope: 'upgrade', untilSec: 24 },
        { scope: 'upgrade', id: 'u-flat', untilSec: 28 },
      ],
    })
    expect(purchaseLockRemainingSec(state, 'upgrade', 'u-flat')).toBe(8)
    expect(purchaseLockRemainingSec(state, 'upgrade', 'u-other')).toBe(4)
  })

  it('is unlocked with no stamp at all', () => {
    expect(isPurchaseLocked(makeState(), 'upgrade', 'u-flat')).toBe(false)
    expect(purchaseLockRemainingSec(makeState(), 'upgrade', 'u-flat')).toBeNull()
  })
})

// ─── Block reasons ───────────────────────────────────────────────────

describe('purchase block reasons under a lock', () => {
  const mode = makeMode()

  it('refuses an upgrade the victim could otherwise afford', () => {
    const victim = victimOf(attackerWith({ attack: 'a-up', expiresAtSec: 30 }), mode)
    expect(purchaseBlockReason(victim, 'u-flat', upgradeMap(mode), mode)).toBe('locked-by-attack')
    // The other scope is untouched.
    expect(generatorBlockReason(victim, 'g0', mode)).toBeNull()
  })

  it('refuses a generator under a generator lock, and leaves upgrades alone', () => {
    const victim = victimOf(attackerWith({ attack: 'a-gen', expiresAtSec: 30 }), mode)
    expect(generatorBlockReason(victim, 'g0', mode)).toBe('locked-by-attack')
    expect(purchaseBlockReason(victim, 'u-flat', upgradeMap(mode), mode)).toBeNull()
  })

  it('refuses both under `purchases`', () => {
    const victim = victimOf(attackerWith({ attack: 'a-all', expiresAtSec: 30 }), mode)
    expect(purchaseBlockReason(victim, 'u-flat', upgradeMap(mode), mode)).toBe('locked-by-attack')
    expect(generatorBlockReason(victim, 'g0', mode)).toBe('locked-by-attack')
  })

  it('refuses only the named upgrade or generator under a single-entity lock', () => {
    const attacker = attackerWith(
      { attack: 'a-one-up', expiresAtSec: 30 },
      { attack: 'a-one-gen', expiresAtSec: 30 },
    )
    const victim = victimOf(attacker, mode)
    expect(purchaseBlockReason(victim, 'u-flat', upgradeMap(mode), mode)).toBe('locked-by-attack')
    expect(purchaseBlockReason(victim, 'u-other', upgradeMap(mode), mode)).toBeNull()
    expect(generatorBlockReason(victim, 'g0', mode)).toBe('locked-by-attack')
    expect(generatorBlockReason(victim, 'g1', mode)).toBeNull()
  })

  // A player who is locked *and* broke is told they are locked: that is the
  // block no income of theirs can lift right now.
  it('reports the lock ahead of unaffordable', () => {
    const victim = victimOf(attackerWith({ attack: 'a-all', expiresAtSec: 30 }), mode, 0)
    expect(purchaseBlockReason(victim, 'u-flat', upgradeMap(mode), mode)).toBe('locked-by-attack')
    expect(generatorBlockReason(victim, 'g0', mode)).toBe('locked-by-attack')
  })

  it('reports the structural reasons ahead of the lock', () => {
    const victim = victimOf(attackerWith({ attack: 'a-all', expiresAtSec: 30 }), mode)
    victim.upgrades['u-flat'] = 5
    expect(purchaseBlockReason(victim, 'u-flat', upgradeMap(mode), mode)).toBe('maxed')
    expect(generatorBlockReason(victim, 'nope', mode)).toBe('unknown')
  })

  it('lifts once the stamp is gone', () => {
    const attacker = attackerWith({ attack: 'a-all', expiresAtSec: 30 })
    const victim = victimOf(attacker, mode)
    expect(purchaseBlockReason(victim, 'u-flat', upgradeMap(mode), mode)).toBe('locked-by-attack')
    delete victim.incomingPurchaseLocks
    expect(purchaseBlockReason(victim, 'u-flat', upgradeMap(mode), mode)).toBeNull()
    expect(generatorBlockReason(victim, 'g0', mode)).toBeNull()
  })

  it('never blocks a sale — the lock is on spending', () => {
    const victim = victimOf(attackerWith({ attack: 'a-all', expiresAtSec: 30 }), mode)
    expect(generatorSellBlockReason(victim, 'g0', mode)).toBeNull()
  })

  it('never blocks firing back', () => {
    const victim = victimOf(attackerWith({ attack: 'a-all', expiresAtSec: 30 }), mode)
    victim.upgrades['unlock-a-up'] = 1
    expect(attackBlockReason(victim, 'a-up', mode)).toBeNull()
  })
})

// ─── The strike that opens it ────────────────────────────────────────

describe('resolveAttackStrike — purchase lock', () => {
  const mode = makeMode()

  it('opens one window, reports it as a debuff, and moves nothing', () => {
    const attacker = makeState({ resources: { r0: 100 }, upgrades: { 'unlock-a-up': 1 } })
    const victim = makeState({ resources: { r0: 500 } })
    const results = resolveAttackStrike(attacker, victim, LOCK_UPGRADES, mode)
    expect(results).toEqual([{ kind: 'debuff', durationSec: WINDOW_SEC }])
    expect(attacker.activeDebuffs).toEqual([{ attack: 'a-up', expiresAtSec: 20 + WINDOW_SEC }])
    expect(victim.resources.r0).toBe(500)
    expect(attacker.resources.r0).toBe(100)
    // The window is what the collector reads.
    expect(collectEnemyPurchaseLocks(attacker, mode)).toEqual([
      { scope: 'upgrade', untilSec: 20 + WINDOW_SEC },
    ])
  })

  it('does both on a raid — the steal lands and the lock opens, one window', () => {
    const attacker = makeState({ resources: { r0: 0 }, upgrades: { 'unlock-a-raid': 1 } })
    const victim = makeState({ resources: { r0: 1000 } })
    const results = resolveAttackStrike(attacker, victim, RAID_LOCK, mode)
    expect(results).toEqual([
      { kind: 'resource', resource: 'r0', amount: 100 },
      { kind: 'debuff', durationSec: WINDOW_SEC },
    ])
    expect(victim.resources.r0).toBe(900)
    expect(attacker.activeDebuffs).toEqual([{ attack: 'a-raid', expiresAtSec: 20 + WINDOW_SEC }])
  })

  it('refuses re-activation while its window is open', () => {
    const attacker = makeState({ upgrades: { 'unlock-a-up': 1 } })
    resolveAttackStrike(attacker, makeState(), LOCK_UPGRADES, mode)
    expect(attackBlockReason(attacker, 'a-up', mode)).toBe('already-active')
  })
})

// ─── Simulator classification ────────────────────────────────────────

describe('applySimAction under a lock', () => {
  const mode = makeMode()

  // The simulator never stamps a lock today (no opponent), but the reason is
  // transient by nature: the window closes on its own, so a strategy must wait
  // rather than give up on the buy.
  it('reports a locked buy as transient, and applies it once the lock lifts', () => {
    const victim = victimOf(attackerWith({ attack: 'a-all', expiresAtSec: 30 }), mode)
    const map = upgradeMap(mode)
    expect(applySimAction(victim, { kind: 'buy', upgradeId: 'u-flat' }, mode, map)).toEqual({
      status: 'transient',
      reason: 'locked-by-attack',
    })
    expect(applySimAction(victim, { kind: 'buy_generator', generatorId: 'g0' }, mode, map)).toEqual(
      { status: 'transient', reason: 'locked-by-attack' },
    )
    expect(victim.upgrades['u-flat'] ?? 0).toBe(0)

    delete victim.incomingPurchaseLocks
    expect(applySimAction(victim, { kind: 'buy', upgradeId: 'u-flat' }, mode, map)).toEqual({
      status: 'applied',
    })
    expect(victim.upgrades['u-flat']).toBe(1)
  })
})
