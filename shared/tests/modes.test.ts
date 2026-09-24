import { describe, expect, it } from 'vitest'
import {
  getAvailableUpgrades,
  getModeDefinition,
  getDefaultGoal,
  customizeGoal,
  createInitialState,
  collectModifiers,
  collectEnemyDebuffs,
  computePassiveRates,
  debuffedHighlightFactor,
  getHighlightMultiplier,
  HIGHLIGHT_DEBUFF_FLOOR,
  resolveEnemyDebuffs,
  highlightDebuffFactor,
  HIGHLIGHT_FACTOR_TARGET,
  applyPurchase,
  normalizeUpgrades,
  isPanelUnlocked,
  isClickUnlocked,
  isHighlightActive,
  hasEnemyDataAccess,
  readPurchaseTimes,
} from '../src/index.js'
import type {
  Goal,
  Modifier,
  ModeDefinition,
  PlayerState,
  UpgradeDefinition,
} from '../src/index.js'

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
    cost: { r0: { baseCost: 10 } },
    purchaseLimit: 1,
  }
  const trophy: UpgradeDefinition = {
    id: 'trophy',
    cost: { r0: { baseCost: 100 } },
    purchaseLimit: 1,
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

  it('reveals peak CPS (a non-resource intel key) once `e-se-cps` is owned', () => {
    const def = getModeDefinition('idler')
    const state = createInitialState(def)
    expect(hasEnemyDataAccess(state, def, 'peakCps')).toBe(false)
    state.upgrades['e-se-cps'] = 1
    expect(hasEnemyDataAccess(state, def, 'peakCps')).toBe(true)
  })
})

