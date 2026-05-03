import { describe, expect, it, vi } from 'vitest'
import { getModeDefinition, validateModeDefinition } from '../src/modes/index.js'
import type { ModeDefinition, ModeFlavor } from '../src/modes/types.js'
import type { GameMode } from '../src/types.js'
import {
  getResourceIcon,
  getResourceName,
  getUpgradeName,
  getUpgradeDescription,
  getGeneratorName,
  getGeneratorIcon,
} from '../src/flavor.js'

// ─── Positive: real modes pass validation ────────────────────────────

const MODES: GameMode[] = ['clicker', 'idler']

for (const mode of MODES) {
  const def = getModeDefinition(mode)
  const f = def.flavor

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
    upgrades: [{ id: 'u0', cost: 10, modifiers: [] }],
    goals: [{ type: 'timed', durationSec: 30 }],
    nativeModifiers: [],
    clicksEnabled: true,
    highlightEnabled: false,
    initialResources: { r0: 0 },
    initialMeta: {},
    generators: [],
    flavor: {
      themeClass: 'theme-test',
      scoreLabel: 'Score',
      showClickStats: false,
      resources: [{ key: 'r0', displayName: 'Res', icon: '🔵' }],
      upgrades: [{ id: 'u0', name: 'Upg', description: 'desc' }],
      generators: [],
    },
  }
  return { ...base, ...overrides }
}

/** Return a new flavor with selected arrays overridden. */
function withFlavor(def: ModeDefinition, patch: Partial<ModeFlavor>): ModeDefinition {
  return { ...def, flavor: { ...def.flavor, ...patch } }
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
          baseCost: 5,
          costScaling: 1,
          costCurrency: 'r0',
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
        { id: 'u0', name: 'Upg', description: 'desc' },
        { id: 'u_ghost', name: 'Ghost', description: 'no matching mechanic' },
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
})

// ─── Lookup helpers (flavor.ts functions) ────────────────────────────

/** A standalone flavor object — NOT shared with the ones above so WeakMap
 *  caches start fresh for these tests. */
function makeFlavor(): ModeFlavor {
  return {
    themeClass: 'theme-test',
    scoreLabel: 'Score',
    showClickStats: false,
    resources: [
      { key: 'r0', displayName: 'Gold', icon: '💰' },
      { key: 'r1', displayName: 'Wood', icon: '🪵' },
    ],
    upgrades: [
      { id: 'u0', name: 'Pickaxe', description: 'Mine faster' },
      { id: 'u1', name: 'Furnace', description: 'Smelt ore' },
    ],
    generators: [
      { id: 'g0', name: 'Miner', icon: '⛏️' },
      { id: 'g1', name: 'Lumberjack', icon: '🪓' },
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
