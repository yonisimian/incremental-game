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
    expect(goal.type).toBe('buy-upgrade')
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
    purchaseLimit: 1,
    modifiers: [],
  }
  const trophy: UpgradeDefinition = {
    id: 'trophy',
    cost: 100,
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

  it('scales unlimited upgrade modifiers by owned count', () => {
    const unlimitedUpgrade: UpgradeDefinition = {
      id: 'uUnlim',
      cost: 10,
      costCurrency: 'r0',
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

  it('applies generator-targeted upgrades to generator output', () => {
    const def = getModeDefinition('idler')
    const state = createInitialState(def)
    state.generators.g0 = 2
    state.upgrades.u6 = 1
    const mods = collectModifiers(state, def)

    // Woodcutter base output: 0.5 × 2 = 1. u6 adds +4 per Woodcutter, so +8 total, effective 9.
    expect(mods.some((m) => m.field === 'r0' && m.stage === 'additive' && m.value === 9)).toBe(true)
  })

  it('applies multiplicative generator-targeted upgrades', () => {
    const def = getModeDefinition('idler')
    const state = createInitialState(def)
    state.generators.g1 = 3
    state.upgrades.u7 = 1
    const mods = collectModifiers(state, def)

    // Brewer base rate: 1 × 3 = 3. u7 ×2 → effective 6.
    const brewerMod = mods.find(
      (m) => m.field === 'r1' && m.stage === 'additive' && Math.abs(m.value - 6) < 0.001,
    )
    expect(brewerMod).toBeDefined()
  })

  it('generator-targeted upgrades have no effect without owned generators', () => {
    const def = getModeDefinition('idler')
    const state = createInitialState(def)
    state.upgrades.u6 = 1 // owns upgrade but no generators
    const mods = collectModifiers(state, def)

    // No generator output modifier should appear for r0 from generators
    // (only native +1 r0/sec and u6 should not produce any g0 output)
    expect(mods.some((m) => m.field === 'r0' && m.stage === 'additive' && m.value > 1)).toBe(false)
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

  it('applies u8 banked-wood bonus as multiplicative modifier', () => {
    const def = getModeDefinition('idler')
    const state = createInitialState(def)
    state.resources.r0 = 120
    state.upgrades.u8 = 1
    const mods = collectModifiers(state, def)

    // 120 * 0.001 = 0.12 → multiplicative 1.12 on r0
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

    // 50 * 0.001 = 0.05 → multiplicative 1.05 on r1
    expect(
      mods.some((m) => m.field === 'r1' && m.stage === 'multiplicative' && m.value === 1.05),
    ).toBe(true)
  })

  it('applies u10 dominant harvesters ×2 to the top generator (lowest-tier wins ties)', () => {
    const def = getModeDefinition('idler')
    const state = createInitialState(def)
    state.generators.g0 = 3
    state.generators.g1 = 3
    state.generators.g2 = 1
    state.upgrades.u10 = 1
    const mods = collectModifiers(state, def)

    // g0 wins tie (lowest-tier), base rate 0.5 × 3 × 2 = 3
    expect(mods.some((m) => m.field === 'r0' && m.stage === 'additive' && m.value === 3)).toBe(true)
  })

  it('applies u11 balanced engineering as global bonus when generators are balanced', () => {
    const def = getModeDefinition('idler')
    const state = createInitialState(def)
    state.generators.g0 = 3
    state.generators.g1 = 3
    state.generators.g2 = 3
    state.generators.g3 = 3
    state.upgrades.u11 = 1
    const mods = collectModifiers(state, def)

    // Perfectly balanced → balanceRatio = 1 → bonus = 1.25
    expect(
      mods.some(
        (m) => m.field === 'globalMultiplier' && m.stage === 'multiplicative' && m.value === 1.25,
      ),
    ).toBe(true)
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
    applyPurchase(state, 'u0', def) // costs 15 r0
    expect(state.resources.r0).toBe(85)
    expect(state.upgrades.u0).toBe(1)
  })

  it('increments count for unlimited upgrades', () => {
    const unlimitedUpgrade: UpgradeDefinition = {
      id: 'uUnlim',
      cost: 10,
      costCurrency: 'r1',
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
      cost: 5,
      costCurrency: 'r0',
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
      cost: 5,
      costCurrency: 'r0',
      purchaseLimit: 2,
      modifiers: [{ stage: 'additive', field: 'r0', value: 1 }],
    }
    const testMode = { ...def, upgrades: [...def.upgrades, fin] } as ModeDefinition

    state.upgrades.uF2 = 10
    normalizeUpgrades(state, testMode)
    expect(state.upgrades.uF2).toBe(2)
  })

  it('does nothing for unknown upgrade ID', () => {
    const def = getModeDefinition('clicker')
    const state = makeState(def)
    state.resources.r0 = 999
    applyPurchase(state, 'bogus', def)
    expect(state.resources.r0).toBe(999)
  })
})

// ─── Time-Based Multiplier (u12) ─────────────────────────────────────

describe('time-based multiplier (u12)', () => {
  function setupIdler() {
    const def = getModeDefinition('idler')
    const state = createInitialState(def)
    return { def, state }
  }

  it('applyPurchase records purchasedAt in state.meta', () => {
    const { def, state } = setupIdler()
    state.resources.r0 = 300
    state.meta.gameSec = 5
    applyPurchase(state, 'u12', def)
    expect(state.upgrades.u12).toBe(1)
    const purchasedAt = state.meta.purchasedAt as Record<string, number>
    expect(purchasedAt.u12).toBe(5)
  })

  it('repeated purchase does not overwrite purchasedAt', () => {
    const unlimitedUpgrade: UpgradeDefinition = {
      id: 'uRepeat',
      cost: 10,
      costCurrency: 'r0',
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

  it('dynamicModifier returns null when upgrade is not owned', () => {
    const { def, state } = setupIdler()
    const u12 = def.upgrades.find((u) => u.id === 'u12')!
    expect(u12.dynamicModifier!(state)).toBeNull()
  })

  it('dynamicModifier returns multiplier based on elapsed time', () => {
    const { def, state } = setupIdler()
    state.upgrades.u12 = 1
    state.meta.purchasedAt = { u12: 5 }
    state.meta.gameSec = 35 // 30 seconds elapsed
    const u12 = def.upgrades.find((u) => u.id === 'u12')!
    const mod = u12.dynamicModifier!(state)
    expect(mod).not.toBeNull()
    // multiplier = 1 + (1/60)*30 = 1.5
    expect(mod!.value).toBeCloseTo(1.5)
    expect(mod!.stage).toBe('multiplicative')
    expect(mod!.field).toBe('globalMultiplier')
  })

  it('multiplier is capped at 10', () => {
    const { def, state } = setupIdler()
    state.upgrades.u12 = 1
    state.meta.purchasedAt = { u12: 0 }
    state.meta.gameSec = 9999 // way past cap
    const u12 = def.upgrades.find((u) => u.id === 'u12')!
    const mod = u12.dynamicModifier!(state)
    expect(mod!.value).toBe(10)
  })

  it('collectModifiers includes the time multiplier when owned', () => {
    const { def, state } = setupIdler()
    state.upgrades.u12 = 1
    state.meta.purchasedAt = { u12: 0 }
    state.meta.gameSec = 60 // 60s elapsed → multiplier = 1 + 1 = 2
    const mods = collectModifiers(state, def)
    const globalMult = mods.find(
      (m) => m.field === 'globalMultiplier' && m.stage === 'multiplicative',
    )
    expect(globalMult).toBeDefined()
    expect(globalMult!.value).toBeCloseTo(2)
  })
})
