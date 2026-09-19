import { describe, expect, it } from 'vitest'
import {
  addressableSources,
  addressableSourcesFor,
  ATTACK_STAT_DIRECTION,
  ATTACK_STATS,
  addressableTargets,
  addressableTargetsFor,
  applyEffect,
  collectModifiers,
  createInitialState,
  enemyDebuffTargets,
  enemyDebuffTargetsFor,
  getModeDefinition,
  hasEnemyDataAccess,
  HIGHLIGHT_FACTOR_TARGET,
  isAttackUnlocked,
  isClickUnlocked,
  isDynamicEffect,
  isGeneratorUnlocked,
  isHighlightBatteryActive,
  isPactUnlocked,
  isPanelUnlocked,
  listEffectTypes,
  registerEffect,
  resolveEffect,
  unlockedAttacks,
  unlockedPacts,
  validateModeDefinition,
} from '../src/index.js'
import type {
  EffectRef,
  Modifier,
  ModeDefinition,
  PlayerState,
  UpgradeDefinition,
} from '../src/index.js'

// ─── Registry ────────────────────────────────────────────────────────

describe('effect registry', () => {
  it('resolves a registered seed effect', () => {
    expect(resolveEffect('highlightMultiplier')).toBeDefined()
  })

  it('returns undefined for an unknown type', () => {
    expect(resolveEffect('doesNotExist')).toBeUndefined()
  })

  it('throws when applying an unknown effect type', () => {
    const mode = getModeDefinition('idler')
    const state = createInitialState(mode)
    expect(() => applyEffect({ type: 'doesNotExist' }, state, mode)).toThrow(
      /unknown effect type/iu,
    )
  })

  it('throws when registering a duplicate type', () => {
    const existing = resolveEffect('highlightMultiplier')!
    expect(() => {
      registerEffect('highlightMultiplier', existing)
    }).toThrow(/already registered/iu)
  })

  it('lists registered effect types sorted', () => {
    expect(listEffectTypes()).toEqual([
      'accessEnemyData',
      'attackSlots',
      'attackStat',
      'balancedGenerators',
      'baseModifier',
      'batteryBand',
      'batteryStat',
      'dominantGenerator',
      'enemyCostModifier',
      'enemyProductionModifier',
      'generatorCost',
      'generatorUnlock',
      'highlightMultiplier',
      'lowerTierBoost',
      'panelUnlock',
      'relativeModifier',
      'stealGenerator',
      'stealResource',
      'systemUnlock',
      'timeFactorBoost',
      'timeRetroactive',
      'timeScaledModifier',
      'unlockAttack',
      'unlockPact',
    ])
  })

  // Pins the dynamic set so adding/removing the flag is a deliberate, reviewed
  // change: a new state-scaling effect that forgets `dynamic: true` never shows
  // in the data panel's live-bonuses section, with no other signal. Note the
  // criterion is the *value* moving, not merely reading state — e.g.
  // `highlightMultiplier` reads state to pick a field but its ×N is fixed, so
  // it is intentionally absent here.
  it('pins which effects are dynamic', () => {
    expect(listEffectTypes().filter(isDynamicEffect)).toEqual([
      'balancedGenerators',
      'dominantGenerator',
      'lowerTierBoost',
      'relativeModifier',
      'timeScaledModifier',
    ])
  })
})

// ─── highlightMultiplier param validation ────────────────────────────

describe('highlightMultiplier params', () => {
  function applyHighlight(ref: EffectRef): unknown {
    const mode = getModeDefinition('idler')
    const state = createInitialState(mode)
    return applyEffect(ref, state, mode)
  }

  it('rejects a multiplier less than or equal to 1', () => {
    expect(() => applyHighlight({ type: 'highlightMultiplier', multiplier: 1 })).toThrow(
      /multiplier/u,
    )
  })

  it('rejects a non-finite multiplier', () => {
    expect(() => applyHighlight({ type: 'highlightMultiplier', multiplier: Infinity })).toThrow(
      /multiplier/u,
    )
  })

  it('rejects a non-number multiplier', () => {
    expect(() => applyHighlight({ type: 'highlightMultiplier', multiplier: 'x' })).toThrow(
      /multiplier/u,
    )
  })

  it('rejects unknown params (strict schema)', () => {
    expect(() =>
      applyHighlight({ type: 'highlightMultiplier', multiplier: 2, boostUpgradeId: 'uh2' }),
    ).toThrow()
  })
})

// ─── Golden parity: highlight behavior must match the pre-effect closure ──

describe('highlightMultiplier behavior (golden)', () => {
  function idlerState(): PlayerState {
    return createInitialState(getModeDefinition('idler'))
  }

  it('emits no highlight multiplier before the unlock upgrade is owned', () => {
    const def = getModeDefinition('idler')
    const state = idlerState()
    const mods = collectModifiers(state, def)
    expect(mods.some((m) => m.stage === 'multiplicative')).toBe(false)
  })

  it('doubles the highlighted resource (r0) once the unlock is owned', () => {
    const def = getModeDefinition('idler')
    const state = idlerState()
    state.upgrades['sh-unlock'] = 1
    state.meta.highlight = 'r0'
    const mods = collectModifiers(state, def)
    expect(mods).toContainEqual({ stage: 'multiplicative', field: 'r0', value: 2 })
  })

  it('follows the highlighted resource when it changes (r1)', () => {
    const def = getModeDefinition('idler')
    const state = idlerState()
    state.upgrades['sh-unlock'] = 1
    state.meta.highlight = 'r1'
    const mods = collectModifiers(state, def)
    expect(mods).toContainEqual({ stage: 'multiplicative', field: 'r1', value: 2 })
    expect(mods.some((m) => m.stage === 'multiplicative' && m.field === 'r0')).toBe(false)
  })

  it('contributes nothing when no resource is highlighted', () => {
    const def = getModeDefinition('idler')
    const state = idlerState()
    state.upgrades['sh-unlock'] = 1
    for (const highlight of [null, undefined]) {
      state.meta.highlight = highlight
      const mods = collectModifiers(state, def)
      expect(mods.some((m) => m.stage === 'multiplicative')).toBe(false)
    }
  })

  it('raises the highlight to ×2.2 once the boost upgrade (sh-mf-hp) is owned', () => {
    const def = getModeDefinition('idler')
    const state = idlerState()
    state.upgrades['sh-unlock'] = 1
    state.upgrades['sh-mf-hp'] = 1
    state.meta.highlight = 'r0'
    const mods = collectModifiers(state, def)
    // The boost is distributed: sh-unlock emits ×2 and sh-mf-hp emits ×1.1, stacking to ×2.2.
    expect(mods).toContainEqual({ stage: 'multiplicative', field: 'r0', value: 2 })
    expect(mods).toContainEqual({ stage: 'multiplicative', field: 'r0', value: 1.1 })
    const r0Factor = mods
      .filter((m) => m.stage === 'multiplicative' && m.field === 'r0')
      .reduce((acc, m) => acc * m.value, 1)
    expect(r0Factor).toBeCloseTo(2.2)
  })

  it('compounds the highlight boost across repeated purchases of sh-mf-hp', () => {
    const def = getModeDefinition('idler')
    const state = idlerState()
    state.upgrades['sh-unlock'] = 1
    state.upgrades['sh-mf-hp'] = 2
    state.meta.highlight = 'r0'
    const mods = collectModifiers(state, def)
    const r0Factor = mods
      .filter((m) => m.stage === 'multiplicative' && m.field === 'r0')
      .reduce((acc, m) => acc * m.value, 1)
    expect(r0Factor).toBeCloseTo(2.42)
  })

  it('applies the ×2.2 boost to the highlighted resource when it changes (r1)', () => {
    const def = getModeDefinition('idler')
    const state = idlerState()
    state.upgrades['sh-unlock'] = 1
    state.upgrades['sh-mf-hp'] = 1
    state.meta.highlight = 'r1'
    const mods = collectModifiers(state, def)
    const r1Factor = mods
      .filter((m) => m.stage === 'multiplicative' && m.field === 'r1')
      .reduce((acc, m) => acc * m.value, 1)
    expect(r1Factor).toBeCloseTo(2.2)
    expect(mods.some((m) => m.stage === 'multiplicative' && m.field === 'r0')).toBe(false)
  })

  it('does not boost when sh-mf-hp is owned but the unlock (sh-unlock) is not', () => {
    const def = getModeDefinition('idler')
    const state = idlerState()
    state.upgrades['sh-mf-hp'] = 1
    state.meta.highlight = 'r0'
    const mods = collectModifiers(state, def)
    // sh-mf-hp's ×1.1 still applies (it gates on its own ownership), but the ×2 base
    // is absent without sh-unlock — and sh-mf-hp's prerequisite makes this unreachable in play.
    expect(mods.some((m) => m.stage === 'multiplicative' && m.value === 2)).toBe(false)
  })
})

