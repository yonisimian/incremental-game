import { describe, expect, it } from 'vitest'
import {
  getUpgradeNextCost,
  getUpgradeBulkCost,
  getMaxAffordableUpgradeLevels,
} from '../src/upgrade-costs.js'
import type { UpgradeDefinition } from '../src/types.js'

const fixed: UpgradeDefinition = {
  id: 'f',
  cost: 10,
  purchaseLimit: 5,
  modifiers: [],
  costCurrency: undefined,
}
const linear: UpgradeDefinition = {
  id: 'l',
  cost: 0,
  purchaseLimit: 5,
  modifiers: [],
  costCurrency: undefined,
  costScaling: { type: 'linear', baseCost: 5, factor: 2 },
}
const expo: UpgradeDefinition = {
  id: 'e',
  cost: 0,
  purchaseLimit: 5,
  modifiers: [],
  costCurrency: undefined,
  costScaling: { type: 'exponential', baseCost: 3, factor: 2 },
}

describe('upgrade costs', () => {
  it('fixed next cost', () => {
    expect(getUpgradeNextCost(fixed, 0)).toBe(10)
    expect(getUpgradeNextCost(fixed, 3)).toBe(10)
  })

  it('linear next cost', () => {
    expect(getUpgradeNextCost(linear, 0)).toBe(5)
    expect(getUpgradeNextCost(linear, 1)).toBe(7)
    expect(getUpgradeNextCost(linear, 3)).toBe(11)
  })

  it('exponential next cost', () => {
    expect(getUpgradeNextCost(expo, 0)).toBe(3)
    expect(getUpgradeNextCost(expo, 1)).toBe(6)
    expect(getUpgradeNextCost(expo, 2)).toBe(12)
  })

  it('bulk cost linear', () => {
    expect(getUpgradeBulkCost(linear, 0, 3)).toBe(5 + 7 + 9)
  })

  it('bulk cost exponential', () => {
    expect(getUpgradeBulkCost(expo, 0, 3)).toBe(3 + 6 + 12)
  })

  it('max affordable from budget', () => {
    expect(getMaxAffordableUpgradeLevels(linear, 0, 100)).toBe(5)
    expect(getMaxAffordableUpgradeLevels(linear, 0, 0)).toBe(0)
  })
})
