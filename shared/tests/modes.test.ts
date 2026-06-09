import { describe, expect, it } from 'vitest'
import {
  getAvailableUpgrades,
  getModeDefinition,
  getDefaultGoal,
  createInitialState,
  collectModifiers,
  applyPurchase,
  normalizeUpgrades,
} from '../src/index.js'
import type { Goal, ModeDefinition, PlayerState, UpgradeDefinition } from '../src/index.js'

// ─── getModeDefinition ───────────────────────────────────────────────

describe('getModeDefinition', () => {
  it('returns the idler mode definition', () => {
    const def = getModeDefinition('idler')
    expect(def.resources).toEqual(['r0', 'r1'])
    expect(def.scoreResource).toBe('r0')
    expect(def.clicksEnabled).toBe(false)
  })
})

// ─── getDefaultGoal ──────────────────────────────────────────────────

describe('getDefaultGoal', () => {
  it('returns the first goal for idler', () => {
    const goal = getDefaultGoal('idler')
    expect(goal.type).toBe('buy-upgrade')
  })
})

// ─── Mode goal & trophy coverage ─────────────────────────────────────

describe('mode goals', () => {
  it.each(['idler'] as const)('%s mode has all three goal types', (mode) => {
    const types = getModeDefinition(mode)
      .goals.map((g) => g.type)
      .sort()
    expect(types).toEqual(['buy-upgrade', 'target-score', 'timed'])
  })

  it.each(['idler'] as const)('%s mode has exactly one upgrade tagged for buy-upgrade', (mode) => {
    const tagged = getModeDefinition(mode).upgrades.filter((u) => u.goalType === 'buy-upgrade')
    expect(tagged).toHaveLength(1)
  })
})

// ─── getAvailableUpgrades ────────────────────────────────────────────

describe('getAvailableUpgrades', () => {
  // Build a small synthetic mode so the test is independent of real mode tuning.
  const untagged: UpgradeDefinition = {
    id: 'untagged',
    cost: { r0: 10 },
    purchaseLimit: 1,
    modifiers: [],
  }
  const trophy: UpgradeDefinition = {
    id: 'trophy',
    cost: { r0: 100 },
    purchaseLimit: 1,
    modifiers: [],
    goalType: 'buy-upgrade',
  }
  const fakeMode = { upgrades: [untagged, trophy] } as unknown as ModeDefinition

  const timedGoal: Goal = { type: 'timed', label: '⏱ Timed', durationSec: 30 }
  const buyUpgradeGoal: Goal = { type: 'buy-upgrade', label: '🏆 Race to Buy', safetyCapSec: 600 }

  it('includes untagged upgrades regardless of goal', () => {
    expect(getAvailableUpgrades(fakeMode, timedGoal)).toContain(untagged)
    expect(getAvailableUpgrades(fakeMode, buyUpgradeGoal)).toContain(untagged)
    expect(getAvailableUpgrades(fakeMode, null)).toContain(untagged)
  })

  it('excludes tagged upgrades when goal type does not match', () => {
    expect(getAvailableUpgrades(fakeMode, timedGoal)).not.toContain(trophy)
  })

  it('includes tagged upgrades when goal type matches', () => {
    expect(getAvailableUpgrades(fakeMode, buyUpgradeGoal)).toContain(trophy)
  })

  it('excludes tagged upgrades when goal is null', () => {
    expect(getAvailableUpgrades(fakeMode, null)).not.toContain(trophy)
  })
})

// ─── createInitialState ──────────────────────────────────────────────

describe('createInitialState', () => {
  it('creates fresh idler state with highlight meta', () => {
    const def = getModeDefinition('idler')
    const state = createInitialState(def)
    expect(state.score).toBe(0)
    expect(state.resources).toEqual({ r0: 0, r1: 0 })
    expect(state.meta.highlight).toBe('r0')
  })

  it('returns independent copies (no shared references)', () => {
    const def = getModeDefinition('idler')
    const a = createInitialState(def)
    const b = createInitialState(def)
    a.resources.r0 = 999
    a.upgrades.uh = 1
    expect(b.resources.r0).toBe(0)
    expect(b.upgrades.uh).toBe(0)
  })
})

// ─── collectModifiers ────────────────────────────────────────────────

describe('collectModifiers', () => {
  it('scales unlimited upgrade modifiers by owned count', () => {
    const unlimitedUpgrade: UpgradeDefinition = {
      id: 'uUnlim',
      cost: { r0: 10 },
      purchaseLimit: Infinity,
      modifiers: [{ stage: 'additive', field: 'r0', value: 5 }],
    }
    const customDef: ModeDefinition = {
      ...getModeDefinition('idler'),
      upgrades: [...getModeDefinition('idler').upgrades, unlimitedUpgrade],
    }
    const state = createInitialState(customDef)
    state.upgrades.uUnlim = 3
    const mods = collectModifiers(state, customDef)
    const scaledMod = mods.find((m) => m.field === 'r0' && m.stage === 'additive' && m.value === 15)
    expect(scaledMod).toBeDefined()
  })

  it('calls collectDynamic for idler mode', () => {
    const def = getModeDefinition('idler')
    const state = createInitialState(def)
    // Highlight requires the unlock upgrade (uh) to be purchased
    state.upgrades.uh = 1
    const mods = collectModifiers(state, def)
    // Highlight mechanic should produce a multiplicative modifier
    expect(
      mods.some((m) => m.stage === 'multiplicative' && (m.field === 'r0' || m.field === 'r1')),
    ).toBe(true)
  })
})