// ─── collectModifiers effect wiring ──────────────────────────────────

describe('collectModifiers effect wiring', () => {
  it('rejects a baseModifier with a non-positive value', () => {
    const base = getModeDefinition('idler')
    expect(() =>
      applyEffect(
        { type: 'baseModifier', stage: 'multiplicative', field: 'r0', value: 0 },
        createInitialState(base),
        base,
      ),
    ).toThrow(/value/u)
  })

  it('rejects a multiplicative baseModifier that is a no-op or self-penalty', () => {
    const base = getModeDefinition('idler')
    for (const value of [1, 0.5]) {
      expect(() =>
        applyEffect(
          { type: 'baseModifier', stage: 'multiplicative', field: 'r0', value },
          createInitialState(base),
          base,
        ),
      ).toThrow(/value/u)
    }
  })

  it('rejects a non-positive additive baseModifier but accepts a positive one', () => {
    const base = getModeDefinition('idler')
    expect(() =>
      applyEffect(
        { type: 'baseModifier', stage: 'additive', field: 'r0', value: -1 },
        createInitialState(base),
        base,
      ),
    ).toThrow(/value/u)
    expect(
      applyEffect(
        { type: 'baseModifier', stage: 'additive', field: 'r0', value: 0.5 },
        createInitialState(base),
        base,
      ),
    ).toEqual({ kind: 'baseModifier', stage: 'additive', field: 'r0', value: 0.5 })
  })

  it('rejects a relativeModifier with a non-positive factor', () => {
    const base = getModeDefinition('idler')
    expect(() =>
      applyEffect(
        {
          type: 'relativeModifier',
          source: 'resource:r0',
          field: 'r0',
          stage: 'multiplicative',
          factor: 0,
        },
        createInitialState(base),
        base,
      ),
    ).toThrow(/factor/u)
  })

  it('applies per-upgrade effects only when the upgrade is owned', () => {
    const base = getModeDefinition('idler')
    const customUpgrade: UpgradeDefinition = {
      id: 'uEffect',
      cost: { r0: { baseCost: 10 } },
      purchaseLimit: 1, // Gated by placement: per-upgrade effects run only once `uEffect` is owned.
      effects: [{ type: 'highlightMultiplier', multiplier: 3 }],
    }
    const def: ModeDefinition = { ...base, upgrades: [...base.upgrades, customUpgrade] }

    const owned = createInitialState(def)
    owned.upgrades.uEffect = 1
    owned.meta.highlight = 'r1'
    expect(collectModifiers(owned, def)).toContainEqual({
      stage: 'multiplicative',
      field: 'r1',
      value: 3,
    })

    const unowned = createInitialState(def)
    unowned.meta.highlight = 'r1'
    expect(collectModifiers(unowned, def).some((m) => m.value === 3)).toBe(false)
  })

  it('routes generator-targeted effect modifiers into generator output', () => {
    const def = getModeDefinition('idler')
    const sumAdditive = (
      mods: readonly { field: string; stage: string; value: number }[],
      f: string,
    ) =>
      mods.filter((m) => m.field === f && m.stage === 'additive').reduce((s, m) => s + m.value, 0)

    // Highlight a generator id (g1: produces r1 at rate 1) → sh-unlock's per-upgrade
    // highlight effect emits a g1-targeted ×2, which must fold into g1's output.
    const hi = createInitialState(def)
    hi.upgrades['sh-unlock'] = 1
    hi.generators.g1 = 1
    hi.meta.highlight = 'g1'
    const hiMods = collectModifiers(hi, def)

    const lo = createInitialState(def)
    lo.upgrades['sh-unlock'] = 1
    lo.generators.g1 = 1
    lo.meta.highlight = 'r0'
    const loMods = collectModifiers(lo, def)

    // The generator-targeted multiplier is consumed, never leaked as a standalone
    // modifier on the generator id.
    expect(hiMods.some((m) => m.field === 'g1')).toBe(false)
    // g1 (rate 1, owned 1) doubles: its r1 output gains exactly one extra unit.
    expect(sumAdditive(hiMods, 'r1')).toBe(sumAdditive(loMods, 'r1') + 1)
  })

  it('compounds a multiplicative baseModifier as value ** owned', () => {
    const base = getModeDefinition('idler')
    const up: UpgradeDefinition = {
      id: 'uMul',
      cost: { r0: { baseCost: 10 } },
      purchaseLimit: Infinity,
      effects: [{ type: 'baseModifier', stage: 'multiplicative', field: 'r0', value: 2 }],
    }
    const def: ModeDefinition = { ...base, upgrades: [...base.upgrades, up] }
    const state = createInitialState(def)
    state.upgrades.uMul = 3
    // 2 ** 3 = 8 — multiplicative bonuses compound with the upgrade's owned count.
    expect(collectModifiers(state, def)).toContainEqual({
      stage: 'multiplicative',
      field: 'r0',
      value: 8,
    })
  })

  it('folds a generator-targeted baseModifier into generator output (not leaked)', () => {
    const base = getModeDefinition('idler')
    const gen = base.generators[0]
    const up: UpgradeDefinition = {
      id: 'uGen',
      cost: { r0: { baseCost: 10 } },
      purchaseLimit: Infinity,
      effects: [{ type: 'baseModifier', stage: 'additive', field: gen.id, value: 3 }],
    }
    const def: ModeDefinition = { ...base, upgrades: [...base.upgrades, up] }
    const sumAdditive = (mods: readonly { field: string; stage: string; value: number }[]) =>
      mods
        .filter((m) => m.field === gen.production.resource && m.stage === 'additive')
        .reduce((s, m) => s + m.value, 0)

    const withUp = createInitialState(def)
    withUp.upgrades.uGen = 2
    withUp.generators[gen.id] = 4
    const withMods = collectModifiers(withUp, def)

    const without = createInitialState(def)
    without.generators[gen.id] = 4
    const withoutMods = collectModifiers(without, def)

    // The generator-targeted bonus is consumed, never leaked as a modifier on the
    // generator id itself.
    expect(withMods.some((m) => m.field === gen.id)).toBe(false)
    // per-unit (3) × upgrade owned (2) × generator owned (4) = 24 extra production.
    expect(sumAdditive(withMods) - sumAdditive(withoutMods)).toBe(24)
  })

  it('applies mode-level effects regardless of upgrade ownership', () => {
    const base = getModeDefinition('idler')
    // A mode-level effect is ungated by upgrade ownership — it always runs.
    const def: ModeDefinition = {
      ...base,
      effects: [...(base.effects ?? []), { type: 'highlightMultiplier', multiplier: 5 }],
    }
    const state = createInitialState(def)
    state.meta.highlight = 'r0'
    expect(collectModifiers(state, def)).toContainEqual({
      stage: 'multiplicative',
      field: 'r0',
      value: 5,
    })
  })

  it('applies a mode-level baseModifier exactly once (owned defaults to 1)', () => {
    const base = getModeDefinition('idler')
    // Mode-level effects carry no owning-upgrade count, so a baseModifier there
    // applies with an implicit count of 1 (`owned ?? 1`) rather than being dropped.
    const def: ModeDefinition = {
      ...base,
      effects: [
        ...(base.effects ?? []),
        { type: 'baseModifier', stage: 'multiplicative', field: 'r0', value: 7 },
      ],
    }
    const state = createInitialState(def)
    expect(collectModifiers(state, def)).toContainEqual({
      stage: 'multiplicative',
      field: 'r0',
      value: 7,
    })
  })
})

