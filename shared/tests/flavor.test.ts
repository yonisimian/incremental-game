import { describe, expect, it, vi } from 'vitest'
import { getModeDefinition, validateModeDefinition } from '../src/modes/index.js'
import type { ModeDefinition, ModeFlavor } from '../src/modes/types.js'
import type { EffectRef, GameMode } from '../src/types.js'
import {
  getModeFlavor,
  getResourceIcon,
  getResourceName,
  getUpgradeName,
  getUpgradeIcon,
  getUpgradeDescription,
  getGeneratorName,
  getGeneratorIcon,
  getAttackName,
  getAttackIcon,
  getAttackDescription,
  getPactName,
  getPactIcon,
  getPactDescription,
} from '../src/flavor.js'

// ─── Positive: real modes pass validation ────────────────────────────

const MODES: GameMode[] = ['idler']

for (const mode of MODES) {
  const def = getModeDefinition(mode)
  const f = getModeFlavor(def)

  describe(`${mode} flavor`, () => {
    it('resource keys match between mechanics and flavor', () => {
      const mechKeys = new Set(def.resources)
      const flavorKeys = new Set(f.resources.map((r) => r.key))
      expect(flavorKeys).toEqual(mechKeys)
    })

    it('every upgrade has a flavor entry', () => {
      for (const u of def.upgrades) {
        expect(
          f.upgrades.some((fu) => fu.id === u.id),
          `missing flavor for upgrade '${u.id}'`,
        ).toBe(true)
      }
    })

    it('every generator has a flavor entry', () => {
      for (const g of def.generators) {
        expect(
          f.generators.some((fg) => fg.id === g.id),
          `missing flavor for generator '${g.id}'`,
        ).toBe(true)
      }
    })

    it('no orphaned flavor upgrade entries', () => {
      for (const fu of f.upgrades) {
        expect(
          def.upgrades.some((u) => u.id === fu.id),
          `flavor references unknown upgrade '${fu.id}'`,
        ).toBe(true)
      }
    })

    it('no orphaned flavor generator entries', () => {
      for (const fg of f.generators) {
        expect(
          def.generators.some((g) => g.id === fg.id),
          `flavor references unknown generator '${fg.id}'`,
        ).toBe(true)
      }
    })
  })
}

// ─── Negative: validateModeDefinition rejects broken definitions ─────

/** Build a minimal valid ModeDefinition, then let the caller break it. */
function makeValidDef(overrides?: Partial<ModeDefinition>): ModeDefinition {
  const base: ModeDefinition = {
    resources: ['r0'],
    scoreResource: 'r0',
    upgrades: [{ id: 'u0', cost: { r0: { baseCost: 10 } }, purchaseLimit: 1 }],
    goals: [{ type: 'timed', label: '⏱ Timed', durationSec: 30 }],
    clicksEnabled: true,
    highlightEnabled: false,
    initialResources: { r0: 0 },
    initialMeta: {},
    generators: [],
    attacks: [],
    pacts: [],
    flavors: [
      {
        id: 'test',
        displayName: 'Test',
        themeClass: 'theme-test',
        scoreLabel: 'Score',
        showClickStats: false,
        resources: [{ key: 'r0', displayName: 'Res', icon: '🔵' }],
        upgrades: [{ id: 'u0', name: 'Upg', icon: '🔧', description: 'desc' }],
        generators: [],
        attacks: [],
        pacts: [],
      },
    ],
  }
  return { ...base, ...overrides }
}

/** Return a new def whose (single) flavor has selected arrays overridden. */
function withFlavor(def: ModeDefinition, patch: Partial<ModeFlavor>): ModeDefinition {
  return { ...def, flavors: [{ ...def.flavors[0], ...patch }] }
}

