import { describe, expect, it } from 'vitest'
import {
  addressableSources,
  addressableSourcesFor,
  addressableTargets,
  addressableTargetsFor,
  applyEffect,
  collectModifiers,
  createInitialState,
  getModeDefinition,
  isAttackUnlocked,
  isPactUnlocked,
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
      'balancedGenerators',
      'baseModifier',
      'dominantGenerator',
      'generatorCost',
      'generatorUnlock',
      'highlightMultiplier',
      'lowerTierBoost',
      'panelUnlock',
      'relativeModifier',
      'systemUnlock',
      'unlockAttack',
      'unlockPact',
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

  it('falls back to r0 when no resource is highlighted', () => {
    const def = getModeDefinition('idler')
    const state = idlerState()
    state.upgrades['sh-unlock'] = 1
    delete state.meta.highlight
    const mods = collectModifiers(state, def)
    expect(mods).toContainEqual({ stage: 'multiplicative', field: 'r0', value: 2 })
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
  it('applies per-upgrade effects only when the upgrade is owned', () => {
    const base = getModeDefinition('idler')
    const customUpgrade: UpgradeDefinition = {
      id: 'uEffect',
      cost: { r0: 10 },
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
      cost: { r0: 10 },
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
      cost: { r0: 10 },
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
      effects: [{ type: 'highlightMultiplier', multiplier: 5 }],
    }
    const state = createInitialState(def)
    state.meta.highlight = 'r0'
    expect(collectModifiers(state, def)).toContainEqual({
      stage: 'multiplicative',
      field: 'r0',
      value: 5,
    })
  })
})

// ─── Generator synergy effects ───────────────────────────────────────

describe('lowerTierBoost effect', () => {
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
  it('boosts every generator tied at the maximum owned count', () => {
    const mode = getModeDefinition('idler')
    const state = createInitialState(mode)
    const [g0, g1] = mode.generators.map((g) => g.id)
    state.generators[g0] = 5
    state.generators[g1] = 5
    const out = applyEffect({ type: 'dominantGenerator', multiplier: 3 }, state, mode) as Modifier[]
    expect(out).toHaveLength(2)
    expect(out).toContainEqual({ stage: 'multiplicative', field: g0, value: 3 })
    expect(out).toContainEqual({ stage: 'multiplicative', field: g1, value: 3 })
  })

  it('returns null when no generators are owned', () => {
    const mode = getModeDefinition('idler')
    expect(
      applyEffect({ type: 'dominantGenerator', multiplier: 3 }, createInitialState(mode), mode),
    ).toBeNull()
  })
})

describe('balancedGenerators effect', () => {
  it('emits a single global multiplier when all generators are owned equally', () => {
    const mode = getModeDefinition('idler')
    const state = createInitialState(mode)
    for (const gen of mode.generators) state.generators[gen.id] = 4
    expect(applyEffect({ type: 'balancedGenerators', multiplier: 2 }, state, mode)).toEqual({
      stage: 'global',
      field: 'globalMultiplier',
      value: 2,
    })
  })

  it('returns null when counts are unequal', () => {
    const mode = getModeDefinition('idler')
    const state = createInitialState(mode)
    for (const gen of mode.generators) state.generators[gen.id] = 4
    state.generators[mode.generators[0].id] = 5
    expect(applyEffect({ type: 'balancedGenerators', multiplier: 2 }, state, mode)).toBeNull()
  })

  it('returns null when all generators are unowned', () => {
    const mode = getModeDefinition('idler')
    expect(
      applyEffect({ type: 'balancedGenerators', multiplier: 2 }, createInitialState(mode), mode),
    ).toBeNull()
  })
})

describe('generatorCost effect', () => {
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
      effects: [{ type: 'generatorCost', generator: gen, costFactor: 0.5 }],
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
      effects: [{ type: 'panelUnlock', panel: 'generators' }],
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
      effects: [{ type: 'generatorUnlock', generator: 'g1' }],
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
      effects: [{ type: 'systemUnlock', system: 'highlight' }],
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
      cost: { r0: 10 },
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
      effects: [{ type: 'unlockAttack', attack: 'a0' }],
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

describe('unlockPact effect', () => {
  /** Extend idler with an upgrade whose `unlockPact` effect names `pactId`. */
  function modeWithPactUpgrade(upgradeId: string, pactId: string): ModeDefinition {
    const base = getModeDefinition('idler')
    const upgrade: UpgradeDefinition = {
      id: upgradeId,
      cost: { r0: 10 },
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
      effects: [{ type: 'unlockPact', pact: 'p0' }],
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
      effects: [{ type: 'lowerTierBoost', perUnit: 1 }],
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

  it('feeds a stockpile-relative bonus through collectModifiers when owned', () => {
    const base = getModeDefinition('idler')
    const customUpgrade: UpgradeDefinition = {
      id: 'uRel',
      cost: { r0: 10 },
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
      cost: { r0: 1 },
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

describe('accessEnemyData mode validation', () => {
  // Build an idler variant whose extra upgrade reveals `data`, with a matching
  // flavor upgrade entry so flavor validation doesn't trip before the intel
  // checks.
  function withAccess(data: string): ModeDefinition {
    const base = getModeDefinition('idler')
    const u: UpgradeDefinition = {
      id: 'uIntel',
      cost: { r0: 1 },
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
      { key: 'globalMultiplier', label: 'Global multiplier' },
      { key: 'r0', label: 'r0 (rate)' },
      { key: 'g0', label: 'g0 (output)' },
      { key: 'g1', label: 'g1 (output)' },
    ])
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
  })
})

// ─── idler tree wiring (the upgrades that use relativeModifier) ───────

describe('idler relativeModifier upgrades', () => {
  const mode = getModeDefinition('idler')

  it('be-mr-bank gives +1% r0 rate per 1000 r0 held (multiplicative)', () => {
    const s = createInitialState(mode)
    s.upgrades['be-mr-bank'] = 1
    s.resources.r0 = 50_000 // 1 + 50000 * 0.00001 = 1.5
    expect(collectModifiers(s, mode)).toContainEqual({
      stage: 'multiplicative',
      field: 'r0',
      value: 1.5,
    })
  })

  it('be-sr-bank gives +1% r1 rate per 1000 r1 held (multiplicative)', () => {
    const s = createInitialState(mode)
    s.upgrades['be-sr-bank'] = 1
    s.resources.r1 = 100_000 // 1 + 100000 * 0.00001 = 2
    expect(collectModifiers(s, mode)).toContainEqual({
      stage: 'multiplicative',
      field: 'r1',
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