// ─── enemyProductionModifier stage-aware guard ───────────────────────

describe('enemyProductionModifier params', () => {
  function apply(ref: EffectRef): unknown {
    const mode = getModeDefinition('idler')
    return applyEffect(ref, createInitialState(mode), mode)
  }

  it('accepts a multiplicative debuff in (0, 1) but rejects a no-op or enemy buff', () => {
    expect(
      apply({ type: 'enemyProductionModifier', stage: 'multiplicative', field: 'r0', value: 0.9 }),
    ).toEqual({
      kind: 'enemyModifier',
      modifier: { stage: 'multiplicative', field: 'r0', value: 0.9 },
    })
    for (const value of [1, 1.5, 0]) {
      expect(() =>
        apply({ type: 'enemyProductionModifier', stage: 'multiplicative', field: 'r0', value }),
      ).toThrow(/value/u)
    }
  })

  it('accepts a negative additive debuff but rejects a non-negative one', () => {
    expect(
      apply({ type: 'enemyProductionModifier', stage: 'additive', field: 'r0', value: -2 }),
    ).toEqual({
      kind: 'enemyModifier',
      modifier: { stage: 'additive', field: 'r0', value: -2 },
    })
    for (const value of [0, 1]) {
      expect(() =>
        apply({ type: 'enemyProductionModifier', stage: 'additive', field: 'r0', value }),
      ).toThrow(/value/u)
    }
  })
})

// ─── enemyCostModifier ───────────────────────────────────────────────

describe('enemyCostModifier params', () => {
  function apply(ref: EffectRef): unknown {
    const mode = getModeDefinition('idler')
    return applyEffect(ref, createInitialState(mode), mode)
  }

  it('splits a whole-scope target into scope + no id', () => {
    expect(apply({ type: 'enemyCostModifier', target: 'upgrades', costFactor: 1.25 })).toEqual({
      kind: 'enemyCost',
      scope: 'upgrade',
      id: undefined,
      costFactor: 1.25,
      scalingFactor: undefined,
    })
    expect(apply({ type: 'enemyCostModifier', target: 'generators', scalingFactor: 1.1 })).toEqual({
      kind: 'enemyCost',
      scope: 'generator',
      id: undefined,
      costFactor: undefined,
      scalingFactor: 1.1,
    })
  })

  it('splits a namespaced target into scope + id', () => {
    expect(apply({ type: 'enemyCostModifier', target: 'generator:g0', costFactor: 2 })).toEqual({
      kind: 'enemyCost',
      scope: 'generator',
      id: 'g0',
      costFactor: 2,
      scalingFactor: undefined,
    })
  })

  // An attack that discounts the victim is never intended authoring — the same
  // reasoning as `guardModifierValue`'s debuff intent, in the other direction.
  it('rejects a factor below 1 (a gift, not an attack)', () => {
    for (const params of [{ costFactor: 0.9 }, { scalingFactor: 0.5 }]) {
      expect(() => apply({ type: 'enemyCostModifier', target: 'upgrades', ...params })).toThrow()
    }
  })

  it('rejects a ref that sets neither factor (inert)', () => {
    expect(() => apply({ type: 'enemyCostModifier', target: 'upgrades' })).toThrow(/costFactor/u)
  })

  // `validateModeDefinition` rejects this at boot; `apply` still has to stay
  // inert rather than emit an output naming nothing.
  it('is inert on an unparseable target', () => {
    expect(apply({ type: 'enemyCostModifier', target: 'nope', costFactor: 1.5 })).toBeNull()
  })
})

// ─── Generator synergy effects ───────────────────────────────────────

describe('lowerTierBoost effect', () => {
  it('rejects a non-positive perUnit value', () => {
    const mode = getModeDefinition('idler')
    expect(() =>
      applyEffect({ type: 'lowerTierBoost', perUnit: 0 }, createInitialState(mode), mode),
    ).toThrow(/perUnit/u)
  })

  it('boosts higher tiers by the units owned in lower tiers', () => {
    const mode = getModeDefinition('idler')
    const state = createInitialState(mode)
    const [g0, g1] = mode.generators.map((g) => g.id)
    state.generators[g0] = 2
    state.generators[g1] = 3
    const out = applyEffect({ type: 'lowerTierBoost', perUnit: 0.1 }, state, mode) as Modifier[]
    // g1's two lower-tier units → ×(1 + 0.1 * 2) = ×1.2
    expect(out).toContainEqual({ stage: 'multiplicative', field: g1, value: 1.2 })
    // g0 has no lower tier to draw from.
    expect(out.some((m) => m.field === g0)).toBe(false)
  })

  it('emits nothing when no lower-tier units are owned', () => {
    const mode = getModeDefinition('idler')
    const out = applyEffect({ type: 'lowerTierBoost', perUnit: 1 }, createInitialState(mode), mode)
    expect(out).toEqual([])
  })
})

describe('dominantGenerator effect', () => {
  it('rejects a multiplier less than or equal to 1', () => {
    const mode = getModeDefinition('idler')
    expect(() =>
      applyEffect({ type: 'dominantGenerator', multiplier: 1 }, createInitialState(mode), mode),
    ).toThrow(/multiplier/u)
  })

  it('boosts only the single generator at the maximum owned count', () => {
    const mode = getModeDefinition('idler')
    const state = createInitialState(mode)
    const [g0, g1] = mode.generators.map((g) => g.id)
    state.generators[g0] = 5
    state.generators[g1] = 4
    const out = applyEffect({ type: 'dominantGenerator', multiplier: 3 }, state, mode) as Modifier[]
    expect(out).toEqual([{ stage: 'multiplicative', field: g0, value: 3 }])
  })

  it('breaks ties at the maximum by definition order, boosting only the earliest generator', () => {
    const mode = getModeDefinition('idler')
    const state = createInitialState(mode)
    const [g0, g1] = mode.generators.map((g) => g.id)
    state.generators[g0] = 5
    state.generators[g1] = 5
    const out = applyEffect({ type: 'dominantGenerator', multiplier: 3 }, state, mode) as Modifier[]
    expect(out).toEqual([{ stage: 'multiplicative', field: g0, value: 3 }])
  })

  it('returns null when no generators are owned', () => {
    const mode = getModeDefinition('idler')
    expect(
      applyEffect({ type: 'dominantGenerator', multiplier: 3 }, createInitialState(mode), mode),
    ).toBeNull()
  })
})