describe('validateModeDefinition — negative tests', () => {
  it('passes for a valid minimal definition', () => {
    expect(() => {
      validateModeDefinition('test', makeValidDef())
    }).not.toThrow()
  })

  // ── Resource mismatches ──────────────────────────────────────────

  it('throws when flavor has extra resource keys', () => {
    const def = withFlavor(makeValidDef(), {
      resources: [
        { key: 'r0', displayName: 'Res', icon: '🔵' },
        { key: 'r1', displayName: 'Extra', icon: '🟡' },
      ],
    })
    expect(() => {
      validateModeDefinition('test', def)
    }).toThrow(/resources keys/)
  })

  it('throws when flavor is missing a resource key', () => {
    const def = withFlavor(
      makeValidDef({ resources: ['r0', 'r1'], initialResources: { r0: 0, r1: 0 } }),
      {
        resources: [{ key: 'r0', displayName: 'Res', icon: '🔵' }],
      },
    )
    expect(() => {
      validateModeDefinition('test', def)
    }).toThrow(/resources keys/)
  })

  it('throws when flavor resource key differs from mechanics', () => {
    const def = withFlavor(makeValidDef(), {
      resources: [{ key: 'r9', displayName: 'Wrong', icon: '❌' }],
    })
    expect(() => {
      validateModeDefinition('test', def)
    }).toThrow(/resources keys/)
  })

  // ── Missing flavor entries ───────────────────────────────────────

  it('throws when flavor is missing an upgrade entry', () => {
    const def = withFlavor(makeValidDef(), { upgrades: [] })
    expect(() => {
      validateModeDefinition('test', def)
    }).toThrow(/missing flavor for upgrade/)
  })

  it('throws when flavor is missing a generator entry', () => {
    const def = makeValidDef({
      generators: [
        {
          id: 'g0',
          cost: { r0: { baseCost: 5, scaleType: 'exponential', scaleFactor: 1 } },
          production: { resource: 'r0', rate: 1 },
        },
      ],
    })
    // flavor.generators is still [] → missing g0
    expect(() => {
      validateModeDefinition('test', def)
    }).toThrow(/missing flavor for generator/)
  })

  // ── Orphan / redundant flavor entries ────────────────────────────

  it('throws when flavor has an orphan upgrade entry', () => {
    const def = withFlavor(makeValidDef(), {
      upgrades: [
        { id: 'u0', name: 'Upg', icon: '🔧', description: 'desc' },
        { id: 'u_ghost', name: 'Ghost', icon: '👻', description: 'no matching mechanic' },
      ],
    })
    expect(() => {
      validateModeDefinition('test', def)
    }).toThrow(/unknown upgrade 'u_ghost'/)
  })

  it('throws when flavor has an orphan generator entry', () => {
    const def = withFlavor(makeValidDef(), {
      generators: [{ id: 'g_ghost', name: 'Ghost', icon: '👻' }],
    })
    expect(() => {
      validateModeDefinition('test', def)
    }).toThrow(/unknown generator 'g_ghost'/)
  })

  // ── highlightEnabled ↔ initialMeta consistency ───────────────────

  it('throws when highlightEnabled is true but initialMeta has no highlight', () => {
    const def = makeValidDef({ highlightEnabled: true, initialMeta: {} })
    expect(() => {
      validateModeDefinition('test', def)
    }).toThrow(/highlightEnabled.*initialMeta/)
  })

  it('passes when highlightEnabled is true and initialMeta has highlight', () => {
    const def = makeValidDef({ highlightEnabled: true, initialMeta: { highlight: 'r0' } })
    expect(() => {
      validateModeDefinition('test', def)
    }).not.toThrow()
  })

  it('passes when highlightEnabled is false even without highlight in meta', () => {
    const def = makeValidDef({ highlightEnabled: false, initialMeta: {} })
    expect(() => {
      validateModeDefinition('test', def)
    }).not.toThrow()
  })

  // ── Multiple flavors ─────────────────────────────────────────────

  it('passes with several valid flavors describing the same mechanics', () => {
    const def = makeValidDef({
      flavors: [
        {
          id: 'medieval',
          displayName: 'Medieval',
          themeClass: 'theme-medieval',
          scoreLabel: 'Score',
          showClickStats: false,
          resources: [{ key: 'r0', displayName: 'Wood', icon: '🪵' }],
          upgrades: [{ id: 'u0', name: 'Axe', icon: '🪓', description: 'chop' }],
          generators: [],
          attacks: [],
          pacts: [],
        },
        {
          id: 'scifi',
          displayName: 'Sci-Fi',
          themeClass: 'theme-scifi',
          scoreLabel: 'Score',
          showClickStats: false,
          resources: [{ key: 'r0', displayName: 'Energy', icon: '⚡' }],
          upgrades: [{ id: 'u0', name: 'Laser', icon: '🔫', description: 'zap' }],
          generators: [],
          attacks: [],
          pacts: [],
        },
      ],
    })
    expect(() => {
      validateModeDefinition('test', def)
    }).not.toThrow()
  })

  it('throws when two flavors share an id', () => {
    const flavor = makeValidDef().flavors[0]
    const def = makeValidDef({ flavors: [flavor, { ...flavor }] })
    expect(() => {
      validateModeDefinition('test', def)
    }).toThrow(/duplicate flavor id 'test'/)
  })

  it('throws when a non-default flavor is missing an upgrade entry', () => {
    const good = makeValidDef().flavors[0]
    const broken: ModeFlavor = { ...good, id: 'broken', upgrades: [] }
    const def = makeValidDef({ flavors: [good, broken] })
    expect(() => {
      validateModeDefinition('test', def)
    }).toThrow(/flavor 'broken'.*missing flavor for upgrade/)
  })

  it('throws when a mode has no flavors', () => {
    const def = makeValidDef({ flavors: [] })
    expect(() => {
      validateModeDefinition('test', def)
    }).toThrow(/no flavors/)
  })

  // ── Generator referential integrity ──────────────────────────────

  /** A flavor entry for a generator added to the base def. */
  function genFlavorEntry(genId: string): { id: string; name: string; icon: string } {
    return { id: genId, name: genId, icon: '⚙️' }
  }

  it('throws when a generatorUnlock effect references an unknown generator', () => {
    const def = makeValidDef({
      upgrades: [
        {
          id: 'u0',
          cost: { r0: { baseCost: 10 } },
          purchaseLimit: 1,
          effects: [{ type: 'generatorUnlock', generator: 'g-missing' }],
        },
      ],
    })
    expect(() => {
      validateModeDefinition('test', def)
    }).toThrow(/upgrade 'u0' generatorUnlock effect references unknown generator 'g-missing'/)
  })

  it('throws when an unlockAttack effect references an unknown attack', () => {
    const def = makeValidDef({
      upgrades: [
        {
          id: 'u0',
          cost: { r0: { baseCost: 10 } },
          purchaseLimit: 1,
          effects: [{ type: 'unlockAttack', attack: 'a-missing' }],
        },
      ],
    })
    expect(() => {
      validateModeDefinition('test', def)
    }).toThrow(/upgrade 'u0' unlockAttack effect references unknown attack 'a-missing'/)
  })

  it('accepts an unlockAttack effect that references a defined attack', () => {
    const base = makeValidDef({
      attacks: [{ id: 'a0', kind: 'active' }],
      upgrades: [
        {
          id: 'u0',
          cost: { r0: { baseCost: 10 } },
          purchaseLimit: 1,
          effects: [{ type: 'unlockAttack', attack: 'a0' }],
        },
      ],
    })
    const def = withFlavor(base, {
      attacks: [{ id: 'a0', name: 'Raid', icon: '⚔️', description: '' }],
    })
    expect(() => {
      validateModeDefinition('test', def)
    }).not.toThrow()
  })

  it('throws when a mechanical attack has no flavor entry', () => {
    const def = makeValidDef({ attacks: [{ id: 'a0', kind: 'active' }] })
    expect(() => {
      validateModeDefinition('test', def)
    }).toThrow(/missing flavor for attack 'a0'/)
  })

  it('throws when an attack flavor entry references an unknown attack', () => {
    const def = withFlavor(makeValidDef(), {
      attacks: [{ id: 'a-ghost', name: 'Ghost', icon: '👻', description: '' }],
    })
    expect(() => {
      validateModeDefinition('test', def)
    }).toThrow(/references unknown attack 'a-ghost'/)
  })

  it('accepts an enemyProductionModifier debuffing a resource rate', () => {
    const base = makeValidDef({
      attacks: [
        {
          id: 'a0',
          kind: 'passive',
          effects: [
            { type: 'enemyProductionModifier', stage: 'multiplicative', field: 'r0', value: 0.9 },
          ],
        },
      ],
    })
    const def = withFlavor(base, {
      attacks: [{ id: 'a0', name: 'Blight', icon: '🐛', description: '' }],
    })
    expect(() => {
      validateModeDefinition('test', def)
    }).not.toThrow()
  })

  it('rejects an enemyProductionModifier debuffing the globalMultiplier', () => {
    const base = makeValidDef({
      attacks: [
        {
          id: 'a0',
          kind: 'passive',
          effects: [
            {
              type: 'enemyProductionModifier',
              stage: 'multiplicative',
              field: 'globalMultiplier',
              value: 0.8,
            },
          ],
        },
      ],
    })
    const def = withFlavor(base, {
      attacks: [{ id: 'a0', name: 'Sabotage', icon: '💣', description: '' }],
    })
    expect(() => {
      validateModeDefinition('test', def)
    }).toThrow(/unsupported field 'globalMultiplier'/)
  })

  it('accepts an enemyProductionModifier targeting clickIncome', () => {
    const base = makeValidDef({
      attacks: [
        {
          id: 'a0',
          kind: 'passive',
          effects: [
            {
              type: 'enemyProductionModifier',
              stage: 'multiplicative',
              field: 'clickIncome',
              value: 0.5,
            },
          ],
        },
      ],
    })
    const def = withFlavor(base, {
      attacks: [{ id: 'a0', name: 'Jam', icon: '🔇', description: '' }],
    })
    expect(() => {
      validateModeDefinition('test', def)
    }).not.toThrow()
  })

  it('accepts a multiplicative enemyProductionModifier targeting the highlight factor', () => {
    const base = makeValidDef({
      highlightEnabled: true,
      initialMeta: { highlight: null },
      attacks: [
        {
          id: 'a0',
          kind: 'passive',
          effects: [
            {
              type: 'enemyProductionModifier',
              stage: 'multiplicative',
              field: 'highlightFactor',
              value: 0.9,
            },
          ],
        },
      ],
    })
    const def = withFlavor(base, {
      attacks: [{ id: 'a0', name: 'Dim', icon: '🌫️', description: '' }],
    })
    expect(() => {
      validateModeDefinition('test', def)
    }).not.toThrow()
  })

  // An additive highlight debuff subtracts from the composite factor (floored by
  // `resolveEnemyDebuffs`), so — unlike before — it is a legal authoring.
  it('accepts an additive enemyProductionModifier targeting the highlight factor', () => {
    const base = makeValidDef({
      highlightEnabled: true,
      initialMeta: { highlight: null },
      attacks: [
        {
          id: 'a0',
          kind: 'passive',
          effects: [
            {
              type: 'enemyProductionModifier',
              stage: 'additive',
              field: 'highlightFactor',
              value: -2,
            },
          ],
        },
      ],
    })
    const def = withFlavor(base, {
      attacks: [{ id: 'a0', name: 'Dim', icon: '🌫️', description: '' }],
    })
    expect(() => {
      validateModeDefinition('test', def)
    }).not.toThrow()
  })

  it('throws when a resource key collides with a reserved modifier target', () => {
    const def = withFlavor(
      makeValidDef({
        resources: ['r0', 'highlightFactor'],
        initialResources: { r0: 0, highlightFactor: 0 },
      }),
      {
        resources: [
          { key: 'r0', displayName: 'Res', icon: '🔵' },
          { key: 'highlightFactor', displayName: 'Sneaky', icon: '🕳️' },
        ],
      },
    )
    expect(() => {
      validateModeDefinition('test', def)
    }).toThrow(/collides with a reserved modifier target/)
  })

  // A *declared* generator, so the rejection is about the field not being a
  // debuff target (a debuff merges in after generator output is folded) rather
  // than about an unknown id.
  it('throws when an enemyProductionModifier targets a generator', () => {
    const base = makeValidDef({
      generators: [
        { id: 'g0', cost: { r0: { baseCost: 10 } }, production: { resource: 'r0', rate: 1 } },
      ],
      attacks: [
        {
          id: 'a0',
          kind: 'passive',
          effects: [
            {
              type: 'enemyProductionModifier',
              stage: 'multiplicative',
              field: 'g0',
              value: 0.5,
            },
          ],
        },
      ],
    })
    const def = withFlavor(base, {
      generators: [{ id: 'g0', name: 'Gen', icon: '⚙️' }],
      attacks: [{ id: 'a0', name: 'Jam', icon: '🔇', description: '' }],
    })
    expect(() => {
      validateModeDefinition('test', def)
    }).toThrow(/unknown or unsupported field 'g0'/)
  })

  // ── Duration attacks (plan 37): the debuff pair on an *active* attack ──

  /** An active attack carrying a debuff, with the fields `patch` says. */
  function debuffAttackDef(patch: Partial<ModeDefinition['attacks'][number]>): ModeDefinition {
    const base = makeValidDef({
      attacks: [
        {
          id: 'a0',
          kind: 'active',
          prepareCost: { r0: { baseCost: 10 } },
          prepareTimeSec: 1,
          durationSec: 10,
          effects: [
            { type: 'enemyProductionModifier', stage: 'multiplicative', field: 'r0', value: 0.5 },
          ],
          ...patch,
        },
      ],
    })
    return withFlavor(base, {
      attacks: [{ id: 'a0', name: 'Blockade', icon: '⛓️', description: '' }],
    })
  }

  it('accepts an enemyProductionModifier on an active attack that declares a duration', () => {
    expect(() => {
      validateModeDefinition('test', debuffAttackDef({}))
    }).not.toThrow()
  })

  it('accepts a raid — a steal and a debuff on one active attack, sharing the window', () => {
    const def = debuffAttackDef({
      effects: [
        { type: 'stealResource', resource: 'r0', fraction: 0.1 },
        { type: 'enemyProductionModifier', stage: 'multiplicative', field: 'r0', value: 0.5 },
        { type: 'enemyCostModifier', target: 'upgrades', costFactor: 2 },
      ],
    })
    expect(() => {
      validateModeDefinition('test', def)
    }).not.toThrow()
  })

  it('throws when an enemyProductionModifier rides an active attack with no durationSec', () => {
    expect(() => {
      validateModeDefinition('test', debuffAttackDef({ durationSec: undefined }))
    }).toThrow(/carries a debuff effect .* but has no durationSec/)
  })

  it('throws for a durationSec on an active attack whose effects are all steals', () => {
    const def = debuffAttackDef({
      effects: [{ type: 'stealResource', resource: 'r0', fraction: 0.1 }],
    })
    expect(() => {
      validateModeDefinition('test', def)
    }).toThrow(/declares durationSec but carries no debuff effect/)
  })

  it('throws for a non-positive durationSec', () => {
    for (const durationSec of [0, -5]) {
      expect(() => {
        validateModeDefinition('test', debuffAttackDef({ durationSec }))
      }).toThrow(/non-positive durationSec/)
    }
  })

  it('throws for a durationSec on a passive attack', () => {
    const base = makeValidDef({
      attacks: [
        {
          id: 'a0',
          kind: 'passive',
          durationSec: 10,
          effects: [
            { type: 'enemyProductionModifier', stage: 'multiplicative', field: 'r0', value: 0.9 },
          ],
        },
      ],
    })
    const def = withFlavor(base, {
      attacks: [{ id: 'a0', name: 'Jam', icon: '🔇', description: '' }],
    })
    expect(() => {
      validateModeDefinition('test', def)
    }).toThrow(/passive attack 'a0' declares durationSec/)
  })

  it('still requires the prepare cost and delay on a duration attack', () => {
    expect(() => {
      validateModeDefinition('test', debuffAttackDef({ prepareCost: undefined }))
    }).toThrow(/carries effects but has no prepareCost/)
  })

  // ── Purchase lock: the third member of the debuff family ──

  it('accepts a lock-only active attack that declares a duration', () => {
    const def = debuffAttackDef({ effects: [{ type: 'enemyPurchaseLock', target: 'purchases' }] })
    expect(() => {
      validateModeDefinition('test', def)
    }).not.toThrow()
  })

  // The trap the plan exists to step around: an effect outside the debuff
  // family would be authorable with no window, land, and silently do nothing.
  it('throws when a lock rides an active attack with no durationSec', () => {
    const def = debuffAttackDef({
      durationSec: undefined,
      effects: [{ type: 'enemyPurchaseLock', target: 'upgrades' }],
    })
    expect(() => {
      validateModeDefinition('test', def)
    }).toThrow(/carries a debuff effect \(.*enemyPurchaseLock.*\) but has no durationSec/)
  })

  it('throws for two locks on one attack that overlap', () => {
    for (const pair of [
      ['upgrades', 'upgrades'],
      ['upgrades', 'purchases'],
      ['purchases', 'generators'],
      ['upgrade:u0', 'upgrade:u0'],
      ['upgrades', 'upgrade:u0'],
      ['upgrade:u0', 'purchases'],
    ]) {
      const def = debuffAttackDef({
        effects: pair.map((target) => ({ type: 'enemyPurchaseLock', target })),
      })
      expect(() => {
        validateModeDefinition('test', def)
      }).toThrow(/enemyPurchaseLock effects that overlap/)
    }
  })

  it('accepts two locks on one attack that do not overlap', () => {
    for (const pair of [
      ['upgrades', 'generators'],
      ['generators', 'upgrade:u0'],
    ]) {
      const def = debuffAttackDef({
        effects: pair.map((target) => ({ type: 'enemyPurchaseLock', target })),
      })
      expect(() => {
        validateModeDefinition('test', def)
      }).not.toThrow()
    }
  })

  it('throws for a lock target naming an unknown upgrade or generator', () => {
    for (const target of ['upgrade:u-missing', 'generator:g-missing', 'all']) {
      const def = debuffAttackDef({ effects: [{ type: 'enemyPurchaseLock', target }] })
      expect(() => {
        validateModeDefinition('test', def)
      }).toThrow(/unknown purchase target/)
    }
  })

  it('throws for a lock on a passive attack (host declaration)', () => {
    const base = makeValidDef({
      attacks: [
        {
          id: 'a0',
          kind: 'passive',
          effects: [{ type: 'enemyPurchaseLock', target: 'upgrades' }],
        },
      ],
    })
    const def = withFlavor(base, {
      attacks: [{ id: 'a0', name: 'Embargo', icon: '🔒', description: '' }],
    })
    expect(() => {
      validateModeDefinition('test', def)
    }).toThrow(/enemyPurchaseLock/)
  })

  it('throws when an enemyCostModifier names an unknown cost target', () => {
    const base = makeValidDef({
      attacks: [
        {
          id: 'a0',
          kind: 'passive',
          effects: [{ type: 'enemyCostModifier', target: 'upgrade:nope', costFactor: 1.5 }],
        },
      ],
    })
    const def = withFlavor(base, {
      attacks: [{ id: 'a0', name: 'Tariff', icon: '💸', description: '' }],
    })
    expect(() => {
      validateModeDefinition('test', def)
    }).toThrow(/unknown purchase target 'upgrade:nope'/)
  })

  // The scope and the id can't disagree — a single namespaced key makes that
  // unrepresentable — but a generator id under the upgrade prefix still has to
  // be caught, since each prefix is checked against its own catalog.
  it('throws when an enemyCostModifier names an id from the other scope', () => {
    const base = makeValidDef({
      generators: [
        { id: 'g0', cost: { r0: { baseCost: 10 } }, production: { resource: 'r0', rate: 1 } },
      ],
      attacks: [
        {
          id: 'a0',
          kind: 'passive',
          effects: [{ type: 'enemyCostModifier', target: 'upgrade:g0', costFactor: 1.5 }],
        },
      ],
    })
    const def = withFlavor(base, {
      generators: [{ id: 'g0', name: 'Gen', icon: '⚙️' }],
      attacks: [{ id: 'a0', name: 'Tariff', icon: '💸', description: '' }],
    })
    expect(() => {
      validateModeDefinition('test', def)
    }).toThrow(/unknown purchase target 'upgrade:g0'/)
  })

  it('accepts an enemyCostModifier naming a declared upgrade', () => {
    const base = makeValidDef({
      attacks: [
        {
          id: 'a0',
          kind: 'passive',
          effects: [{ type: 'enemyCostModifier', target: 'upgrade:u0', costFactor: 1.5 }],
        },
      ],
    })
    const def = withFlavor(base, {
      attacks: [{ id: 'a0', name: 'Tariff', icon: '💸', description: '' }],
    })
    expect(() => {
      validateModeDefinition('test', def)
    }).not.toThrow()
  })

  it('throws when an enemyCostModifier rides an active attack with no durationSec', () => {
    const base = makeValidDef({
      attacks: [
        {
          id: 'a0',
          kind: 'active',
          prepareCost: { r0: { baseCost: 10 } },
          prepareTimeSec: 1,
          effects: [{ type: 'enemyCostModifier', target: 'upgrades', costFactor: 1.5 }],
        },
      ],
    })
    const def = withFlavor(base, {
      attacks: [{ id: 'a0', name: 'Tariff', icon: '💸', description: '' }],
    })
    expect(() => {
      validateModeDefinition('test', def)
    }).toThrow(/carries a debuff effect .* but has no durationSec/)
    // With a window it is a duration attack, and legal.
    const timed = { ...def, attacks: [{ ...def.attacks[0], durationSec: 8 }] }
    expect(() => {
      validateModeDefinition('test', timed)
    }).not.toThrow()
  })

  it('throws when a stealResource is carried by a passive attack', () => {
    const base = makeValidDef({
      attacks: [
        {
          id: 'a0',
          kind: 'passive',
          effects: [{ type: 'stealResource', resource: 'r0', fraction: 0.1 }],
        },
      ],
    })
    const def = withFlavor(base, {
      attacks: [{ id: 'a0', name: 'Raid', icon: '🪓', description: '' }],
    })
    expect(() => {
      validateModeDefinition('test', def)
    }).toThrow(/'stealResource' effect, which only applies on an active attack/)
  })

  it('throws when a stealGenerator is carried by a passive attack', () => {
    const base = makeValidDef({
      attacks: [
        {
          id: 'a0',
          kind: 'passive',
          effects: [{ type: 'stealGenerator', generator: 'g0', fraction: 0.5 }],
        },
      ],
    })
    const def = withFlavor(base, {
      attacks: [{ id: 'a0', name: 'Raid', icon: '🪓', description: '' }],
    })
    expect(() => {
      validateModeDefinition('test', def)
    }).toThrow(/'stealGenerator' effect, which only applies on an active attack/)
  })

  it('throws when an offensive effect is carried by an upgrade', () => {
    const def = makeValidDef({
      upgrades: [
        {
          id: 'u0',
          cost: { r0: { baseCost: 10 } },
          purchaseLimit: 1,
          effects: [{ type: 'stealResource', resource: 'r0', fraction: 0.1 }],
        },
      ],
    })
    expect(() => {
      validateModeDefinition('test', def)
    }).toThrow(/upgrade 'u0' carries a 'stealResource' effect/)
  })

  // A production effect on an attack is read by nobody: `collectEnemyDebuffs`
  // keeps only `enemyModifier` outputs and `resolveAttackStrike` only
  // `resourceSteal`, so it would silently do nothing.
  it('throws when a production effect is carried by an attack', () => {
    const base = makeValidDef({
      attacks: [
        {
          id: 'a0',
          kind: 'passive',
          effects: [{ type: 'baseModifier', stage: 'additive', field: 'r0', value: 5 }],
        },
      ],
    })
    const def = withFlavor(base, {
      attacks: [{ id: 'a0', name: 'Odd', icon: '❓', description: '' }],
    })
    expect(() => {
      validateModeDefinition('test', def)
    }).toThrow(/'baseModifier' effect, which only applies on the mode \/ an upgrade/)
  })

  it('accepts a production effect authored on the mode itself', () => {
    const def = makeValidDef({
      effects: [{ type: 'baseModifier', stage: 'additive', field: 'r0', value: 5 }],
    })
    expect(() => {
      validateModeDefinition('test', def)
    }).not.toThrow()
  })

  // ── attackStat ───────────────────────────────────────────────────
  //
  // The stat only reaches an attack through `collectAttackParams`, which looks
  // the id up — so a typo, or a stat the named attack has no field for, buffs
  // nothing at all and says nothing about it.

  /** A def whose only upgrade carries `ref`, with `attacks` declared + flavored. */
  function withAttackStat(
    ref: EffectRef,
    attacks: ModeDefinition['attacks'],
    purchaseLimit = 1,
  ): ModeDefinition {
    const base = makeValidDef({
      attacks,
      upgrades: [{ id: 'u0', cost: { r0: { baseCost: 10 } }, purchaseLimit, effects: [ref] }],
    })
    return withFlavor(base, {
      attacks: attacks.map((a) => ({ id: a.id, name: a.id, icon: '⚔️', description: '' })),
    })
  }

  const ACTIVE_A0: ModeDefinition['attacks'] = [
    {
      id: 'a0',
      kind: 'active',
      prepareCost: { r0: { baseCost: 10 } },
      prepareTimeSec: 1,
      effects: [{ type: 'stealResource', resource: 'r0', fraction: 0.1 }],
    },
  ]

  const PASSIVE_A0: ModeDefinition['attacks'] = [
    {
      id: 'a0',
      kind: 'passive',
      effects: [
        { type: 'enemyProductionModifier', stage: 'multiplicative', field: 'r0', value: 0.9 },
      ],
    },
  ]

  it('throws when an attackStat references an unknown attack', () => {
    const def = withAttackStat(
      { type: 'attackStat', attack: 'a-missing', stat: 'power', op: 'mult', value: 2 },
      ACTIVE_A0,
    )
    expect(() => {
      validateModeDefinition('test', def)
    }).toThrow(/upgrade 'u0' attackStat effect references unknown attack 'a-missing'/)
  })

  it('accepts an attackStat naming a declared attack', () => {
    const def = withAttackStat(
      { type: 'attackStat', attack: 'a0', stat: 'power', op: 'mult', value: 2 },
      ACTIVE_A0,
    )
    expect(() => {
      validateModeDefinition('test', def)
    }).not.toThrow()
  })

  it('throws for an attackStat naming no attack', () => {
    const def = withAttackStat(
      { type: 'attackStat', stat: 'prepareTime', op: 'mult', value: 0.5 },
      ACTIVE_A0,
    )
    expect(() => {
      validateModeDefinition('test', def)
    }).toThrow(/"attack"/)
  })

  it('throws for a prepareCost stat aimed at a passive attack', () => {
    const def = withAttackStat(
      { type: 'attackStat', attack: 'a0', stat: 'prepareCost', op: 'mult', value: 0.5 },
      PASSIVE_A0,
    )
    expect(() => {
      validateModeDefinition('test', def)
    }).toThrow(/moves 'prepareCost' on passive attack 'a0'/)
  })

  it('throws for a prepareTime stat aimed at a passive attack', () => {
    const def = withAttackStat(
      { type: 'attackStat', attack: 'a0', stat: 'prepareTime', op: 'mult', value: 0.5 },
      PASSIVE_A0,
    )
    expect(() => {
      validateModeDefinition('test', def)
    }).toThrow(/moves 'prepareTime' on passive attack 'a0'/)
  })

  it('accepts a power stat aimed at a passive attack — its debuff still scales', () => {
    const def = withAttackStat(
      { type: 'attackStat', attack: 'a0', stat: 'power', op: 'mult', value: 2 },
      PASSIVE_A0,
    )
    expect(() => {
      validateModeDefinition('test', def)
    }).not.toThrow()
  })

  /** Active, with a debuff window for a `duration` stat to stretch. */
  const WINDOW_A0: ModeDefinition['attacks'] = [
    {
      id: 'a0',
      kind: 'active',
      prepareCost: { r0: { baseCost: 10 } },
      prepareTimeSec: 1,
      durationSec: 10,
      effects: [
        { type: 'enemyProductionModifier', stage: 'multiplicative', field: 'r0', value: 0.5 },
      ],
    },
  ]

  it('throws for a duration stat aimed at a passive attack', () => {
    const def = withAttackStat(
      { type: 'attackStat', attack: 'a0', stat: 'duration', op: 'mult', value: 2 },
      PASSIVE_A0,
    )
    expect(() => {
      validateModeDefinition('test', def)
    }).toThrow(/moves 'duration' on passive attack 'a0'/)
  })

  // A lock has no magnitude, so `power` has nothing to scale on an
  // attack whose effects are all locks — `duration` is that attack's lever.
  it('throws for a power stat aimed at a lock-only attack, and accepts one on a raid', () => {
    const lockOnly: ModeDefinition['attacks'] = [
      {
        id: 'a0',
        kind: 'active',
        prepareCost: { r0: { baseCost: 10 } },
        prepareTimeSec: 1,
        durationSec: 10,
        effects: [{ type: 'enemyPurchaseLock', target: 'upgrades' }],
      },
    ]
    const power: EffectRef = {
      type: 'attackStat',
      attack: 'a0',
      stat: 'power',
      op: 'mult',
      value: 2,
    }
    expect(() => {
      validateModeDefinition('test', withAttackStat(power, lockOnly))
    }).toThrow(/moves 'power' on attack 'a0', whose only effects are purchase locks/)
    // `duration` is the right lever, and stays legal.
    expect(() => {
      validateModeDefinition(
        'test',
        withAttackStat(
          { type: 'attackStat', attack: 'a0', stat: 'duration', op: 'mult', value: 2 },
          lockOnly,
        ),
      )
    }).not.toThrow()
    // A raid that steals *and* locks still has a steal to scale.
    const raid: ModeDefinition['attacks'] = [
      {
        ...lockOnly[0],
        effects: [
          { type: 'stealResource', resource: 'r0', fraction: 0.1 },
          { type: 'enemyPurchaseLock', target: 'upgrades' },
        ],
      },
    ]
    expect(() => {
      validateModeDefinition('test', withAttackStat(power, raid))
    }).not.toThrow()
  })

  it('throws for a duration stat aimed at an active attack with no window', () => {
    const def = withAttackStat(
      { type: 'attackStat', attack: 'a0', stat: 'duration', op: 'offset', value: 2 },
      ACTIVE_A0,
    )
    expect(() => {
      validateModeDefinition('test', def)
    }).toThrow(/moves 'duration' on attack 'a0', which opens no debuff window/)
  })

  it('accepts a duration stat aimed at a duration attack', () => {
    expect(() => {
      validateModeDefinition(
        'test',
        withAttackStat(
          { type: 'attackStat', attack: 'a0', stat: 'duration', op: 'mult', value: 2 },
          WINDOW_A0,
        ),
      )
    }).not.toThrow()
  })

  // ── attackStat in context ────────────────────────────────────────
  //
  // The schema judges one ref on its own; these are the questions that need the
  // *host* (how many copies sell) or the *named attack* (what it authors). Each
  // asks the same thing: does this ref still do something at every level a
  // player can buy?

  /** Active, but free to activate — nothing for a `prepareCost` stat to move. */
  const FREE_A0: ModeDefinition['attacks'] = [
    {
      id: 'a0',
      kind: 'active',
      prepareTimeSec: 1,
      effects: [{ type: 'stealResource', resource: 'r0', fraction: 0.1 }],
    },
  ]

  /** Active, but strikes on the next tick — no delay for a `prepareTime` stat. */
  const INSTANT_A0: ModeDefinition['attacks'] = [
    {
      id: 'a0',
      kind: 'active',
      prepareCost: { r0: { baseCost: 10 } },
      prepareTimeSec: 0,
      effects: [{ type: 'stealResource', resource: 'r0', fraction: 0.1 }],
    },
  ]

  it('throws when a reducing add dies inside its own purchase limit', () => {
    const ref: EffectRef = {
      type: 'attackStat',
      attack: 'a0',
      stat: 'prepareCost',
      op: 'add',
      value: -0.2,
    }
    expect(() => {
      validateModeDefinition('test', withAttackStat(ref, ACTIVE_A0, 5))
    }).toThrow(/reaches a zero multiplier at 5 copies, within the upgrade's purchase limit of 5/)
    // One copy short of the zero point, every level still buys something.
    expect(() => {
      validateModeDefinition('test', withAttackStat(ref, ACTIVE_A0, 4))
    }).not.toThrow()
  })

  it('throws for a reducing add on an unlimited upgrade — it always reaches zero', () => {
    const ref: EffectRef = {
      type: 'attackStat',
      attack: 'a0',
      stat: 'prepareCost',
      op: 'add',
      value: -0.2,
    }
    expect(() => {
      validateModeDefinition('test', withAttackStat(ref, ACTIVE_A0, Infinity))
    }).toThrow(/use 'mult' for a reduction that keeps stacking/)
  })

  it('accepts the ops that never reach zero, however many copies sell', () => {
    // `mult` decays asymptotically and a growing `add` only climbs, so neither
    // has a level at which it stops buying anything.
    const mult: EffectRef = {
      type: 'attackStat',
      attack: 'a0',
      stat: 'prepareCost',
      op: 'mult',
      value: 0.9,
    }
    const grow: EffectRef = {
      type: 'attackStat',
      attack: 'a0',
      stat: 'power',
      op: 'add',
      value: 0.2,
    }
    expect(() => {
      validateModeDefinition('test', withAttackStat(mult, ACTIVE_A0, Infinity))
    }).not.toThrow()
    expect(() => {
      validateModeDefinition('test', withAttackStat(grow, ACTIVE_A0, Infinity))
    }).not.toThrow()
  })

  it('throws for a stat the named attack has no number for', () => {
    expect(() => {
      validateModeDefinition(
        'test',
        withAttackStat(
          { type: 'attackStat', attack: 'a0', stat: 'prepareCost', op: 'mult', value: 0.5 },
          FREE_A0,
        ),
      )
    }).toThrow(/moves 'prepareCost' on attack 'a0', which is free to activate/)
    expect(() => {
      validateModeDefinition(
        'test',
        withAttackStat(
          { type: 'attackStat', attack: 'a0', stat: 'prepareTime', op: 'mult', value: 0.5 },
          INSTANT_A0,
        ),
      )
    }).toThrow(/moves 'prepareTime' on attack 'a0', which has no prepare delay to move/)
  })

  it('throws when an offset already floors the delay at one copy', () => {
    // a0 waits 1s, so -1s leaves nothing for a second copy to take.
    expect(() => {
      validateModeDefinition(
        'test',
        withAttackStat(
          { type: 'attackStat', attack: 'a0', stat: 'prepareTime', op: 'offset', value: -1 },
          ACTIVE_A0,
          3,
        ),
      )
    }).toThrow(/already floors attack 'a0's 1s delay to 0 at one copy/)
    expect(() => {
      validateModeDefinition(
        'test',
        withAttackStat(
          { type: 'attackStat', attack: 'a0', stat: 'prepareTime', op: 'offset', value: -0.5 },
          ACTIVE_A0,
          3,
        ),
      )
    }).not.toThrow()
  })

  it('throws when an attackStat is carried by an attack rather than an upgrade', () => {
    const base = makeValidDef({
      attacks: [
        {
          id: 'a0',
          kind: 'passive',
          effects: [{ type: 'attackStat', attack: 'a0', stat: 'power', op: 'mult', value: 2 }],
        },
      ],
    })
    const def = withFlavor(base, {
      attacks: [{ id: 'a0', name: 'Odd', icon: '❓', description: '' }],
    })
    expect(() => {
      validateModeDefinition('test', def)
    }).toThrow(/'attackStat' effect, which only applies on the mode \/ an upgrade/)
  })

  it('throws when an unlockPact effect references an unknown pact', () => {
    const def = makeValidDef({
      upgrades: [
        {
          id: 'u0',
          cost: { r0: { baseCost: 10 } },
          purchaseLimit: 1,
          effects: [{ type: 'unlockPact', pact: 'p-missing' }],
        },
      ],
    })
    expect(() => {
      validateModeDefinition('test', def)
    }).toThrow(/upgrade 'u0' unlockPact effect references unknown pact 'p-missing'/)
  })

  it('accepts an unlockPact effect that references a defined pact', () => {
    const base = makeValidDef({
      pacts: [{ id: 'p0', kind: 'active' }],
      upgrades: [
        {
          id: 'u0',
          cost: { r0: { baseCost: 10 } },
          purchaseLimit: 1,
          effects: [{ type: 'unlockPact', pact: 'p0' }],
        },
      ],
    })
    const def = withFlavor(base, {
      pacts: [{ id: 'p0', name: 'Treaty', icon: '🤝', description: '' }],
    })
    expect(() => {
      validateModeDefinition('test', def)
    }).not.toThrow()
  })

  it('throws when a mechanical pact has no flavor entry', () => {
    const def = makeValidDef({ pacts: [{ id: 'p0', kind: 'active' }] })
    expect(() => {
      validateModeDefinition('test', def)
    }).toThrow(/missing flavor for pact 'p0'/)
  })

  it('throws when a pact flavor entry references an unknown pact', () => {
    const def = withFlavor(makeValidDef(), {
      pacts: [{ id: 'p-ghost', name: 'Ghost', icon: '👻', description: '' }],
    })
    expect(() => {
      validateModeDefinition('test', def)
    }).toThrow(/references unknown pact 'p-ghost'/)
  })

  // ── Pact effect placement ─────────────────────────────────────────

  /** A valid def with one pact carrying `effects`, its flavor entry in place. */
  function defWithPact(pact: ModeDefinition['pacts'][number]): ModeDefinition {
    return withFlavor(makeValidDef({ pacts: [pact] }), {
      pacts: [{ id: pact.id, name: 'Treaty', icon: '🤝', description: '' }],
    })
  }

  it('rejects a baseModifier on a pact — a pact that ignores the enemy is an upgrade', () => {
    const def = defWithPact({
      id: 'p0',
      kind: 'passive',
      effects: [{ type: 'baseModifier', stage: 'additive', field: 'r0', value: 1 }],
    })
    expect(() => {
      validateModeDefinition('test', def)
    }).toThrow(
      /passive pact 'p0' carries a 'baseModifier' effect, which only applies on the mode \/ an upgrade/,
    )
  })

  it('rejects an offensive effect on a pact — those are attack-only by declaration', () => {
    const def = defWithPact({
      id: 'p0',
      kind: 'active',
      effects: [
        { type: 'enemyProductionModifier', stage: 'multiplicative', field: 'r0', value: 0.9 },
      ],
    })
    expect(() => {
      validateModeDefinition('test', def)
    }).toThrow(
      /active pact 'p0' carries a 'enemyProductionModifier' effect, which only applies on a passive attack \/ an active attack/,
    )
  })

  it('rejects a mirrorCostModifier whose target is not in the purchase catalog', () => {
    const def = defWithPact({
      id: 'p0',
      kind: 'passive',
      effects: [{ type: 'mirrorCostModifier', target: 'upgrade:nope', costFactor: 0.5 }],
    })
    expect(() => {
      validateModeDefinition('test', def)
    }).toThrow(
      /pact 'p0' mirrorCostModifier effect references unknown purchase target 'upgrade:nope'/,
    )
  })

  it('accepts a mirrorCostModifier naming a real upgrade or a whole scope', () => {
    for (const target of ['upgrade:u0', 'upgrades', 'generators']) {
      const def = defWithPact({
        id: 'p0',
        kind: 'passive',
        effects: [{ type: 'mirrorCostModifier', target, costFactor: 0.5 }],
      })
      expect(() => {
        validateModeDefinition('test', def)
      }).not.toThrow()
    }
  })

  // The schema already bounds the factors; this is the boot rule for a
  // programmatically built mode, named ahead of the zod error.
  it('rejects a mirrorCostModifier factor outside (0, 1) — a pact is a discount', () => {
    for (const knob of ['costFactor', 'scalingFactor'] as const) {
      const def = defWithPact({
        id: 'p0',
        kind: 'passive',
        effects: [{ type: 'mirrorCostModifier', target: 'upgrades', [knob]: 1.5 }],
      })
      expect(() => {
        validateModeDefinition('test', def)
      }).toThrow(new RegExp(`pact 'p0' mirrorCostModifier ${knob} must be between 0 and 1`))
    }
  })

  const statRule = {
    type: 'mirrorStatModifier',
    source: 'score',
    field: 'r0',
    stage: 'multiplicative',
    perUnit: 0.01,
  }

  it('rejects a mirrorStatModifier whose source is not an enemy stat', () => {
    const def = defWithPact({
      id: 'p0',
      kind: 'passive',
      effects: [{ ...statRule, source: 'meta:peakCps' }],
    })
    expect(() => {
      validateModeDefinition('test', def)
    }).toThrow(/pact 'p0' mirrorStatModifier effect references unknown enemy stat 'meta:peakCps'/)
  })

  it('accepts every catalog source for a mirrorStatModifier', () => {
    for (const source of ['r0', 'r0:rate', 'peakCps', 'score', 'upgrades', 'upgrade:u0']) {
      const def = defWithPact({ id: 'p0', kind: 'passive', effects: [{ ...statRule, source }] })
      expect(() => {
        validateModeDefinition('test', def)
      }).not.toThrow()
    }
  })

  it('rejects a mirrorStatModifier field outside the debuff-target catalog', () => {
    // A generator output is folded before a pact bonus merges in — same rule
    // as for an enemy debuff, so the same catalog.
    const def = defWithPact({
      id: 'p0',
      kind: 'passive',
      effects: [{ ...statRule, field: 'b0' }],
    })
    expect(() => {
      validateModeDefinition('test', def)
    }).toThrow(/pact 'p0' mirrorStatModifier effect references unknown or unsupported field 'b0'/)
  })

  it('rejects an additive mirrorStatModifier on the highlight factor', () => {
    const def = defWithPact({
      id: 'p0',
      kind: 'passive',
      effects: [{ ...statRule, field: 'highlightFactor', stage: 'additive' }],
    })
    expect(() => {
      validateModeDefinition('test', def)
    }).toThrow(/targets 'highlightFactor' with stage 'additive'/)
    const ok = defWithPact({
      id: 'p0',
      kind: 'passive',
      effects: [{ ...statRule, field: 'highlightFactor' }],
    })
    expect(() => {
      validateModeDefinition('test', ok)
    }).not.toThrow()
  })

  it('rejects a non-positive perUnit or cap, named ahead of the schema', () => {
    for (const patch of [{ perUnit: 0 }, { cap: -1 }]) {
      const def = defWithPact({ id: 'p0', kind: 'passive', effects: [{ ...statRule, ...patch }] })
      expect(() => {
        validateModeDefinition('test', def)
      }).toThrow(/must be positive \(a pact is a bonus\)/)
    }
  })

  it('rejects a resource named after the enemy-stat score key', () => {
    const def = withFlavor(
      makeValidDef({ resources: ['r0', 'score'], initialResources: { r0: 0, score: 0 } }),
      {
        resources: [
          { key: 'r0', displayName: 'Res', icon: '🔵' },
          { key: 'score', displayName: 'Score', icon: '🏆' },
        ],
      },
    )
    expect(() => {
      validateModeDefinition('test', def)
    }).toThrow(/resource key 'score' collides with a reserved enemy-stat key/)
  })

  it('accepts a mutual pact with no effects (a placeholder that says what it will be)', () => {
    const def = defWithPact({ id: 'p0', kind: 'passive', mutual: true })
    expect(() => {
      validateModeDefinition('test', def)
    }).not.toThrow()
  })

  it('throws when a generatorCost effect references an unknown generator', () => {
    const def = makeValidDef({
      upgrades: [
        {
          id: 'u0',
          cost: { r0: { baseCost: 10 } },
          purchaseLimit: 1,
          effects: [{ type: 'generatorCost', generator: 'g-missing', costFactor: 0.95 }],
        },
      ],
    })
    expect(() => {
      validateModeDefinition('test', def)
    }).toThrow(/upgrade 'u0' generatorCost effect references unknown generator 'g-missing'/)
  })

  it('accepts a generatorCost effect that references a real generator', () => {
    const base = makeValidDef()
    const def = withFlavor(
      {
        ...base,
        generators: [
          {
            id: 'g0',
            cost: { r0: { baseCost: 10, scaleType: 'exponential', scaleFactor: 1.5 } },
            production: { resource: 'r0', rate: 1 },
          },
        ],
        upgrades: [
          {
            id: 'u0',
            cost: { r0: { baseCost: 10 } },
            purchaseLimit: 1,
            effects: [{ type: 'generatorCost', generator: 'g0', costFactor: 0.95 }],
          },
        ],
      },
      { generators: [genFlavorEntry('g0')] },
    )
    expect(() => {
      validateModeDefinition('test', def)
    }).not.toThrow()
  })

  it('throws when an accessEnemyData effect references an unknown resource', () => {
    const def = makeValidDef({
      upgrades: [
        {
          id: 'u0',
          cost: { r0: { baseCost: 10 } },
          purchaseLimit: 1,
          effects: [{ type: 'accessEnemyData', data: 'r-missing' }],
        },
      ],
    })
    expect(() => {
      validateModeDefinition('test', def)
    }).toThrow(/upgrade 'u0' accessEnemyData effect references unknown resource 'r-missing'/)
  })

  it('throws when an accessEnemyData :rate key names an unknown resource', () => {
    const def = makeValidDef({
      upgrades: [
        {
          id: 'u0',
          cost: { r0: { baseCost: 10 } },
          purchaseLimit: 1,
          effects: [{ type: 'accessEnemyData', data: 'r-missing:rate' }],
        },
      ],
    })
    expect(() => {
      validateModeDefinition('test', def)
    }).toThrow(/upgrade 'u0' accessEnemyData effect references unknown resource 'r-missing:rate'/)
  })

  it('accepts accessEnemyData effects naming a real resource (stockpile and :rate)', () => {
    const def = makeValidDef({
      upgrades: [
        {
          id: 'u0',
          cost: { r0: { baseCost: 10 } },
          purchaseLimit: 1,
          effects: [
            { type: 'accessEnemyData', data: 'r0' },
            { type: 'accessEnemyData', data: 'r0:rate' },
          ],
        },
      ],
    })
    expect(() => {
      validateModeDefinition('test', def)
    }).not.toThrow()
  })
})

// ─── getModeFlavor resolution ────────────────────────────────────────

describe('getModeFlavor', () => {
  const def = makeValidDef({
    flavors: [
      { ...makeValidDef().flavors[0], id: 'first' },
      { ...makeValidDef().flavors[0], id: 'second' },
    ],
  })

  it('returns the first flavor when no id is given', () => {
    expect(getModeFlavor(def).id).toBe('first')
  })

  it('returns the flavor matching the requested id', () => {
    expect(getModeFlavor(def, 'second').id).toBe('second')
  })

  it('falls back to the first flavor for an unknown id', () => {
    expect(getModeFlavor(def, 'nope').id).toBe('first')
  })
})

// ─── Lookup helpers (flavor.ts functions) ────────────────────────────

/** A standalone flavor object — NOT shared with the ones above so WeakMap
 *  caches start fresh for these tests. */
function makeFlavor(): ModeFlavor {
  return {
    id: 'test',
    displayName: 'Test',
    themeClass: 'theme-test',
    scoreLabel: 'Score',
    showClickStats: false,
    resources: [
      { key: 'r0', displayName: 'Gold', icon: '💰' },
      { key: 'r1', displayName: 'Wood', icon: '🪵' },
    ],
    upgrades: [
      { id: 'u0', name: 'Pickaxe', icon: '⛏️', description: 'Mine faster' },
      { id: 'u1', name: 'Furnace', icon: '🔥', description: 'Smelt ore' },
    ],
    generators: [
      { id: 'g0', name: 'Miner', icon: '⛏️' },
      { id: 'g1', name: 'Lumberjack', icon: '🪓' },
    ],
    attacks: [
      { id: 'a0', name: 'Raid', icon: '⚔️', description: 'A raid' },
      { id: 'a1', name: 'Siege', icon: '🏰', description: 'A siege' },
    ],
    pacts: [
      { id: 'p0', name: 'Treaty', icon: '🤝', description: 'A treaty' },
      { id: 'p1', name: 'Alliance', icon: '🛡️', description: 'An alliance' },
    ],
  }
}

describe('getResourceIcon', () => {
  it('returns the icon for a known resource key', () => {
    expect(getResourceIcon(makeFlavor(), 'r0')).toBe('💰')
    expect(getResourceIcon(makeFlavor(), 'r1')).toBe('🪵')
  })

  it('returns the raw key and warns for an unknown resource', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = getResourceIcon(makeFlavor(), 'r99')
    expect(result).toBe('r99')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('resource icon'))
    warn.mockRestore()
  })
})

