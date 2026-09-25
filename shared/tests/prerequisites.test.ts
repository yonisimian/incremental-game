import { describe, expect, it } from 'vitest'
import {
  formatPrerequisiteExpression,
  getPrerequisiteUpgradeIds,
  isPrerequisiteSatisfied,
  validateUpgradePrerequisites,
} from '../src/prerequisites.js'
import type { PrerequisiteMetaKey } from '../src/prerequisites.js'
import type { PlayerState, PrerequisiteExpression, UpgradeDefinition } from '../src/types.js'

const baseState: PlayerState = {
  score: 0,
  resources: { r0: 0 },
  upgrades: { u0: 0, u1: 0, u2: 0 },
  generators: {},
  pendingAttacks: [],
  meta: {},
}

const ownedState: PlayerState = {
  ...baseState,
  upgrades: { u0: 1, u1: 0, u2: 1 },
}

const levelTwoState: PlayerState = {
  ...baseState,
  upgrades: { u0: 2, u1: 0, u2: 1 },
}

describe('isPrerequisiteSatisfied', () => {
  it('accepts no prerequisites', () => {
    expect(isPrerequisiteSatisfied(undefined, baseState)).toBe(true)
  })

  it('supports AND expressions', () => {
    expect(
      isPrerequisiteSatisfied(
        {
          type: 'all',
          items: [
            { type: 'upgrade', id: 'u0' },
            { type: 'upgrade', id: 'u2' },
          ],
        },
        ownedState,
      ),
    ).toBe(true)
    expect(
      isPrerequisiteSatisfied(
        {
          type: 'all',
          items: [
            { type: 'upgrade', id: 'u0' },
            { type: 'upgrade', id: 'u1' },
          ],
        },
        ownedState,
      ),
    ).toBe(false)
  })

  it('supports OR expressions', () => {
    expect(
      isPrerequisiteSatisfied(
        {
          type: 'any',
          items: [
            { type: 'upgrade', id: 'u0' },
            { type: 'upgrade', id: 'u1' },
          ],
        },
        ownedState,
      ),
    ).toBe(true)
    expect(
      isPrerequisiteSatisfied(
        {
          type: 'any',
          items: [
            { type: 'upgrade', id: 'u1' },
            { type: 'upgrade', id: 'u2' },
          ],
        },
        baseState,
      ),
    ).toBe(false)
  })

  it('supports upgrade minLevel requirements', () => {
    expect(isPrerequisiteSatisfied({ type: 'upgrade', id: 'u0', minLevel: 2 }, levelTwoState)).toBe(
      true,
    )
    expect(isPrerequisiteSatisfied({ type: 'upgrade', id: 'u0', minLevel: 2 }, ownedState)).toBe(
      false,
    )
  })

  it('supports nested AND/OR expressions', () => {
    const expr = {
      type: 'any' as const,
      items: [
        { type: 'upgrade' as const, id: 'u1' },
        {
          type: 'all' as const,
          items: [
            { type: 'upgrade' as const, id: 'u0' },
            { type: 'upgrade' as const, id: 'u2' },
          ],
        },
      ],
    }
    expect(isPrerequisiteSatisfied(expr, ownedState)).toBe(true)
  })

  describe('meta prerequisites', () => {
    const hitOnce: PrerequisiteExpression = { type: 'meta', key: 'attacksSuffered', min: 1 }

    it('reads an unstamped counter as zero', () => {
      expect(isPrerequisiteSatisfied(hitOnce, baseState)).toBe(false)
    })

    it('is satisfied once the counter reaches min (inclusive)', () => {
      const hit = { ...baseState, meta: { attacksSuffered: 1 } }
      expect(isPrerequisiteSatisfied(hitOnce, hit)).toBe(true)
      expect(isPrerequisiteSatisfied({ type: 'meta', key: 'attacksSuffered', min: 2 }, hit)).toBe(
        false,
      )
      expect(
        isPrerequisiteSatisfied(
          { type: 'meta', key: 'attacksSuffered', min: 2 },
          { ...baseState, meta: { attacksSuffered: 2 } },
        ),
      ).toBe(true)
    })

    it('ignores a non-numeric value under the key', () => {
      const odd = { ...baseState, meta: { attacksSuffered: 'lots' } }
      expect(isPrerequisiteSatisfied(hitOnce, odd)).toBe(false)
    })

    it('composes with upgrade prerequisites', () => {
      const expr: PrerequisiteExpression = {
        type: 'all',
        items: [{ type: 'upgrade', id: 'u0' }, hitOnce],
      }
      expect(isPrerequisiteSatisfied(expr, ownedState)).toBe(false)
      expect(isPrerequisiteSatisfied(expr, { ...ownedState, meta: { attacksSuffered: 1 } })).toBe(
        true,
      )
    })
  })
})

describe('getPrerequisiteUpgradeIds', () => {
  it('omits meta prerequisites, which name no upgrade', () => {
    expect(
      getPrerequisiteUpgradeIds({
        type: 'all',
        items: [
          { type: 'upgrade', id: 'u0' },
          { type: 'meta', key: 'attacksSuffered', min: 1 },
        ],
      }),
    ).toEqual(['u0'])
    expect(getPrerequisiteUpgradeIds({ type: 'meta', key: 'attacksSuffered', min: 1 })).toEqual([])
  })
})