describe('balancedGenerators effect', () => {
  it('rejects a multiplier less than or equal to 1', () => {
    const mode = getModeDefinition('idler')
    expect(() =>
      applyEffect({ type: 'balancedGenerators', multiplier: 1 }, createInitialState(mode), mode),
    ).toThrow(/multiplier/u)
  })

  it('emits a per-resource multiplicative bonus when all generators are owned equally', () => {
    const mode = getModeDefinition('idler')
    const state = createInitialState(mode)
    for (const gen of mode.generators) state.generators[gen.id] = 4
    expect(applyEffect({ type: 'balancedGenerators', multiplier: 2 }, state, mode)).toEqual(
      mode.resources.map((resource) => ({
        stage: 'multiplicative',
        field: resource,
        value: 2,
      })),
    )
  })

  it('scales the bonus when generator ownership is partially balanced', () => {
    const mode = getModeDefinition('idler')
    const state = createInitialState(mode)
    // All generators equal except one unowned. Derive the expected value from
    // the generator count so the test survives adding/removing generators.
    const ids = mode.generators.map((gen) => gen.id)
    for (const id of ids) state.generators[id] = 2
    state.generators[ids[ids.length - 1]] = 0

    const n = ids.length
    const avg = (2 * (n - 1)) / n
    const deviation = (Math.abs(2 - avg) * (n - 1) + avg) / n
    const balanceRatio = 1 - deviation / avg
    const expected = 1 + balanceRatio * (2 - 1)

    expect(applyEffect({ type: 'balancedGenerators', multiplier: 2 }, state, mode)).toEqual(
      mode.resources.map((resource) => ({
        stage: 'multiplicative',
        field: resource,
        value: expected,
      })),
    )
  })

  it('returns null when ownership is too skewed for any bonus', () => {
    const mode = getModeDefinition('idler')
    const state = createInitialState(mode)
    // A single generator carrying everything drives balanceRatio to <= 0.
    state.generators[mode.generators[0].id] = 10
    expect(applyEffect({ type: 'balancedGenerators', multiplier: 2 }, state, mode)).toBeNull()
  })

  it('returns null when no generators are owned', () => {
    const mode = getModeDefinition('idler')
    expect(
      applyEffect({ type: 'balancedGenerators', multiplier: 2 }, createInitialState(mode), mode),
    ).toBeNull()
  })
})

describe('generatorCost effect', () => {
  it('rejects a generatorCost with a non-positive factor', () => {
    const mode = getModeDefinition('idler')
    expect(() =>
      applyEffect(
        { type: 'generatorCost', generator: mode.generators[0].id, costFactor: 0 },
        createInitialState(mode),
        mode,
      ),
    ).toThrow(/costFactor/u)
  })

  it('emits a generatorCost output carrying both factors', () => {
    const mode = getModeDefinition('idler')
    const gen = mode.generators[0].id
    expect(
      applyEffect(
        { type: 'generatorCost', generator: gen, costFactor: 0.95, scalingFactor: 0.98 },
        createInitialState(mode),
        mode,
      ),
    ).toEqual({ kind: 'generatorCost', generator: gen, costFactor: 0.95, scalingFactor: 0.98 })
  })

  it('is ignored by the production pipeline (collectModifiers drops cost outputs)', () => {
    const base = getModeDefinition('idler')
    const gen = base.generators[0].id
    const withEffect: ModeDefinition = {
      ...base,
      effects: [
        ...(base.effects ?? []),
        { type: 'generatorCost', generator: gen, costFactor: 0.5 },
      ],
    }
    const state = createInitialState(withEffect)
    expect(collectModifiers(state, withEffect)).toEqual(collectModifiers(state, base))
  })
})

describe('panelUnlock effect', () => {
  it('emits a panelUnlock output naming the panel', () => {
    const mode = getModeDefinition('idler')
    expect(
      applyEffect({ type: 'panelUnlock', panel: 'generators' }, createInitialState(mode), mode),
    ).toEqual({ kind: 'panelUnlock', panel: 'generators' })
  })

  it('is ignored by the production pipeline', () => {
    const base = getModeDefinition('idler')
    const withEffect: ModeDefinition = {
      ...base,
      effects: [...(base.effects ?? []), { type: 'panelUnlock', panel: 'generators' }],
    }
    const state = createInitialState(withEffect)
    expect(collectModifiers(state, withEffect)).toEqual(collectModifiers(state, base))
  })
})

describe('generatorUnlock effect', () => {
  it('emits a generatorUnlock output naming the generator', () => {
    const mode = getModeDefinition('idler')
    expect(
      applyEffect({ type: 'generatorUnlock', generator: 'g1' }, createInitialState(mode), mode),
    ).toEqual({ kind: 'generatorUnlock', generator: 'g1' })
  })

  it('is ignored by the production pipeline', () => {
    const base = getModeDefinition('idler')
    const withEffect: ModeDefinition = {
      ...base,
      effects: [...(base.effects ?? []), { type: 'generatorUnlock', generator: 'g1' }],
    }
    const state = createInitialState(withEffect)
    expect(collectModifiers(state, withEffect)).toEqual(collectModifiers(state, base))
  })
})

describe('systemUnlock effect', () => {
  it('emits a systemUnlock output naming the system', () => {
    const mode = getModeDefinition('idler')
    expect(
      applyEffect({ type: 'systemUnlock', system: 'click' }, createInitialState(mode), mode),
    ).toEqual({ kind: 'systemUnlock', system: 'click' })
  })

  it('is ignored by the production pipeline', () => {
    const base = getModeDefinition('idler')
    const withEffect: ModeDefinition = {
      ...base,
      effects: [...(base.effects ?? []), { type: 'systemUnlock', system: 'highlight' }],
    }
    const state = createInitialState(withEffect)
    expect(collectModifiers(state, withEffect)).toEqual(collectModifiers(state, base))
  })

  it('rejects a system outside the unlockable set (closed enum)', () => {
    const mode = getModeDefinition('idler')
    expect(() =>
      applyEffect({ type: 'systemUnlock', system: 'highlite' }, createInitialState(mode), mode),
    ).toThrow()
  })
})

describe('unlockAttack effect', () => {
  /** Extend idler with an upgrade whose `unlockAttack` effect names `attackId`. */
  function modeWithAttackUpgrade(upgradeId: string, attackId: string): ModeDefinition {
    const base = getModeDefinition('idler')
    const upgrade: UpgradeDefinition = {
      id: upgradeId,
      cost: { r0: { baseCost: 10 } },
      purchaseLimit: 1,
      effects: [{ type: 'unlockAttack', attack: attackId }],
    }
    return { ...base, upgrades: [...base.upgrades, upgrade] }
  }

  it('emits an attackUnlock output naming the attack', () => {
    const mode = getModeDefinition('idler')
    expect(
      applyEffect({ type: 'unlockAttack', attack: 'a0' }, createInitialState(mode), mode),
    ).toEqual({ kind: 'attackUnlock', attack: 'a0' })
  })

  it('is ignored by the production pipeline', () => {
    const base = getModeDefinition('idler')
    const withEffect: ModeDefinition = {
      ...base,
      effects: [...(base.effects ?? []), { type: 'unlockAttack', attack: 'a0' }],
    }
    const state = createInitialState(withEffect)
    expect(collectModifiers(state, withEffect)).toEqual(collectModifiers(state, base))
  })

  it('gates the attack on owning the unlocking upgrade (hidden by default)', () => {
    const mode = modeWithAttackUpgrade('atk-unlock', 'a0')

    const locked = createInitialState(mode)
    expect(isAttackUnlocked(locked, mode, 'a0')).toBe(false)
    expect(unlockedAttacks(locked, mode)).toEqual([])

    const unlocked = createInitialState(mode)
    unlocked.upgrades['atk-unlock'] = 1
    expect(isAttackUnlocked(unlocked, mode, 'a0')).toBe(true)
    expect(unlockedAttacks(unlocked, mode)).toEqual(['a0'])
  })

  it('reports an attack no upgrade names as locked', () => {
    const mode = getModeDefinition('idler')
    expect(isAttackUnlocked(createInitialState(mode), mode, 'nope')).toBe(false)
  })
})

// ─── attackStat param validation ─────────────────────────────────────

