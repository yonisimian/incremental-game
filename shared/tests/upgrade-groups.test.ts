import { describe, expect, it } from 'vitest'
import type { PlayerState, UpgradeDefinition } from '../src/types.js'
import { isChoiceGroupAvailable, validateUpgradeChoiceGroups } from '../src/upgrade-groups.js'

const choiceUpgrades: readonly UpgradeDefinition[] = [
  { id: 'choice-a', cost: { r0: 1 }, purchaseLimit: 1, choiceGroup: 'branch' },
  { id: 'choice-b', cost: { r0: 1 }, purchaseLimit: 1, choiceGroup: 'branch' },
  { id: 'normal', cost: { r0: 1 }, purchaseLimit: 1 },
]

function makeState(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    score: 0,
    resources: { r0: 0 },
    upgrades: { 'choice-a': 0, 'choice-b': 0, normal: 0, ...overrides.upgrades },
    generators: {},
    meta: {},
    ...overrides,
  }
}

describe('isChoiceGroupAvailable', () => {
  it('allows purchase when upgrade is not part of a choice group', () => {
    const state = makeState()
    expect(isChoiceGroupAvailable(choiceUpgrades[2], state, choiceUpgrades)).toBe(true)
  })

  it('allows purchase when no sibling choices are owned', () => {
    const state = makeState()
    expect(isChoiceGroupAvailable(choiceUpgrades[0], state, choiceUpgrades)).toBe(true)
  })

  it('rejects purchase when a sibling choice in the same group is owned', () => {
    const state = makeState({ upgrades: { 'choice-a': 1 } })
    expect(isChoiceGroupAvailable(choiceUpgrades[1], state, choiceUpgrades)).toBe(false)
  })

  it('still allows repeat purchase of the same group member', () => {
    const state = makeState({ upgrades: { 'choice-a': 1 } })
    expect(isChoiceGroupAvailable(choiceUpgrades[0], state, choiceUpgrades)).toBe(true)
  })
})

describe('validateUpgradeChoiceGroups', () => {
  it('accepts valid non-empty group identifiers', () => {
    expect(() => {
      validateUpgradeChoiceGroups(choiceUpgrades)
    }).not.toThrow()
  })

  it('rejects an empty choiceGroup identifier', () => {
    const invalid: UpgradeDefinition[] = [
      { id: 'bad', cost: { r0: 1 }, purchaseLimit: 1, choiceGroup: '' },
    ]
    expect(() => {
      validateUpgradeChoiceGroups(invalid)
    }).toThrow("[choiceGroups] upgrade 'bad' has empty choiceGroup")
  })
})