// ─── applyPurchase ───────────────────────────────────────────────────

describe('applyPurchase', () => {
  function makeState(def: ModeDefinition): PlayerState {
    return createInitialState(def)
  }

  it('deducts cost from the cost-map currencies for idler upgrades', () => {
    const def = getModeDefinition('idler')
    const state = makeState(def)
    state.resources.r0 = 100
    applyPurchase(state, 'u1', def) // costs 25 r0
    expect(state.resources.r0).toBe(75)
    expect(state.upgrades.u1).toBe(1)
  })

  it('increments count for unlimited upgrades', () => {
    const unlimitedUpgrade: UpgradeDefinition = {
      id: 'uUnlim',
      cost: { r1: 10 },
      purchaseLimit: Infinity,
      modifiers: [{ stage: 'additive', field: 'r0', value: 5 }],
    }
    const customDef: ModeDefinition = {
      ...getModeDefinition('idler'),
      upgrades: [...getModeDefinition('idler').upgrades, unlimitedUpgrade],
    }
    const state = makeState(customDef)
    state.resources.r1 = 30
    applyPurchase(state, 'uUnlim', customDef)
    applyPurchase(state, 'uUnlim', customDef)
    applyPurchase(state, 'uUnlim', customDef)
    expect(state.upgrades.uUnlim).toBe(3)
    expect(state.resources.r1).toBe(0)
  })

  it('blocks purchase when purchaseLimit is reached', () => {
    const def = getModeDefinition('idler')
    const state = makeState(def)
    const fin: UpgradeDefinition = {
      id: 'uF1',
      cost: { r0: 5 },
      purchaseLimit: 3,
      modifiers: [{ stage: 'additive', field: 'r0', value: 2 }],
    }
    const testMode = { ...def, upgrades: [...def.upgrades, fin] } as ModeDefinition

    state.resources.r0 = 100
    applyPurchase(state, 'uF1', testMode)
    applyPurchase(state, 'uF1', testMode)
    applyPurchase(state, 'uF1', testMode)
    expect(state.upgrades.uF1).toBe(3)

    // Fourth purchase should be blocked
    applyPurchase(state, 'uF1', testMode)
    expect(state.upgrades.uF1).toBe(3)
  })

  it('normalizes loaded state upgrades down to purchaseLimit', () => {
    const def = getModeDefinition('idler')
    const state = makeState(def)
    const fin: UpgradeDefinition = {
      id: 'uF2',
      cost: { r0: 5 },
      purchaseLimit: 2,
      modifiers: [{ stage: 'additive', field: 'r0', value: 1 }],
    }
    const testMode = { ...def, upgrades: [...def.upgrades, fin] } as ModeDefinition

    state.upgrades.uF2 = 10
    normalizeUpgrades(state, testMode)
    expect(state.upgrades.uF2).toBe(2)
  })

  it('does nothing for unknown upgrade ID', () => {
    const def = getModeDefinition('idler')
    const state = makeState(def)
    state.resources.r0 = 999
    applyPurchase(state, 'bogus', def)
    expect(state.resources.r0).toBe(999)
  })
})

// ─── Purchase timestamps (state.meta.purchasedAt) ────────────────────

describe('purchase timestamps (state.meta.purchasedAt)', () => {
  it('applyPurchase records purchasedAt in state.meta', () => {
    const def = getModeDefinition('idler')
    const state = createInitialState(def)
    state.resources.r0 = 300
    state.meta.gameSec = 5
    applyPurchase(state, 'u1', def) // costs 25 r0
    expect(state.upgrades.u1).toBe(1)
    const purchasedAt = state.meta.purchasedAt as Record<string, number>
    expect(purchasedAt.u1).toBe(5)
  })

  it('repeated purchase does not overwrite purchasedAt', () => {
    const unlimitedUpgrade: UpgradeDefinition = {
      id: 'uRepeat',
      cost: { r0: 10 },
      purchaseLimit: Infinity,
      modifiers: [],
    }
    const customDef: ModeDefinition = {
      ...getModeDefinition('idler'),
      upgrades: [...getModeDefinition('idler').upgrades, unlimitedUpgrade],
    }
    const state = createInitialState(customDef)
    state.resources.r0 = 100
    state.meta.gameSec = 2
    applyPurchase(state, 'uRepeat', customDef) // first buy at gameSec=2
    state.meta.gameSec = 10
    applyPurchase(state, 'uRepeat', customDef) // second buy at gameSec=10
    const purchasedAt = state.meta.purchasedAt as Record<string, number>
    expect(purchasedAt.uRepeat).toBe(2) // still original timestamp
    expect(state.upgrades.uRepeat).toBe(2)
  })
})