describe('attackStat params', () => {
  const mode = getModeDefinition('idler')
  const state = createInitialState(mode)

  it('echoes the authored adjustment, attack included', () => {
    expect(
      applyEffect(
        { type: 'attackStat', attack: 'a0', stat: 'power', op: 'mult', value: 2 },
        state,
        mode,
      ),
    ).toEqual({ kind: 'attackStat', attack: 'a0', stat: 'power', op: 'mult', value: 2 })
  })

  it('omits the attack key entirely when none is authored', () => {
    expect(
      applyEffect({ type: 'attackStat', stat: 'power', op: 'add', value: 1 }, state, mode),
    ).toEqual({ kind: 'attackStat', stat: 'power', op: 'add', value: 1 })
  })

  it('rejects an unknown stat', () => {
    expect(() =>
      applyEffect({ type: 'attackStat', stat: 'nope', op: 'add', value: 1 }, state, mode),
    ).toThrow()
  })

  it('accepts the duration stat, factor and offset alike (plan 37)', () => {
    expect(
      applyEffect({ type: 'attackStat', stat: 'duration', op: 'mult', value: 2 }, state, mode),
    ).toEqual({ kind: 'attackStat', attack: undefined, stat: 'duration', op: 'mult', value: 2 })
    expect(
      applyEffect({ type: 'attackStat', stat: 'duration', op: 'offset', value: 3 }, state, mode),
    ).toEqual({ kind: 'attackStat', attack: undefined, stat: 'duration', op: 'offset', value: 3 })
  })

  it('rejects a duration stat pointing the wrong way — a shorter window helps nobody', () => {
    for (const ref of [
      { stat: 'duration', op: 'mult', value: 0.5 },
      { stat: 'duration', op: 'add', value: -0.2 },
      { stat: 'duration', op: 'offset', value: -1 },
    ]) {
      expect(() => applyEffect({ type: 'attackStat', ...ref }, state, mode)).toThrow(/duration/u)
    }
  })

  it('rejects an unknown op', () => {
    expect(() =>
      applyEffect({ type: 'attackStat', stat: 'power', op: 'divide', value: 2 }, state, mode),
    ).toThrow()
  })

  // `offset` is the absolute op — seconds, on the one stat measured in them.
  it('accepts an offset on prepareTime', () => {
    expect(
      applyEffect(
        { type: 'attackStat', stat: 'prepareTime', op: 'offset', value: -1 },
        state,
        mode,
      ),
    ).toEqual({ kind: 'attackStat', stat: 'prepareTime', op: 'offset', value: -1 })
  })

  it('rejects an offset on a stat with no single unit', () => {
    // `power` has no unit (fraction / amount / count / debuff distance) and
    // `prepareCost` has one per currency, so neither can take a flat shift.
    expect(() =>
      applyEffect({ type: 'attackStat', stat: 'power', op: 'offset', value: 1 }, state, mode),
    ).toThrow(/does not apply to stat 'power'/u)
    expect(() =>
      applyEffect(
        { type: 'attackStat', stat: 'prepareCost', op: 'offset', value: -100 },
        state,
        mode,
      ),
    ).toThrow(/does not apply to stat 'prepareCost'/u)
  })

  it('rejects a non-numeric value', () => {
    expect(() =>
      applyEffect({ type: 'attackStat', stat: 'power', op: 'mult', value: 'lots' }, state, mode),
    ).toThrow()
  })

  it('is ignored by the production pipeline', () => {
    const withEffect: ModeDefinition = {
      ...mode,
      effects: [
        ...(mode.effects ?? []),
        { type: 'attackStat', stat: 'power', op: 'mult', value: 2 },
      ],
    }
    const fresh = createInitialState(withEffect)
    expect(collectModifiers(fresh, withEffect)).toEqual(collectModifiers(fresh, mode))
  })
})

// ─── attackStat value direction ──────────────────────────────────────
//
// The stat decides which way its value has to move: an upgrade-hosted effect
// helps the player who bought it (`baseModifier` is guarded the same way), so
// `power` may only grow and `prepareCost`/`prepareTime` may only shrink. Every
// op's neutral point is excluded with it, which is what makes an upgrade that
// buys nothing an error rather than a disappointment.

describe('attackStat value direction', () => {
  const mode = getModeDefinition('idler')
  const state = createInitialState(mode)

  const attempt = (stat: string, op: string, value: unknown): (() => unknown) => {
    return () => applyEffect({ type: 'attackStat', stat, op, value }, state, mode)
  }

  it('lets an increasing stat only increase', () => {
    expect(attempt('power', 'mult', 1.5)).not.toThrow()
    expect(attempt('power', 'add', 0.5)).not.toThrow()
    expect(attempt('power', 'mult', 0.5)).toThrow(/improved by increasing it/u)
    expect(attempt('power', 'add', -0.5)).toThrow(/improved by increasing it/u)
  })

  it('lets a decreasing stat only decrease', () => {
    expect(attempt('prepareTime', 'mult', 0.5)).not.toThrow()
    expect(attempt('prepareTime', 'add', -0.5)).not.toThrow()
    expect(attempt('prepareTime', 'offset', -1)).not.toThrow()
    expect(attempt('prepareCost', 'mult', 0.5)).not.toThrow()
    // The self-nerfs: each is authorable arithmetic and each makes your own
    // attack worse, which is the whole reason the direction is checked.
    expect(attempt('prepareTime', 'mult', 2)).toThrow(/improved by decreasing it/u)
    expect(attempt('prepareTime', 'offset', 2)).toThrow(/improved by decreasing it/u)
    expect(attempt('prepareCost', 'add', 0.5)).toThrow(/improved by decreasing it/u)
  })

  it('rejects every neutral point — an upgrade must buy something', () => {
    expect(attempt('power', 'mult', 1)).toThrow(/got 1/u)
    expect(attempt('power', 'add', 0)).toThrow(/got 0/u)
    expect(attempt('prepareTime', 'mult', 1)).toThrow(/got 1/u)
    expect(attempt('prepareTime', 'offset', 0)).toThrow(/got 0/u)
  })

  it('rejects a mult at or below zero, whichever way the stat moves', () => {
    // `0` collapses the stat for every owned count and no later upgrade lifts it
    // back; a negative base flips sign with the parity of the owned count.
    expect(attempt('power', 'mult', 0)).toThrow()
    expect(attempt('power', 'mult', -2)).toThrow()
    expect(attempt('prepareCost', 'mult', 0)).toThrow()
    expect(attempt('prepareCost', 'mult', -0.5)).toThrow()
  })

  it('bounds a reducing add at -1, where one copy already zeroes the stat', () => {
    expect(attempt('prepareCost', 'add', -0.999)).not.toThrow()
    expect(attempt('prepareCost', 'add', -1)).toThrow(/between -1 and 0/u)
    expect(attempt('prepareCost', 'add', -1.5)).toThrow(/between -1 and 0/u)
  })

  it('refuses an implausible magnitude — a slipped exponent compounds', () => {
    expect(attempt('power', 'mult', 1e6)).not.toThrow()
    expect(attempt('power', 'mult', 1e7)).toThrow(/implausibly large/u)
    expect(attempt('power', 'add', 1e200)).toThrow(/implausibly large/u)
  })

  it('reports the pairing before the value, so the range quoted is the real one', () => {
    // `offset` is illegal on `power` whatever the number; quoting a range for an
    // op the stat cannot use would send the author after the wrong field.
    expect(attempt('power', 'offset', -1)).toThrow(/does not apply to stat 'power'/u)
  })

  it('covers every stat, so a new one cannot ship without a direction', () => {
    for (const stat of ATTACK_STATS) {
      const direction = ATTACK_STAT_DIRECTION[stat]
      expect(direction).toBeDefined()
      // The neutral multiplier is rejected for every stat, whichever way it
      // moves — the cheapest proof that the guard is wired to this stat at all.
      expect(attempt(stat, 'mult', 1)).toThrow()
      expect(attempt(stat, 'mult', direction === 'increase' ? 2 : 0.5)).not.toThrow()
    }
  })
})