describe('getResourceName', () => {
  it('returns the display name for a known resource key', () => {
    expect(getResourceName(makeFlavor(), 'r0')).toBe('Gold')
    expect(getResourceName(makeFlavor(), 'r1')).toBe('Wood')
  })

  it('returns the raw key and warns for an unknown resource', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = getResourceName(makeFlavor(), 'r99')
    expect(result).toBe('r99')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('resource name'))
    warn.mockRestore()
  })
})

describe('getUpgradeName', () => {
  it('returns the name for a known upgrade id', () => {
    expect(getUpgradeName(makeFlavor(), 'u0')).toBe('Pickaxe')
  })

  it('returns the raw id and warns for an unknown upgrade', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = getUpgradeName(makeFlavor(), 'u99')
    expect(result).toBe('u99')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('upgrade name'))
    warn.mockRestore()
  })
})

describe('getUpgradeIcon', () => {
  it('returns the icon for a known upgrade id', () => {
    expect(getUpgradeIcon(makeFlavor(), 'u0')).toBe('⛏️')
    expect(getUpgradeIcon(makeFlavor(), 'u1')).toBe('🔥')
  })

  it('returns the raw id and warns for an unknown upgrade', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = getUpgradeIcon(makeFlavor(), 'u99')
    expect(result).toBe('u99')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('upgrade icon'))
    warn.mockRestore()
  })
})

