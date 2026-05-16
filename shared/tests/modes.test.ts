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
  it('returns the clicker mode definition', () => {
    const def = getModeDefinition('clicker')
    expect(def.resources).toEqual(['r0'])
    expect(def.scoreResource).toBe('r0')
    expect(def.clicksEnabled).toBe(true)
  })

  it('returns the idler mode definition', () => {
    const def = getModeDefinition('idler')
    expect(def.resources).toEqual(['r0', 'r1'])
    expect(def.scoreResource).toBe('r0')
    expect(def.clicksEnabled).toBe(false)
  })
})

// ─── getDefaultGoal ──────────────────────────────────────────────────

describe('getDefaultGoal', () => {
  it('returns the first goal for clicker', () => {
    const goal = getDefaultGoal('clicker')
    expect(goal.type).toBe('timed')
  })

  it('returns the first goal for idler', () => {
    const goal = getDefaultGoal('idler')
    expect(goal.type).toBe('timed')
  })
})

// ─── Mode goal & trophy coverage ─────────────────────────────────────

describe('mode goals', () => {
  it.each(['clicker', 'idler'] as const)('%s mode has all three goal types', (mode) => {
    const types = getModeDefinition(mode)
      .goals.map((g) => g.type)
      .sort()
    expect(types).toEqual(['buy-upgrade', 'target-score', 'timed'])
  })

  it.each(['clicker', 'idler'] as const)(
    '%s mode has exactly one upgrade tagged for buy-upgrade',
    (mode) => {
      const tagged = getModeDefinition(mode).upgrades.filter((u) => u.goalType === 'buy-upgrade')
      expect(tagged).toHaveLength(1)
    },
  )
})

// ─── getAvailableUpgrades ────────────────────────────────────────────