describe('unlockPact effect', () => {
  /** Extend idler with an upgrade whose `unlockPact` effect names `pactId`. */
  function modeWithPactUpgrade(upgradeId: string, pactId: string): ModeDefinition {
    const base = getModeDefinition('idler')
    const upgrade: UpgradeDefinition = {
      id: upgradeId,
      cost: { r0: { baseCost: 10 } },
      purchaseLimit: 1,
      effects: [{ type: 'unlockPact', pact: pactId }],
    }
    return { ...base, upgrades: [...base.upgrades, upgrade] }
  }

  it('emits a pactUnlock output naming the pact', () => {
    const mode = getModeDefinition('idler')
    expect(applyEffect({ type: 'unlockPact', pact: 'p0' }, createInitialState(mode), mode)).toEqual(
      { kind: 'pactUnlock', pact: 'p0' },
    )
  })

  it('is ignored by the production pipeline', () => {
    const base = getModeDefinition('idler')
    const withEffect: ModeDefinition = {
      ...base,
      effects: [...(base.effects ?? []), { type: 'unlockPact', pact: 'p0' }],
    }
    const state = createInitialState(withEffect)
    expect(collectModifiers(state, withEffect)).toEqual(collectModifiers(state, base))
  })

  it('gates the pact on owning the unlocking upgrade (hidden by default)', () => {
    const mode = modeWithPactUpgrade('pact-unlock', 'p0')

    const locked = createInitialState(mode)
    expect(isPactUnlocked(locked, mode, 'p0')).toBe(false)
    expect(unlockedPacts(locked, mode)).toEqual([])

    const unlocked = createInitialState(mode)
    unlocked.upgrades['pact-unlock'] = 1
    expect(isPactUnlocked(unlocked, mode, 'p0')).toBe(true)
    expect(unlockedPacts(unlocked, mode)).toEqual(['p0'])
  })

  it('reports a pact no upgrade names as locked', () => {
    const mode = getModeDefinition('idler')
    expect(isPactUnlocked(createInitialState(mode), mode, 'nope')).toBe(false)
  })
})

// ─── Unlock gates granted by the mode's starting effects ─────────────
//
// The unlock family is legal on both hosts (`DEFAULT_EFFECT_HOSTS`), so an unlock
// authored in a tree's `startingEffects` must actually grant — with no owning
// upgrade, it grants unconditionally for the whole round. Each case below pairs
// the grant with the un-granted baseline, so it can only pass because the
// mode-level effect was read (not because the gate defaults open).

describe('unlock gates granted by mode-level starting effects', () => {
  /**
   * Idler with its own `startingEffects` cleared: the un-granted baseline. Its
   * upgrade gates are kept (they're what makes each gate start closed), but the
   * mode-level list is emptied so these tests assert the mechanism rather than
   * whatever the evolving tree happens to author there.
   */
  function baseline(): ModeDefinition {
    return { ...getModeDefinition('idler'), effects: [] }
  }

  /** The baseline plus `refs` as its mode-level starting effects. */
  function withStarting(...refs: EffectRef[]): ModeDefinition {
    return { ...baseline(), effects: refs }
  }

  it('panelUnlock opens a panel an upgrade otherwise gates', () => {
    const base = baseline()
    // The idler tree gates the generators panel behind an upgrade, so an empty
    // state must not see it — this is the case a mode-level grant has to change.
    expect(isPanelUnlocked(createInitialState(base), base, 'generators')).toBe(false)

    const mode = withStarting({ type: 'panelUnlock', panel: 'generators' })
    expect(isPanelUnlocked(createInitialState(mode), mode, 'generators')).toBe(true)
  })

  it('generatorUnlock opens a generator an upgrade otherwise gates', () => {
    const base = baseline()
    const gated = base.generators.find(
      (g) => !isGeneratorUnlocked(createInitialState(base), g, base),
    )
    expect(gated).toBeDefined()

    const mode = withStarting({ type: 'generatorUnlock', generator: gated!.id })
    const unlocked = mode.generators.find((g) => g.id === gated!.id)!
    expect(isGeneratorUnlocked(createInitialState(mode), unlocked, mode)).toBe(true)
  })

  it('systemUnlock activates click, which an upgrade otherwise gates', () => {
    const base = baseline()
    expect(isClickUnlocked(createInitialState(base), base)).toBe(false)

    const mode = withStarting({ type: 'systemUnlock', system: 'click' })
    expect(isClickUnlocked(createInitialState(mode), mode)).toBe(true)
  })

  it('systemUnlock activates the highlight battery, which is hidden by default', () => {
    // The battery is the inverse default (no grant → hidden), and it implies an
    // active highlight, so the mode has to grant both.
    const base = baseline()
    expect(isHighlightBatteryActive(createInitialState(base), base)).toBe(false)

    const mode = withStarting(
      { type: 'systemUnlock', system: 'highlight' },
      { type: 'systemUnlock', system: 'highlightBattery' },
    )
    expect(isHighlightBatteryActive(createInitialState(mode), mode)).toBe(true)
  })

  it('unlockAttack grants an attack and lists it as unlocked', () => {
    const base = baseline()
    expect(isAttackUnlocked(createInitialState(base), base, 'a0')).toBe(false)

    const mode = withStarting({ type: 'unlockAttack', attack: 'a0' })
    const state = createInitialState(mode)
    expect(isAttackUnlocked(state, mode, 'a0')).toBe(true)
    expect(unlockedAttacks(state, mode)).toContain('a0')
  })

  it('unlockPact grants a pact and lists it as unlocked', () => {
    const base = baseline()
    expect(isPactUnlocked(createInitialState(base), base, 'p0')).toBe(false)

    const mode = withStarting({ type: 'unlockPact', pact: 'p0' })
    const state = createInitialState(mode)
    expect(isPactUnlocked(state, mode, 'p0')).toBe(true)
    expect(unlockedPacts(state, mode)).toContain('p0')
  })

  it('accessEnemyData grants an intel key that is hidden by default', () => {
    const base = baseline()
    expect(hasEnemyDataAccess(createInitialState(base), base, 'peakCps')).toBe(false)

    const mode = withStarting({ type: 'accessEnemyData', data: 'peakCps' })
    expect(hasEnemyDataAccess(createInitialState(mode), mode, 'peakCps')).toBe(true)
  })

  it('grants for the whole round — ownership never revokes a mode-level unlock', () => {
    const mode = withStarting({ type: 'panelUnlock', panel: 'generators' })
    const state = createInitialState(mode)
    // Nothing owned, everything owned: a grant with no owner is unconditional.
    expect(isPanelUnlocked(state, mode, 'generators')).toBe(true)
    for (const u of mode.upgrades) state.upgrades[u.id] = 1
    expect(isPanelUnlocked(state, mode, 'generators')).toBe(true)
  })

  it('leaves an unrelated gate of the same effect type closed', () => {
    // A mode-level grant must open only the key it names.
    const mode = withStarting({ type: 'panelUnlock', panel: 'somewhere-else' })
    expect(isPanelUnlocked(createInitialState(mode), mode, 'generators')).toBe(false)
  })
})

// ─── Multi-modifier array routing through collectModifiers ───────────

describe('collectModifiers routes multi-modifier effects', () => {
  const sumAdditive = (mods: readonly Modifier[], field: string): number =>
    mods.filter((m) => m.field === field && m.stage === 'additive').reduce((s, m) => s + m.value, 0)

  it('folds a synergy effect that returns several modifiers into generator output', () => {
    const base = getModeDefinition('idler')
    const [g0, g1] = base.generators.map((g) => g.id)
    const g1Resource = base.generators[1].production.resource

    const withEffect: ModeDefinition = {
      ...base,
      effects: [...(base.effects ?? []), { type: 'lowerTierBoost', perUnit: 1 }],
    }
    const boosted = createInitialState(withEffect)
    boosted.generators[g0] = 1
    boosted.generators[g1] = 1
    const boostedMods = collectModifiers(boosted, withEffect)

    const baseline = createInitialState(base)
    baseline.generators[g0] = 1
    baseline.generators[g1] = 1
    const baselineMods = collectModifiers(baseline, base)

    // g1 gains ×(1 + 1·1) = ×2, so its production resource output strictly increases.
    expect(sumAdditive(boostedMods, g1Resource)).toBeGreaterThan(
      sumAdditive(baselineMods, g1Resource),
    )
  })
})