describe('getUpgradeDescription', () => {
  it('returns the description for a known upgrade id', () => {
    expect(getUpgradeDescription(makeFlavor(), 'u1')).toBe('Smelt ore')
  })

  it('returns empty string and warns for an unknown upgrade', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = getUpgradeDescription(makeFlavor(), 'u99')
    expect(result).toBe('')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('upgrade description'))
    warn.mockRestore()
  })
})

describe('getGeneratorName', () => {
  it('returns the name for a known generator id', () => {
    expect(getGeneratorName(makeFlavor(), 'g0')).toBe('Miner')
  })

  it('returns the raw id and warns for an unknown generator', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = getGeneratorName(makeFlavor(), 'g99')
    expect(result).toBe('g99')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('generator name'))
    warn.mockRestore()
  })
})

describe('getGeneratorIcon', () => {
  it('returns the icon for a known generator id', () => {
    expect(getGeneratorIcon(makeFlavor(), 'g1')).toBe('🪓')
  })

  it('returns the raw id and warns for an unknown generator', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = getGeneratorIcon(makeFlavor(), 'g99')
    expect(result).toBe('g99')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('generator icon'))
    warn.mockRestore()
  })
})

describe('attack flavor helpers', () => {
  it('returns name / icon / description for a known attack id', () => {
    expect(getAttackName(makeFlavor(), 'a0')).toBe('Raid')
    expect(getAttackIcon(makeFlavor(), 'a1')).toBe('🏰')
    expect(getAttackDescription(makeFlavor(), 'a0')).toBe('A raid')
  })

  it('falls back and warns for an unknown attack id', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(getAttackName(makeFlavor(), 'a99')).toBe('a99')
    expect(getAttackIcon(makeFlavor(), 'a99')).toBe('a99')
    expect(getAttackDescription(makeFlavor(), 'a99')).toBe('')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('attack name'))
    warn.mockRestore()
  })
})

