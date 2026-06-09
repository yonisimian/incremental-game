import { describe, expect, it } from 'vitest'
import {
  formatPrerequisiteExpression,
  isPrerequisiteSatisfied,
  validateUpgradePrerequisites,
} from '../src/prerequisites.js'
import type { PlayerState, UpgradeDefinition } from '../src/types.js'

const baseState: PlayerState = {
  score: 0,
  resources: { r0: 0 },
  upgrades: { u0: 0, u1: 0, u2: 0 },
  generators: {},
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
})

describe('validateUpgradePrerequisites', () => {
  function makeUpgrade(
    id: string,
    prerequisites?: UpgradeDefinition['prerequisites'],
  ): UpgradeDefinition {
    return {
      id,
      cost: { r0: 0 },
      purchaseLimit: 1,
      modifiers: [],
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
})