// ─── relativeModifier effect ─────────────────────────────────────────

describe('relativeModifier effect', () => {
  function applyRel(ref: EffectRef, mutate?: (s: PlayerState) => void): unknown {
    const mode = getModeDefinition('idler')
    const state = createInitialState(mode)
    mutate?.(state)
    return applyEffect(ref, state, mode)
  }

  it('additive: feeds source × factor (factor defaults to 1)', () => {
    expect(
      applyRel(
        {
          type: 'relativeModifier',
          source: 'resource:r0',
          field: 'clickIncome',
          stage: 'additive',
        },
        (s) => {
          s.resources.r0 = 40
        },
      ),
    ).toEqual({ stage: 'additive', field: 'clickIncome', value: 40 })

    expect(
      applyRel(
        {
          type: 'relativeModifier',
          source: 'resource:r0',
          field: 'clickIncome',
          stage: 'additive',
          factor: 0.5,
        },
        (s) => {
          s.resources.r0 = 40
        },
      ),
    ).toEqual({ stage: 'additive', field: 'clickIncome', value: 20 })
  })

  it('multiplicative: feeds 1 + source × factor (so 0 source is a no-op, not a wipe)', () => {
    expect(
      applyRel(
        {
          type: 'relativeModifier',
          source: 'resource:r0',
          field: 'r1',
          stage: 'multiplicative',
          factor: 0.1,
        },
        (s) => {
          s.resources.r0 = 30
        },
      ),
    ).toEqual({ stage: 'multiplicative', field: 'r1', value: 4 })
  })

  it('reads meta:peakCps as a source (peak-CPS click bonus)', () => {
    expect(
      applyRel(
        {
          type: 'relativeModifier',
          source: 'meta:peakCps',
          field: 'clickIncome',
          stage: 'additive',
        },
        (s) => {
          s.meta.peakCps = 13
        },
      ),
    ).toEqual({ stage: 'additive', field: 'clickIncome', value: 13 })
  })

  it('is inactive (null) when the source is non-positive', () => {
    expect(
      applyRel(
        {
          type: 'relativeModifier',
          source: 'resource:r0',
          field: 'clickIncome',
          stage: 'additive',
        },
        (s) => {
          s.resources.r0 = 0
        },
      ),
    ).toBeNull() // empty stockpile → inactive
    expect(
      applyRel({
        type: 'relativeModifier',
        source: 'meta:peakCps',
        field: 'clickIncome',
        stage: 'additive',
      }),
    ).toBeNull() // no peakCps in meta
  })

  it('rejects malformed params (unknown key / bad stage)', () => {
    const mode = getModeDefinition('idler')
    const state = createInitialState(mode)
    expect(() =>
      applyEffect(
        { type: 'relativeModifier', source: 'resource:r0', field: 'clickIncome', stage: 'whoops' },
        state,
        mode,
      ),
    ).toThrow()
    expect(() =>
      applyEffect(
        {
          type: 'relativeModifier',
          source: 'resource:r0',
          field: 'clickIncome',
          stage: 'additive',
          extra: 1,
        },
        state,
        mode,
      ),
    ).toThrow()
  })

  it('rejects a non-positive factor on either stage but accepts a positive one', () => {
    for (const stage of ['additive', 'multiplicative'] as const) {
      for (const factor of [0, -1]) {
        expect(() =>
          applyRel({ type: 'relativeModifier', source: 'resource:r0', field: 'r0', stage, factor }),
        ).toThrow(/factor/u)
      }
    }
    expect(
      applyRel(
        {
          type: 'relativeModifier',
          source: 'resource:r0',
          field: 'clickIncome',
          stage: 'additive',
          factor: 2,
        },
        (s) => {
          s.resources.r0 = 10
        },
      ),
    ).toEqual({ stage: 'additive', field: 'clickIncome', value: 20 })
  })

  it('feeds a stockpile-relative bonus through collectModifiers when owned', () => {
    const base = getModeDefinition('idler')
    const customUpgrade: UpgradeDefinition = {
      id: 'uRel',
      cost: { r0: { baseCost: 10 } },
      purchaseLimit: 1,
      effects: [
        {
          type: 'relativeModifier',
          source: 'resource:r0',
          field: 'clickIncome',
          stage: 'additive',
          factor: 2,
        },
      ],
    }
    const def: ModeDefinition = { ...base, upgrades: [...base.upgrades, customUpgrade] }

    const owned = createInitialState(def)
    owned.upgrades.uRel = 1
    owned.resources.r0 = 25
    expect(collectModifiers(owned, def)).toContainEqual({
      stage: 'additive',
      field: 'clickIncome',
      value: 50,
    })
  })
})

// ─── relativeModifier validation (mode-aware catalog) ────────────────

describe('relativeModifier mode validation', () => {
  function withUpgrade(effect: EffectRef): ModeDefinition {
    const base = getModeDefinition('idler')
    const u: UpgradeDefinition = {
      id: 'uBad',
      cost: { r0: { baseCost: 1 } },
      purchaseLimit: 1,
      effects: [effect],
    }
    // Flavor validation runs first, so give every flavor an entry for the
    // test upgrade — otherwise it trips before the relativeModifier check.
    const flavors = base.flavors.map((f) => ({
      ...f,
      upgrades: [...f.upgrades, { id: 'uBad', name: 'Bad', icon: '?', description: '' }],
    }))
    return { ...base, upgrades: [...base.upgrades, u], flavors }
  }

  it('accepts catalog source/field keys', () => {
    expect(() => {
      validateModeDefinition(
        'idler',
        withUpgrade({
          type: 'relativeModifier',
          source: 'resource:r1',
          field: 'g0',
          stage: 'additive',
        }),
      )
    }).not.toThrow()
  })

  it('throws on an unknown source', () => {
    expect(() => {
      validateModeDefinition(
        'idler',
        withUpgrade({
          type: 'relativeModifier',
          source: 'resource:r9',
          field: 'clickIncome',
          stage: 'additive',
        }),
      )
    }).toThrow(/unknown source 'resource:r9'/u)
  })

  it('throws on an unknown target field', () => {
    expect(() => {
      validateModeDefinition(
        'idler',
        withUpgrade({
          type: 'relativeModifier',
          source: 'meta:peakCps',
          field: 'nope',
          stage: 'additive',
        }),
      )
    }).toThrow(/unknown field 'nope'/u)
  })
})

// ─── production-field validation (baseModifier) ───────────────────────