describe('pact flavor helpers', () => {
  it('returns name / icon / description for a known pact id', () => {
    expect(getPactName(makeFlavor(), 'p0')).toBe('Treaty')
    expect(getPactIcon(makeFlavor(), 'p1')).toBe('🛡️')
    expect(getPactDescription(makeFlavor(), 'p0')).toBe('A treaty')
  })

  it('falls back and warns for an unknown pact id', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(getPactName(makeFlavor(), 'p99')).toBe('p99')
    expect(getPactIcon(makeFlavor(), 'p99')).toBe('p99')
    expect(getPactDescription(makeFlavor(), 'p99')).toBe('')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('pact name'))
    warn.mockRestore()
  })
})

describe('flavor lookup caching', () => {
  it('returns the same result on repeated calls (cache hit)', () => {
    const flavor = makeFlavor()
    // First call builds the cache
    const first = getResourceIcon(flavor, 'r0')
    // Second call should hit the cache
    const second = getResourceIcon(flavor, 'r0')
    expect(first).toBe(second)
    expect(first).toBe('💰')
  })

  it('uses separate caches for different flavor objects', () => {
    const flavor1 = makeFlavor()
    const flavor2: ModeFlavor = {
      ...makeFlavor(),
      resources: [
        { key: 'r0', displayName: 'Gems', icon: '💎' },
        { key: 'r1', displayName: 'Iron', icon: '🔩' },
      ],
    }
    expect(getResourceIcon(flavor1, 'r0')).toBe('💰')
    expect(getResourceIcon(flavor2, 'r0')).toBe('💎')
  })
})