// ─── collectModifiers ────────────────────────────────────────────────
describe('collectModifiers', () => {
  it('scales unlimited upgrade modifiers by owned count', () => {
    const unlimitedUpgrade: UpgradeDefinition = {
      id: 'uUnlim',
      cost: { r0: { baseCost: 10 } },
      purchaseLimit: Infinity,
      effects: [{ type: 'baseModifier', stage: 'additive', field: 'r0', value: 5 }],
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

// ─── collectEnemyDebuffs ─────────────────────────────────────────────
describe('collectEnemyDebuffs', () => {
  // The upgrade whose `unlockAttack` effect gates the given attack id.
  function attackGate(def: ModeDefinition, attackId: string): UpgradeDefinition {
    const gate = def.upgrades.find((u) =>
      (u.effects ?? []).some((e) => e.type === 'unlockAttack' && e.attack === attackId),
    )
    if (!gate) throw new Error(`no upgrade unlocks attack '${attackId}'`)
    return gate
  }

  it('yields no debuffs when no passive attack is unlocked', () => {
    const def = getModeDefinition('idler')
    const state = createInitialState(def)
    expect(collectEnemyDebuffs(state, def)).toEqual([])
  })

  it('gathers the production modifier from an unlocked passive attack', () => {
    const def = getModeDefinition('idler')
    // a2 is a passive attack carrying enemyProductionModifier r0 ×0.9.
    const state = createInitialState(def)
    state.upgrades[attackGate(def, 'a2').id] = 1
    expect(collectEnemyDebuffs(state, def)).toContainEqual({
      stage: 'multiplicative',
      field: 'r0',
      value: 0.9,
    })
  })

  it('ignores a passive attack that carries no offensive effect', () => {
    const def = getModeDefinition('idler')
    // a3 is a passive attack with no effects → contributes nothing.
    const state = createInitialState(def)
    state.upgrades[attackGate(def, 'a3').id] = 1
    expect(collectEnemyDebuffs(state, def)).toEqual([])
  })
})

// ─── resolveEnemyDebuffs / highlightDebuffFactor ─────────────────────

describe('resolveEnemyDebuffs', () => {
  const HL_MULT: Modifier = { stage: 'multiplicative', field: HIGHLIGHT_FACTOR_TARGET, value: 0.5 }
  const HL_ADD: Modifier = { stage: 'additive', field: HIGHLIGHT_FACTOR_TARGET, value: -1 }
  const RATE_DEBUFF: Modifier = { stage: 'multiplicative', field: 'r0', value: 0.8 }

  /**
   * A victim holding `highlight`, with `sh-unlock` owned so its composite
   * highlight factor is above neutral (there is a bonus for a debuff to bite).
   */
  function victim(def: ModeDefinition, highlight: string | null): PlayerState {
    const state = createInitialState(def)
    state.meta.highlight = highlight
    state.upgrades['sh-unlock'] = 1
    return state
  }

  it('passes real pipeline targets through untouched', () => {
    const def = getModeDefinition('idler')
    expect(resolveEnemyDebuffs([RATE_DEBUFF], victim(def, 'r1'), def)).toEqual([RATE_DEBUFF])
  })

  it('folds a highlight-factor debuff into one bonus-scaling modifier on the held resource', () => {
    const def = getModeDefinition('idler')
    const state = victim(def, 'r1')
    const factor = getHighlightMultiplier(state, def)
    expect(factor).toBeGreaterThan(1)
    // Bonus-scaling: F' = 1 + (F−1)·0.5; the pushed modifier is the ratio F'/F.
    const debuffed = 1 + (factor - 1) * 0.5
    const mods = resolveEnemyDebuffs([HL_MULT], state, def)
    expect(mods).toHaveLength(1)
    expect(mods[0].stage).toBe('multiplicative')
    expect(mods[0].field).toBe('r1') // follows the selection, not a fixed resource
    expect(mods[0].value).toBeCloseTo(debuffed / factor, 9)
  })

  it('drops a highlight-factor debuff while the victim has released', () => {
    const def = getModeDefinition('idler')
    // Released → no bonus for the factor to scale, so nothing lands.
    expect(resolveEnemyDebuffs([HL_MULT], victim(def, null), def)).toEqual([])
    // ...without dropping the debuffs that don't depend on a highlight.
    expect(resolveEnemyDebuffs([HL_MULT, RATE_DEBUFF], victim(def, null), def)).toEqual([
      RATE_DEBUFF,
    ])
  })

  it('takes no highlight debuff when the victim has no bonus to cut (F ≤ 1)', () => {
    const def = getModeDefinition('idler')
    const state = createInitialState(def)
    state.meta.highlight = 'r0' // held, but sh-unlock not owned → F = 1
    expect(resolveEnemyDebuffs([HL_MULT], state, def)).toEqual([])
  })

  // The property plan 34 delivers: scale the *bonus*, not the whole factor — a
  // ×2 highlight under value 0.5 becomes ×1.5 (bonus halved), not ×1.
  it('scales the bonus above neutral rather than the whole factor', () => {
    const def = getModeDefinition('idler')
    const state = victim(def, 'r0')
    const factor = getHighlightMultiplier(state, def)
    const own = collectModifiers(state, def)
    const debuffed = computePassiveRates(
      [...own, ...resolveEnemyDebuffs([HL_MULT], state, def)],
      def.resources,
    )
    const undebuffed = computePassiveRates(own, def.resources)
    // r0's rate is scaled by F'/F, where F' = 1 + (F−1)·0.5.
    const expectedRatio = (1 + (factor - 1) * 0.5) / factor
    expect(debuffed.r0 / undebuffed.r0).toBeCloseTo(expectedRatio, 9)
  })

  it('folds two multiplicative highlight debuffs on the bonus, emitting one modifier', () => {
    const def = getModeDefinition('idler')
    const state = victim(def, 'r0')
    const factor = getHighlightMultiplier(state, def)
    // Two ×0.5 fold to ×0.25 on the bonus (not two ratios re-divided by F).
    const debuffed = 1 + (factor - 1) * 0.25
    const mods = resolveEnemyDebuffs([HL_MULT, HL_MULT], state, def)
    expect(mods).toHaveLength(1)
    expect(mods[0].value).toBeCloseTo(debuffed / factor, 9)
  })

  it('clamps a heavy additive debuff at neutral, never below ×1', () => {
    const def = getModeDefinition('idler')
    const state = victim(def, 'r0')
    const factor = getHighlightMultiplier(state, def)
    // Enough additive pressure to underrun neutral: F' clamps to the floor (×1).
    const mods = resolveEnemyDebuffs([HL_ADD, HL_ADD, HL_ADD], state, def)
    expect(mods[0].value).toBeCloseTo(HIGHLIGHT_DEBUFF_FLOOR / factor, 9)
    // A debuffed highlight is never a penalty, so it's never worse than releasing.
    expect(HIGHLIGHT_DEBUFF_FLOOR).toBe(1)
  })

  // Pins getHighlightMultiplier to the factor the pipeline actually applies: if a
  // future highlight multiplier reached collectModifiers without being mirrored
  // here, the debuff (which builds its ratio from getHighlightMultiplier) would
  // be silently wrong. This catches that drift.
  it('measures the same composite factor the pipeline applies to the held resource', () => {
    const def = getModeDefinition('idler')
    const held = victim(def, 'r0')
    held.generators.g0 = 1 // a base r0 producer, so the released rate is > 0
    const released: PlayerState = { ...held, meta: { ...held.meta, highlight: null } }
    const heldRate = computePassiveRates(collectModifiers(held, def), def.resources).r0
    const releasedRate = computePassiveRates(collectModifiers(released, def), def.resources).r0
    expect(heldRate / releasedRate).toBeCloseTo(getHighlightMultiplier(held, def), 9)
  })
})

describe('debuffedHighlightFactor', () => {
  const hlMult = (value: number): Modifier => ({
    stage: 'multiplicative',
    field: HIGHLIGHT_FACTOR_TARGET,
    value,
  })

  it('returns the factor unchanged when there is no bonus to cut (F ≤ 1)', () => {
    expect(debuffedHighlightFactor(1, [hlMult(0.9)])).toBe(1)
    expect(debuffedHighlightFactor(0.8, [hlMult(0.9)])).toBe(0.8)
  })

  it('scales the bonus above neutral for a multiplicative debuff', () => {
    // ×4 under value 0.5 → 1 + 3·0.5 = ×2.5.
    expect(debuffedHighlightFactor(4, [hlMult(0.5)])).toBeCloseTo(2.5, 9)
  })

  it('composes multiplicative and additive, then clamps at the floor', () => {
    // F=4: 1 + (4−1)·0.5 + (−1) = 1.5 (above the neutral ×1 floor).
    expect(
      debuffedHighlightFactor(4, [
        hlMult(0.5),
        { stage: 'additive', field: HIGHLIGHT_FACTOR_TARGET, value: -1 },
      ]),
    ).toBeCloseTo(1.5, 9)
    // Heavy additive underruns neutral and is clamped at ×1.
    expect(
      debuffedHighlightFactor(2, [
        { stage: 'additive', field: HIGHLIGHT_FACTOR_TARGET, value: -5 },
      ]),
    ).toBe(HIGHLIGHT_DEBUFF_FLOOR)
  })
})

describe('highlightDebuffFactor', () => {
  it('returns 1 when no highlight debuff is present', () => {
    expect(highlightDebuffFactor([])).toBe(1)
    expect(highlightDebuffFactor([{ stage: 'multiplicative', field: 'r0', value: 0.5 }])).toBe(1)
  })

  it('compounds only the multiplicative highlight debuffs', () => {
    expect(
      highlightDebuffFactor([
        { stage: 'multiplicative', field: HIGHLIGHT_FACTOR_TARGET, value: 0.9 },
        { stage: 'multiplicative', field: 'r0', value: 0.5 }, // not a highlight target
        { stage: 'additive', field: HIGHLIGHT_FACTOR_TARGET, value: -1 }, // additive → excluded
        { stage: 'multiplicative', field: HIGHLIGHT_FACTOR_TARGET, value: 0.5 },
      ]),
    ).toBeCloseTo(0.45, 9)
  })

  // For reporting, so it must not depend on a highlight being held — that's what
  // lets the UI warn a released player that holding is worth less than advertised.
  it('reports the factor regardless of whether a highlight is held', () => {
    const debuffs: Modifier[] = [
      { stage: 'multiplicative', field: HIGHLIGHT_FACTOR_TARGET, value: 0.9 },
    ]
    expect(highlightDebuffFactor(debuffs)).toBeCloseTo(0.9, 9)
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
      cost: { r1: { baseCost: 10 } },
      purchaseLimit: Infinity,
      effects: [{ type: 'baseModifier', stage: 'additive', field: 'r0', value: 5 }],
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
      cost: { r0: { baseCost: 5 } },
      purchaseLimit: 3,
      effects: [{ type: 'baseModifier', stage: 'additive', field: 'r0', value: 2 }],
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
      cost: { r0: { baseCost: 5 } },
      purchaseLimit: 2,
      effects: [{ type: 'baseModifier', stage: 'additive', field: 'r0', value: 1 }],
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

// ─── Purchase timestamps (state.meta.purchaseTimes) ──────────────────

describe('purchase timestamps (state.meta.purchaseTimes)', () => {
  it('applyPurchase dates a purchase in state.meta', () => {
    const def = getModeDefinition('idler')
    const state = createInitialState(def)
    state.resources.r0 = 300
    state.meta.gameSec = 5
    applyPurchase(state, 'sc-af-cp', def) // costs 25 r0
    expect(state.upgrades['sc-af-cp']).toBe(1)
    expect(readPurchaseTimes(state, 'sc-af-cp')).toEqual([5])
  })

  // An ordinary repeatable upgrade keeps only its first buy: no time clock reads
  // it, so appending an entry per purchase would grow the broadcast state for
  // nothing.
  it('repeated purchase does not overwrite the first timestamp', () => {
    const unlimitedUpgrade: UpgradeDefinition = {
      id: 'uRepeat',
      cost: { r0: { baseCost: 10 } },
      purchaseLimit: Infinity,
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
    expect(readPurchaseTimes(state, 'uRepeat')).toEqual([2]) // still original timestamp
    expect(state.upgrades.uRepeat).toBe(2)
  })

  // The exception: an upgrade a time clock prices level-by-level keeps them all.
  it('dates every level of a clocked upgrade', () => {
    const def = getModeDefinition('idler')
    const state = createInitialState(def)
    state.resources.r0 = 10_000
    state.resources.r1 = 10_000
    state.meta.gameSec = 3
    applyPurchase(state, 'ae-mf-ar-time', def)
    state.meta.gameSec = 8
    applyPurchase(state, 'ae-atf', def)
    state.meta.gameSec = 20
    applyPurchase(state, 'ae-atf', def)
    expect(readPurchaseTimes(state, 'ae-mf-ar-time')).toEqual([3])
    expect(readPurchaseTimes(state, 'ae-atf')).toEqual([8, 20])
  })
})