describe('production field mode validation', () => {
  function withUpgrade(effect: EffectRef): ModeDefinition {
    const base = getModeDefinition('idler')
    const u: UpgradeDefinition = {
      id: 'uProd',
      cost: { r0: { baseCost: 1 } },
      purchaseLimit: 1,
      effects: [effect],
    }
    const flavors = base.flavors.map((f) => ({
      ...f,
      upgrades: [...f.upgrades, { id: 'uProd', name: 'Prod', icon: '?', description: '' }],
    }))
    return { ...base, upgrades: [...base.upgrades, u], flavors }
  }

  it('accepts a base-producer field (bK)', () => {
    expect(() => {
      validateModeDefinition(
        'idler',
        withUpgrade({ type: 'baseModifier', field: 'b0', stage: 'additive', value: 1 }),
      )
    }).not.toThrow()
  })

  it('throws on an out-of-range base-producer field', () => {
    expect(() => {
      validateModeDefinition(
        'idler',
        withUpgrade({ type: 'baseModifier', field: 'b9', stage: 'additive', value: 1 }),
      )
    }).toThrow(/baseModifier targets unknown production field 'b9'/u)
  })

  it('throws on a baseModifier targeting an unknown field', () => {
    expect(() => {
      validateModeDefinition(
        'idler',
        withUpgrade({ type: 'baseModifier', field: 'nope', stage: 'additive', value: 1 }),
      )
    }).toThrow(/baseModifier targets unknown production field 'nope'/u)
  })

  it('throws on a mode-level baseModifier targeting an unknown field', () => {
    const base = getModeDefinition('idler')
    const def: ModeDefinition = {
      ...base,
      effects: [
        ...(base.effects ?? []),
        { type: 'baseModifier', stage: 'additive', field: 'b9', value: 1 },
      ],
    }
    expect(() => {
      validateModeDefinition('idler', def)
    }).toThrow(/mode-level baseModifier targets unknown production field 'b9'/u)
  })

  it('throws when a generator id collides with the base-producer namespace', () => {
    const base = getModeDefinition('idler')
    // Append a fresh generator whose id shadows the `bK` field namespace. Kept
    // in sync across every flavor so flavor validation doesn't trip first.
    const def: ModeDefinition = {
      ...base,
      generators: [
        ...base.generators,
        { id: 'b0', cost: { r0: { baseCost: 1 } }, production: { resource: 'r0', rate: 1 } },
      ],
      flavors: base.flavors.map((f) => ({
        ...f,
        generators: [...f.generators, { id: 'b0', name: 'Shadow', icon: '?' }],
      })),
    }
    expect(() => {
      validateModeDefinition('idler', def)
    }).toThrow(/collides with the base-producer field namespace/u)
  })
})

describe('accessEnemyData mode validation', () => {
  // Build an idler variant whose extra upgrade reveals `data`, with a matching
  // flavor upgrade entry so flavor validation doesn't trip before the intel
  // checks.
  function withAccess(data: string): ModeDefinition {
    const base = getModeDefinition('idler')
    const u: UpgradeDefinition = {
      id: 'uIntel',
      cost: { r0: { baseCost: 1 } },
      purchaseLimit: 1,
      effects: [{ type: 'accessEnemyData', data }],
    }
    const flavors = base.flavors.map((f) => ({
      ...f,
      upgrades: [...f.upgrades, { id: 'uIntel', name: 'Intel', icon: '?', description: '' }],
    }))
    return { ...base, upgrades: [...base.upgrades, u], flavors }
  }

  it('accepts the non-resource peak-CPS intel key', () => {
    expect(() => {
      validateModeDefinition('idler', withAccess('peakCps'))
    }).not.toThrow()
  })

  it('throws on an unknown resource key', () => {
    expect(() => {
      validateModeDefinition('idler', withAccess('r9'))
    }).toThrow(/unknown resource 'r9'/u)
  })

  it('throws if a resource key collides with a reserved intel key', () => {
    const base = getModeDefinition('idler')
    const def: ModeDefinition = {
      ...base,
      resources: [...base.resources, 'peakCps'],
      flavors: base.flavors.map((f) => ({
        ...f,
        resources: [...f.resources, { key: 'peakCps', displayName: 'X', icon: '?' }],
      })),
    }
    expect(() => {
      validateModeDefinition('idler', def)
    }).toThrow(/collides with a reserved/u)
  })
})

// ─── addressable-field catalog (shared by apply, validator, editor) ───

describe('addressable-field catalog', () => {
  it('builds source keys from resource stockpiles plus peak CPS', () => {
    expect(addressableSourcesFor(['r0', 'r1'])).toEqual([
      { key: 'resource:r0', label: 'r0 (stockpile)' },
      { key: 'resource:r1', label: 'r1 (stockpile)' },
      { key: 'meta:peakCps', label: 'Peak CPS' },
    ])
  })

  it('builds target keys from special fields, resource rates, and generators', () => {
    expect(addressableTargetsFor(['r0'], ['g0', 'g1'])).toEqual([
      { key: 'clickIncome', label: 'Click income' },
      { key: 'r0', label: 'r0 (rate)' },
      { key: 'b0', label: 'r0 (base producer)' },
      { key: 'g0', label: 'g0 (output)' },
      { key: 'g1', label: 'g1 (output)' },
    ])
  })

  it('builds enemy-debuff target keys from click income, the highlight factor, and rates', () => {
    expect(enemyDebuffTargetsFor(['r0', 'r1'])).toEqual([
      { key: 'clickIncome', label: 'Click income' },
      { key: HIGHLIGHT_FACTOR_TARGET, label: 'Highlight factor' },
      { key: 'r0', label: 'r0 (rate)' },
      { key: 'r1', label: 'r1 (rate)' },
    ])
  })

  // The two catalogs overlap rather than nest. Generator and base-producer
  // targets are debuffable by nothing (a debuff merges in after generator output
  // has been folded into rates); the highlight factor is debuff-only, since it
  // names no pipeline field at all and is resolved against the victim instead.
  it('overlaps the full catalog everywhere except the virtual highlight target', () => {
    const full = addressableTargetsFor(['r0', 'r1'], ['g0'])
    for (const target of enemyDebuffTargetsFor(['r0', 'r1'])) {
      if (target.key === HIGHLIGHT_FACTOR_TARGET) expect(full).not.toContainEqual(target)
      else expect(full).toContainEqual(target)
    }
    expect(full.map((f) => f.key)).not.toContain(HIGHLIGHT_FACTOR_TARGET)
  })

  it('the mode-level helpers delegate to the primitive ones', () => {
    const mode = getModeDefinition('idler')
    expect(addressableSources(mode)).toEqual(addressableSourcesFor(mode.resources))
    expect(addressableTargets(mode)).toEqual(
      addressableTargetsFor(
        mode.resources,
        mode.generators.map((g) => g.id),
      ),
    )
    expect(enemyDebuffTargets(mode)).toEqual(enemyDebuffTargetsFor(mode.resources))
  })
})

// ─── idler tree wiring (the upgrades that use relativeModifier) ───────

describe('idler relativeModifier upgrades', () => {
  const mode = getModeDefinition('idler')

  it('be-mr-bank gives +1% r0 base production per 1000 r0 held (multiplicative)', () => {
    const s = createInitialState(mode)
    s.upgrades['be-mr-bank'] = 1
    s.resources.r0 = 50_000 // 1 + 50000 * 0.00001 = 1.5
    expect(collectModifiers(s, mode)).toContainEqual({
      stage: 'multiplicative',
      field: 'b0',
      value: 1.5,
    })
  })

  it('be-sr-bank gives +1% r1 base production per 1000 r1 held (multiplicative)', () => {
    const s = createInitialState(mode)
    s.upgrades['be-sr-bank'] = 1
    s.resources.r1 = 100_000 // 1 + 100000 * 0.00001 = 2
    expect(collectModifiers(s, mode)).toContainEqual({
      stage: 'multiplicative',
      field: 'b1',
      value: 2,
    })
  })

  it('sc-pcps adds peak CPS to click income (additive)', () => {
    const s = createInitialState(mode)
    s.upgrades['sc-pcps'] = 1
    s.meta.peakCps = 9
    expect(collectModifiers(s, mode)).toContainEqual({
      stage: 'additive',
      field: 'clickIncome',
      value: 9,
    })
  })

  it('a bank bonus is inert with an empty stockpile', () => {
    const s = createInitialState(mode)
    s.upgrades['be-mr-bank'] = 1
    s.resources.r0 = 0
    expect(
      collectModifiers(s, mode).some((m) => m.stage === 'multiplicative' && m.field === 'r0'),
    ).toBe(false)
  })
})
