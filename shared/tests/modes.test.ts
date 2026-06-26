import { describe, expect, it } from 'vitest'
import {
  getAvailableUpgrades,
  getModeDefinition,
  getDefaultGoal,
  customizeGoal,
  createInitialState,
  collectModifiers,
  applyPurchase,
  normalizeUpgrades,
  isPanelUnlocked,
  isClickUnlocked,
  isHighlightActive,
  hasEnemyDataAccess,
} from '../src/index.js'
import type { Goal, ModeDefinition, PlayerState, UpgradeDefinition } from '../src/index.js'

// ─── getModeDefinition ───────────────────────────────────────────────

describe('getModeDefinition', () => {
  it('returns the idler mode definition', () => {
    const def = getModeDefinition('idler')
    expect(def.resources).toEqual(['r0', 'r1'])
    expect(def.scoreResource).toBe('r0')
    expect(def.clicksEnabled).toBe(true)
  })
})

// ─── getDefaultGoal ──────────────────────────────────────────────────

describe('getDefaultGoal', () => {
  it('returns the first goal for idler', () => {
    const goal = getDefaultGoal('idler')
    expect(goal.type).toBe('buy-upgrade')
  })
})

// ─── customizeGoal ───────────────────────────────────────────────────

describe('customizeGoal', () => {
  const targetBase: Goal = {
    type: 'target-score',
    label: '🎯 Race to Score',
    target: 364,
    safetyCapSec: 300,
  }
  const timedBase: Goal = { type: 'timed', label: '⏱ Timed', durationSec: 35 }

  it('applies a custom target score', () => {
    const g = customizeGoal(targetBase, { ...targetBase, target: 500 })
    expect(g.type === 'target-score' && g.target).toBe(500)
  })

  it('applies a custom duration', () => {
    const g = customizeGoal(timedBase, { ...timedBase, durationSec: 90 })
    expect(g.type === 'timed' && g.durationSec).toBe(90)
  })

  it('clamps an out-of-range value to the bounds', () => {
    const low = customizeGoal(targetBase, { ...targetBase, target: -10 })
    const high = customizeGoal(targetBase, { ...targetBase, target: 10_000_000 })
    expect(low.type === 'target-score' && low.target).toBe(10)
    expect(high.type === 'target-score' && high.target).toBe(100_000)
  })

  it('rounds fractional values to integers', () => {
    const g = customizeGoal(timedBase, { ...timedBase, durationSec: 42.7 })
    expect(g.type === 'timed' && g.durationSec).toBe(43)
  })

  it('keeps non-tunable fields from the base goal', () => {
    const g = customizeGoal(targetBase, {
      type: 'target-score',
      label: 'spoofed',
      target: 500,
      safetyCapSec: 1,
    })
    expect(g.label).toBe('🎯 Race to Score')
    expect(g.type === 'target-score' && g.safetyCapSec).toBe(300)
  })

  it('returns the base unchanged for goal types without a tunable', () => {
    const buyUpgrade: Goal = { type: 'buy-upgrade', label: '🏆 Race to Buy', safetyCapSec: 600 }
    expect(customizeGoal(buyUpgrade, buyUpgrade)).toBe(buyUpgrade)
  })

  it('falls back to the minimum for non-finite input', () => {
    const g = customizeGoal(targetBase, { ...targetBase, target: NaN })
    expect(g.type === 'target-score' && g.target).toBe(10)
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
    expect(state.resources).toEqual({ r0: 50, r1: 20 })
    expect(state.meta.highlight).toBe('r0')
  })

  it('returns independent copies (no shared references)', () => {
    const def = getModeDefinition('idler')
    const a = createInitialState(def)
    const b = createInitialState(def)
    a.resources.r0 = 999
    a.upgrades['sc-unlock'] = 1
    expect(b.resources.r0).toBe(50)
    expect(b.upgrades['sc-unlock']).toBe(0)
  })
})

// ─── isPanelUnlocked ─────────────────────────────────────────────────

describe('isPanelUnlocked', () => {
  it('is always unlocked for a panel no upgrade gates', () => {
    const def = getModeDefinition('idler')
    const state = createInitialState(def)
    expect(isPanelUnlocked(state, def, 'play')).toBe(true)
  })

  it('is locked until the gating upgrade is owned', () => {
    const def = getModeDefinition('idler')
    const state = createInitialState(def)
    // idler gates the generators panel behind the `g1-g2` upgrade.
    expect(isPanelUnlocked(state, def, 'generators')).toBe(false)
    state.upgrades['g1-g2'] = 1
    expect(isPanelUnlocked(state, def, 'generators')).toBe(true)
  })
})