describe('getAvailableUpgrades', () => {
  // Build a small synthetic mode so the test is independent of real mode tuning.
  const untagged: UpgradeDefinition = {
    id: 'untagged',
    cost: 10,
    modifiers: [],
  }
  const trophy: UpgradeDefinition = {
    id: 'trophy',
    cost: 100,
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
  it('creates fresh clicker state', () => {
    const def = getModeDefinition('clicker')
    const state = createInitialState(def)
    expect(state.score).toBe(0)
    expect(state.resources).toEqual({ r0: 0 })
    expect(state.meta).toEqual({})
    // All upgrades initialized to 0
    for (const u of def.upgrades) {
      expect(state.upgrades[u.id]).toBe(0)
    }
  })

  it('creates fresh idler state with highlight meta', () => {
    const def = getModeDefinition('idler')
    const state = createInitialState(def)
    expect(state.score).toBe(0)
    expect(state.resources).toEqual({ r0: 0, r1: 0 })
    expect(state.meta.highlight).toBe('r0')
  })

  it('returns independent copies (no shared references)', () => {
    const def = getModeDefinition('clicker')
    const a = createInitialState(def)
    const b = createInitialState(def)
    a.resources.r0 = 999
    a.upgrades.u0 = 1
    expect(b.resources.r0).toBe(0)
    expect(b.upgrades.u0).toBe(0)
  })
})

// ─── collectModifiers ────────────────────────────────────────────────

describe('collectModifiers', () => {
  it('includes native modifiers for clicker', () => {
    const def = getModeDefinition('clicker')
    const state = createInitialState(def)
    const mods = collectModifiers(state, def)
    // Should at least include the base clickIncome modifier
    expect(mods.some((m) => m.field === 'clickIncome')).toBe(true)
  })

  it('includes upgrade modifiers when owned', () => {
    const def = getModeDefinition('clicker')
    const state = createInitialState(def)
    state.upgrades.u0 = 1
    const mods = collectModifiers(state, def)
    // u0 (double-click) adds +1 clickIncome
    expect(
      mods.some((m) => m.field === 'clickIncome' && m.value === 1 && m.stage === 'additive'),
    ).toBe(true)
  })

  it('does not include unowned upgrade modifiers', () => {
    const def = getModeDefinition('clicker')
    const state = createInitialState(def)
    const mods = collectModifiers(state, def)
    // clickIncome comes from native modifiers, but no extra additive clickIncome without u0
    const additiveClickIncome = mods.filter(
      (m) => m.field === 'clickIncome' && m.stage === 'additive' && m.value > 1,
    )
    expect(additiveClickIncome).toHaveLength(0)
  })

  it('scales repeatable upgrade modifiers by count', () => {
    const def = getModeDefinition('idler')
    const state = createInitialState(def)
    state.upgrades.u2 = 1 // prereq for u3 (master-craftsmen)
    state.upgrades.u3 = 3
    const mods = collectModifiers(state, def)
    // u3 (master-craftsmen): +5 base r0/sec × 3 = +15
    const mcMod = mods.find((m) => m.field === 'r0' && m.stage === 'additive' && m.value === 15)
    expect(mcMod).toBeDefined()
  })

  it('applies generator-targeted upgrades to generator output', () => {
    const def = getModeDefinition('idler')
    const state = createInitialState(def)
    state.generators.g0 = 2
    state.upgrades.u6 = 1
    const mods = collectModifiers(state, def)

    // Woodcutter base output: 1 × 2 = 2. u6 adds +4 per Woodcutter, so +8 total, effective 10.
    expect(mods.some((m) => m.field === 'r0' && m.stage === 'additive' && m.value === 10)).toBe(
      true,
    )
  })

  it('calls collectDynamic for idler mode', () => {
    const def = getModeDefinition('idler')
    const state = createInitialState(def)
    const mods = collectModifiers(state, def)
    // Highlight mechanic should produce a multiplicative modifier
    expect(
      mods.some((m) => m.stage === 'multiplicative' && (m.field === 'r0' || m.field === 'r1')),
    ).toBe(true)
  })

  it('applies u8 banked-wood bonus as multiplicative modifier', () => {
    const def = getModeDefinition('idler')
    const state = createInitialState(def)
    state.resources.r0 = 120
    state.upgrades.u8 = 1
    const mods = collectModifiers(state, def)

    // floor(120/10)*0.01 = 0.12 → multiplicative 1.12 on r0
    expect(
      mods.some((m) => m.field === 'r0' && m.stage === 'multiplicative' && m.value === 1.12),
    ).toBe(true)
  })

  it('applies u9 banked-ale bonus as multiplicative modifier', () => {
    const def = getModeDefinition('idler')
    const state = createInitialState(def)
    state.resources.r1 = 50
    state.upgrades.u9 = 1
    const mods = collectModifiers(state, def)

    // floor(50/10)*0.01 = 0.05 → multiplicative 1.05 on r1
    expect(
      mods.some((m) => m.field === 'r1' && m.stage === 'multiplicative' && m.value === 1.05),
    ).toBe(true)
  })

  it('applies u10 dominant harvesters to the lowest-tier top generator', () => {
    const def = getModeDefinition('idler')
    const state = createInitialState(def)
    state.generators.g0 = 3
    state.generators.g1 = 3
    state.generators.g2 = 1
    state.generators.g3 = 0
    state.upgrades.u10 = 1
    const mods = collectModifiers(state, def)

    // g0 should win the tie and produce 3 × 2 = 6 wood per second.
    expect(mods.some((m) => m.field === 'r0' && m.stage === 'additive' && m.value === 6)).toBe(true)
  })

  it('applies u11 balanced engineering as a global bonus when generator counts are balanced', () => {
    const def = getModeDefinition('idler')
    const state = createInitialState(def)
    state.generators.g0 = 3
    state.generators.g1 = 3
    state.generators.g2 = 3
    state.generators.g3 = 3
    state.upgrades.u11 = 1
    const mods = collectModifiers(state, def)

    expect(
      mods.some(
        (m) => m.field === 'globalMultiplier' && m.stage === 'multiplicative' && m.value === 1.25,
      ),
    ).toBe(true)
  })

  it('supports finite repeatable upgrades up to maxLevel and blocks further purchases', () => {
    const def = getModeDefinition('idler')
    const state = createInitialState(def)
    // Add a finite upgrade definition for testing
    const fin: UpgradeDefinition = {
      id: 'uF1',
      cost: 5,
      costCurrency: 'r0',
      maxLevel: 3,
      modifiers: [{ stage: 'additive', field: 'r0', value: 2 }],
    }
    const testMode = { ...def, upgrades: [...def.upgrades, fin] } as ModeDefinition

    // Give resources and buy three times
    state.resources.r0 = 100
    applyPurchase(state, 'uF1', testMode)
    applyPurchase(state, 'uF1', testMode)
    applyPurchase(state, 'uF1', testMode)
    expect(state.upgrades.uF1).toBe(3)

    // Fourth purchase should be blocked
    applyPurchase(state, 'uF1', testMode)
    expect(state.upgrades.uF1).toBe(3)
  })

  it('normalizes loaded state upgrades down to maxLevel when too large', () => {
    const def = getModeDefinition('idler')
    const state = createInitialState(def)
    const fin: UpgradeDefinition = {
      id: 'uF2',
      cost: 5,
      costCurrency: 'r0',
      maxLevel: 2,
      modifiers: [{ stage: 'additive', field: 'r0', value: 1 }],
    }
    const testMode = { ...def, upgrades: [...def.upgrades, fin] } as ModeDefinition

    // Simulate loading an old save with an overly large count
    state.upgrades.uF2 = 10
    // normalize
    normalizeUpgrades(state, testMode)
    expect(state.upgrades.uF2).toBe(2)
  })
})

// ─── applyPurchase ───────────────────────────────────────────────────

describe('applyPurchase', () => {
  function makeState(def: ModeDefinition): PlayerState {
    return createInitialState(def)
  }

  it('deducts cost from scoreResource for clicker upgrades', () => {
    const def = getModeDefinition('clicker')
    const state = makeState(def)
    state.resources.r0 = 50
    applyPurchase(state, 'u0', def) // costs 25
    expect(state.resources.r0).toBe(25)
    expect(state.upgrades.u0).toBe(1)
  })

  it('deducts cost from costCurrency for idler upgrades', () => {
    const def = getModeDefinition('idler')
    const state = makeState(def)
    state.resources.r0 = 100
    applyPurchase(state, 'u0', def) // costs 30 r0
    expect(state.resources.r0).toBe(70)
    expect(state.upgrades.u0).toBe(1)
  })

  it('increments count for repeatable upgrades', () => {
    const def = getModeDefinition('idler')
    const state = makeState(def)
    state.resources.r1 = 30
    state.upgrades.u2 = 1 // prereq for u3 (master-craftsmen)
    applyPurchase(state, 'u3', def) // costs 10 r1
    applyPurchase(state, 'u3', def)
    applyPurchase(state, 'u3', def)
    expect(state.upgrades.u3).toBe(3)
    expect(state.resources.r1).toBe(0)
  })

  it('does nothing for unknown upgrade ID', () => {
    const def = getModeDefinition('clicker')
    const state = makeState(def)
    state.resources.r0 = 999
    applyPurchase(state, 'bogus', def)
    expect(state.resources.r0).toBe(999)
  })
})