describe('formatPrerequisiteExpression', () => {
  it('renders nested expressions with parentheses', () => {
    const expr = {
      type: 'any' as const,
      items: [
        { type: 'upgrade' as const, id: 'u1' },
        {
          type: 'all' as const,
          items: [
            { type: 'upgrade' as const, id: 'u0' },
            { type: 'upgrade' as const, id: 'u2' },
          ],
        },
      ],
    }
    expect(formatPrerequisiteExpression(expr)).toBe('u1 or (u0 and u2)')
  })

  it('renders minLevel requirements', () => {
    expect(formatPrerequisiteExpression({ type: 'upgrade', id: 'u0', minLevel: 3 })).toBe(
      'u0 (level 3+)',
    )
  })

  it('resolves upgrade ids to display names when a resolver is given', () => {
    const expr = {
      type: 'any' as const,
      items: [
        { type: 'upgrade' as const, id: 'u6' },
        { type: 'upgrade' as const, id: 'u7', minLevel: 2 },
      ],
    }
    const names: Record<string, string> = { u6: 'Sawmill', u7: 'Tavern' }
    expect(formatPrerequisiteExpression(expr, (id) => names[id] ?? id)).toBe(
      'Sawmill or Tavern (level 2+)',
    )
  })

  it('renders a meta prerequisite by its label, with ×N above one', () => {
    expect(formatPrerequisiteExpression({ type: 'meta', key: 'attacksSuffered', min: 1 })).toBe(
      'being hit by an enemy attack',
    )
    expect(formatPrerequisiteExpression({ type: 'meta', key: 'attacksSuffered', min: 3 })).toBe(
      'being hit by an enemy attack ×3',
    )
    expect(
      formatPrerequisiteExpression({
        type: 'all',
        items: [
          { type: 'upgrade', id: 'u0' },
          { type: 'meta', key: 'attacksSuffered', min: 1 },
        ],
      }),
    ).toBe('u0 and being hit by an enemy attack')
  })
})

describe('validateUpgradePrerequisites', () => {
  function makeUpgrade(
    id: string,
    prerequisites?: UpgradeDefinition['prerequisites'],
  ): UpgradeDefinition {
    return {
      id,
      cost: { r0: { baseCost: 0 } },
      purchaseLimit: 1,
      prerequisites,
    }
  }

  it('accepts valid nested prerequisite graphs', () => {
    expect(() => {
      validateUpgradePrerequisites([
        makeUpgrade('u0'),
        makeUpgrade('u1', { type: 'any', items: [{ type: 'upgrade', id: 'u0' }] }),
        makeUpgrade('u2', { type: 'all', items: [{ type: 'upgrade', id: 'u1' }] }),
      ])
    }).not.toThrow()
  })

  it('rejects unknown upgrade references', () => {
    expect(() => {
      validateUpgradePrerequisites([
        makeUpgrade('u0', {
          type: 'all',
          items: [{ type: 'upgrade', id: 'u1' }],
        }),
      ])
    }).toThrow(/unknown prerequisite/)
  })

  it('rejects invalid minLevel values', () => {
    expect(() => {
      validateUpgradePrerequisites([
        makeUpgrade('u0', {
          type: 'all',
          items: [{ type: 'upgrade', id: 'u1', minLevel: 0 }],
        }),
        makeUpgrade('u1'),
      ])
    }).toThrow(/invalid minLevel/)
  })

  it('rejects minLevel values higher than the referenced upgrade max level', () => {
    expect(() => {
      validateUpgradePrerequisites([
        makeUpgrade('u0', {
          type: 'all',
          items: [{ type: 'upgrade', id: 'u1', minLevel: 2 }],
        }),
        makeUpgrade('u1'),
      ])
    }).toThrow(/greater than max level/)
  })

  it('rejects direct cycles', () => {
    expect(() => {
      validateUpgradePrerequisites([
        makeUpgrade('u0', {
          type: 'all',
          items: [{ type: 'upgrade', id: 'u1' }],
        }),
        makeUpgrade('u1', {
          type: 'all',
          items: [{ type: 'upgrade', id: 'u0' }],
        }),
      ])
    }).toThrow(/circular dependency detected/)
  })

  it('rejects empty all/any expressions', () => {
    expect(() => {
      validateUpgradePrerequisites([makeUpgrade('u0', { type: 'any', items: [] })])
    }).toThrow(/empty 'any' prerequisite group/)
  })

  it('accepts a whitelisted meta prerequisite and keeps it out of the cycle graph', () => {
    expect(() => {
      validateUpgradePrerequisites([
        makeUpgrade('u0', { type: 'meta', key: 'attacksSuffered', min: 1 }),
        makeUpgrade('u1', {
          type: 'all',
          items: [
            { type: 'upgrade', id: 'u0' },
            { type: 'meta', key: 'attacksSuffered', min: 2 },
          ],
        }),
      ])
    }).not.toThrow()
  })

  it('rejects an unknown meta key', () => {
    expect(() => {
      validateUpgradePrerequisites([
        makeUpgrade('u0', {
          type: 'meta',
          key: 'notAKey' as PrerequisiteMetaKey,
          min: 1,
        }),
      ])
    }).toThrow(/unknown meta prerequisite 'notAKey'/)
  })

  it('rejects a meta min that is not a positive integer', () => {
    for (const min of [0, -1, 1.5]) {
      expect(() => {
        validateUpgradePrerequisites([
          makeUpgrade('u0', { type: 'meta', key: 'attacksSuffered', min }),
        ])
      }).toThrow(/invalid min/)
    }
  })
})