// ─── system unlock via the systemUnlock effect ──────────────────────

describe('systemUnlock effect gating', () => {
  const gateUpgrade = (system: string): UpgradeDefinition => ({
    id: `u-${system}`,
    cost: {},
    purchaseLimit: 1,
    modifiers: [],
    effects: [{ type: 'systemUnlock', system }],
  })

  it('locks clicking until an upgrade with a click systemUnlock effect is owned', () => {
    const def: ModeDefinition = {
      ...getModeDefinition('idler'),
      clicksEnabled: true,
      upgrades: [gateUpgrade('click')],
    }
    const state = createInitialState(def)
    expect(isClickUnlocked(state, def)).toBe(false)
    state.upgrades['u-click'] = 1
    expect(isClickUnlocked(state, def)).toBe(true)
  })

  it('locks highlighting until an upgrade with a highlight systemUnlock effect is owned', () => {
    const def: ModeDefinition = {
      ...getModeDefinition('idler'),
      highlightEnabled: true,
      upgrades: [gateUpgrade('highlight')],
    }
    const state = createInitialState(def)
    expect(isHighlightActive(state, def)).toBe(false)
    state.upgrades['u-highlight'] = 1
    expect(isHighlightActive(state, def)).toBe(true)
  })

  it('stays locked when the mechanic is disabled, even if the gating upgrade is owned', () => {
    const def: ModeDefinition = {
      ...getModeDefinition('idler'),
      clicksEnabled: false,
      upgrades: [gateUpgrade('click')],
    }
    const state = createInitialState(def)
    state.upgrades['u-click'] = 1
    expect(isClickUnlocked(state, def)).toBe(false)
  })

  it('is unlocked when the mechanic is enabled and nothing gates it', () => {
    const def: ModeDefinition = {
      ...getModeDefinition('idler'),
      clicksEnabled: true,
      upgrades: [],
    }
    expect(isClickUnlocked(createInitialState(def), def)).toBe(true)
  })
})

// ─── hasEnemyDataAccess ──────────────────────────────────────────────

describe('hasEnemyDataAccess', () => {
  it('hides intel for a key no upgrade grants', () => {
    const def = getModeDefinition('idler')
    const state = createInitialState(def)
    expect(hasEnemyDataAccess(state, def, 'nonexistent')).toBe(false)
  })

  it('reveals each resource only once its granting upgrade is owned', () => {
    const def = getModeDefinition('idler')
    const state = createInitialState(def)
    // idler grants the main resource (r0) via `e-se-mr`, secondary (r1) via `e-se-sr`.
    expect(hasEnemyDataAccess(state, def, 'r0')).toBe(false)
    expect(hasEnemyDataAccess(state, def, 'r1')).toBe(false)
    state.upgrades['e-se-mr'] = 1
    expect(hasEnemyDataAccess(state, def, 'r0')).toBe(true)
    expect(hasEnemyDataAccess(state, def, 'r1')).toBe(false)
    state.upgrades['e-se-sr'] = 1
    expect(hasEnemyDataAccess(state, def, 'r1')).toBe(true)
  })

  it('gates per-second production behind its own `:rate` upgrades', () => {
    const def = getModeDefinition('idler')
    const state = createInitialState(def)
    // Per-sec rates are a separate grant (`<key>:rate`) from the stockpile.
    expect(hasEnemyDataAccess(state, def, 'r0:rate')).toBe(false)
    state.upgrades['e-se-mr-ps'] = 1
    expect(hasEnemyDataAccess(state, def, 'r0:rate')).toBe(true)
    expect(hasEnemyDataAccess(state, def, 'r1:rate')).toBe(false)
    state.upgrades['e-se-sr-ps'] = 1
    expect(hasEnemyDataAccess(state, def, 'r1:rate')).toBe(true)
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

  it('applies the highlight effect (per-upgrade on sh-unlock) for idler mode', () => {
    const def = getModeDefinition('idler')
    const state = createInitialState(def)
    // Highlight requires the unlock upgrade (sh-unlock) to be purchased
    state.upgrades['sh-unlock'] = 1
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
    applyPurchase(state, 'sc-af-cp', def) // costs 25 r0
    expect(state.resources.r0).toBe(75)
    expect(state.upgrades['sc-af-cp']).toBe(1)
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
    applyPurchase(state, 'sc-af-cp', def) // costs 25 r0
    expect(state.upgrades['sc-af-cp']).toBe(1)
    const purchasedAt = state.meta.purchasedAt as Record<string, number>
    expect(purchasedAt['sc-af-cp']).toBe(5)
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
