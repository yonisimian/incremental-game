import { describe, expect, it } from 'vitest'
import {
  getUpgradeNextCost,
  getUpgradeBulkCost,
  getMaxAffordableUpgradeLevels,
} from '../src/upgrade-costs.js'
import type { UpgradeDefinition } from '../src/types.js'

const fixed: UpgradeDefinition = {
  id: 'f',
  cost: { r0: 10 },
  purchaseLimit: 5,
  modifiers: [],
}
const linear: UpgradeDefinition = {
  id: 'l',
  cost: { r0: 5 },
  purchaseLimit: 5,
  modifiers: [],
  costScaling: { type: 'linear', baseCost: 5, factor: 2 },
}
const expo: UpgradeDefinition = {
  id: 'e',
  cost: { r0: 3 },
  purchaseLimit: 5,
  modifiers: [],
  costScaling: { type: 'exponential', baseCost: 3, factor: 2 },
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
