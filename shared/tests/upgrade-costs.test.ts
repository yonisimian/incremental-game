import { describe, expect, it } from 'vitest'
import {
  getUpgradeNextCost,
  getUpgradeBulkCost,
  getMaxAffordableUpgradeLevels,
} from '../src/upgrade-costs.js'
import type { UpgradeDefinition } from '../src/types.js'

const fixed: UpgradeDefinition = {
  id: 'f',
  cost: { r0: { base: 10 } },
  purchaseLimit: 5,
}
const linear: UpgradeDefinition = {
  id: 'l',
  cost: { r0: { base: 5, scaleType: 'linear', scaleFactor: 0.4 } },
  purchaseLimit: 5,
}
const expo: UpgradeDefinition = {
  id: 'e',
  cost: { r0: { base: 3, scaleType: 'exponential', scaleFactor: 2 } },
  purchaseLimit: 5,
}

describe('upgrade costs', () => {
  it('fixed next cost', () => {
    expect(getUpgradeNextCost(fixed, 0)).toEqual({ r0: 10 })
    expect(getUpgradeNextCost(fixed, 3)).toEqual({ r0: 10 })
  })

  it('linear next cost', () => {
    expect(getUpgradeNextCost(linear, 0)).toEqual({ r0: 5 })
    expect(getUpgradeNextCost(linear, 1)).toEqual({ r0: 7 })
    expect(getUpgradeNextCost(linear, 3)).toEqual({ r0: 11 })
  })

  it('exponential next cost', () => {
    expect(getUpgradeNextCost(expo, 0)).toEqual({ r0: 3 })
    expect(getUpgradeNextCost(expo, 1)).toEqual({ r0: 6 })
    expect(getUpgradeNextCost(expo, 2)).toEqual({ r0: 12 })
  })

  it('scales only currencies with an entry, leaving others flat', () => {
    const mixed: UpgradeDefinition = {
      id: 'm',
      cost: { r0: { base: 8, scaleType: 'linear', scaleFactor: 0.5 }, r1: { base: 10 } },
      purchaseLimit: 5,
    }
    expect(getUpgradeNextCost(mixed, 0)).toEqual({ r0: 8, r1: 10 })
    // r0 grows (8 * (1 + 0.5*2) = 16); r1 has no entry so stays flat.
    expect(getUpgradeNextCost(mixed, 2)).toEqual({ r0: 16, r1: 10 })
  })

  it('bulk cost linear', () => {
    expect(getUpgradeBulkCost(linear, 0, 3)).toEqual({ r0: 5 + 7 + 9 })
  })

  it('bulk cost exponential', () => {
    expect(getUpgradeBulkCost(expo, 0, 3)).toEqual({ r0: 3 + 6 + 12 })
  })

  it('max affordable from budget', () => {
    expect(getMaxAffordableUpgradeLevels(linear, 0, { r0: 100 })).toBe(5)
    expect(getMaxAffordableUpgradeLevels(linear, 0, { r0: 0 })).toBe(0)
  })
})
