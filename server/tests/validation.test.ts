import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isValidClick, isValidPurchase } from '../src/validation.js'
import { MAX_CPS, getAvailableUpgrades, getModeDefinition } from '@game/shared'
import type { PlayerState, UpgradeDefinition } from '@game/shared'

// ─── isValidClick ────────────────────────────────────────────────────

describe('isValidClick', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('accepts the first click', () => {
    const timestamps: number[] = []
    expect(isValidClick(timestamps)).toBe(true)
  })

  it('records the server timestamp', () => {
    vi.setSystemTime(5000)
    const timestamps: number[] = []
    isValidClick(timestamps)
    expect(timestamps).toEqual([5000])
  })

  it('accepts up to MAX_CPS clicks in one second', () => {
    const timestamps: number[] = []
    for (let i = 0; i < MAX_CPS; i++) {
      expect(isValidClick(timestamps)).toBe(true)
    }
    expect(timestamps).toHaveLength(MAX_CPS)
  })

  it('rejects the click that exceeds MAX_CPS', () => {
    const timestamps: number[] = []
    for (let i = 0; i < MAX_CPS; i++) {
      isValidClick(timestamps)
    }
    expect(isValidClick(timestamps)).toBe(false)
  })

  it('prunes old timestamps and accepts clicks after the window', () => {
    const timestamps: number[] = []
    for (let i = 0; i < MAX_CPS; i++) {
      isValidClick(timestamps)
    }
    vi.advanceTimersByTime(1001)
    expect(isValidClick(timestamps)).toBe(true)
    expect(timestamps).toHaveLength(1)
  })
})

// ─── isValidPurchase ─────────────────────────────────────────────────

const idlerDef = getModeDefinition('idler')
const testUpgradeMap = new Map<string, UpgradeDefinition>(idlerDef.upgrades.map((u) => [u.id, u]))

describe('isValidPurchase', () => {
  function makeState(overrides: Partial<PlayerState> = {}): PlayerState {
    return {
      score: 0,
      resources: { r0: 50 },
      upgrades: {
        'sh-unlock': 0,
        'sc-unlock': 0,
      },
      generators: {},
      meta: {},
      ...overrides,
    }
  }

  it('accepts a valid purchase', () => {
    expect(isValidPurchase(makeState({ resources: { r0: 5 } }), 'sh-unlock', testUpgradeMap)).toBe(
      true,
    )
  })

  it('accepts at exact cost', () => {
    expect(isValidPurchase(makeState({ resources: { r0: 50 } }), 'sc-unlock', testUpgradeMap)).toBe(
      true,
    )
  })

  it('rejects if already owned', () => {
    const state = makeState({
      resources: { r0: 100 },
      upgrades: {
        'sh-unlock': 1,
        'sc-unlock': 0,
      },
    })
    expect(isValidPurchase(state, 'sh-unlock', testUpgradeMap)).toBe(false)
  })

  it('rejects if too expensive', () => {
    expect(isValidPurchase(makeState({ resources: { r0: 49 } }), 'sc-unlock', testUpgradeMap)).toBe(
      false,
    )
  })

  it('rejects an unknown upgrade ID', () => {
    expect(isValidPurchase(makeState({ resources: { r0: 9999 } }), 'bogus', testUpgradeMap)).toBe(
      false,
    )
  })

  it('rejects a cross-mode upgrade not in the map', () => {
    expect(isValidPurchase(makeState({ resources: { r0: 9999 } }), 'u3', testUpgradeMap)).toBe(
      false,
    )
  })
})
describe('isValidPurchase — choice groups', () => {
  const groupUpgrades: UpgradeDefinition[] = [
    { id: 'choice-a', cost: { r0: 10 }, purchaseLimit: 1, modifiers: [], choiceGroup: 'branch' },
    { id: 'choice-b', cost: { r0: 10 }, purchaseLimit: 1, modifiers: [], choiceGroup: 'branch' },
  ]
  const groupMap = new Map(groupUpgrades.map((u) => [u.id, u]))

  function makeGroupState(overrides: Partial<PlayerState> = {}): PlayerState {
    return {
      score: 0,
      resources: { r0: 9999 },
      upgrades: { 'choice-a': 0, 'choice-b': 0, ...overrides.upgrades },
      generators: {},
      meta: {},
      ...overrides,
    }
  }

  it('accepts the first choice in a group when affordable', () => {
    expect(isValidPurchase(makeGroupState(), 'choice-a', groupMap)).toBe(true)
  })

  it('rejects a second choice in the same group once one is owned', () => {
    const state = makeGroupState({ upgrades: { 'choice-a': 1, 'choice-b': 0 } })
    expect(isValidPurchase(state, 'choice-b', groupMap)).toBe(false)
  })
})
// ─── isValidPurchase: goal-tagged upgrades ───────────────────────────

describe('isValidPurchase — goal-tagged upgrades', () => {
  // Trophy is tagged with goalType: 'buy-upgrade' and is filtered out of the
  // upgrade map under any other goal. Validation enforces this purely via
  // map presence — no signature change in isValidPurchase.

  function makeAffordableState(): PlayerState {
    return {
      score: 0,
      resources: { r0: 99999 },
      upgrades: Object.fromEntries(idlerDef.upgrades.map((u) => [u.id, 0])),
      generators: {},
      meta: {},
    }
  }

  it('rejects the trophy under timed goal (filtered out of map)', () => {
    const timedGoal = { type: 'timed', label: '⏱ Timed', durationSec: 30 } as const
    const filteredMap = new Map<string, UpgradeDefinition>(
      getAvailableUpgrades(idlerDef, timedGoal).map((u) => [u.id, u]),
    )
    expect(isValidPurchase(makeAffordableState(), 'goal', filteredMap)).toBe(false)
  })

  it('accepts the trophy under buy-upgrade goal when affordable', () => {
    const buyUpgradeGoal = {
      type: 'buy-upgrade',
      label: '🏆 Race to Buy',
      safetyCapSec: 600,
    } as const
    const filteredMap = new Map<string, UpgradeDefinition>(
      getAvailableUpgrades(idlerDef, buyUpgradeGoal).map((u) => [u.id, u]),
    )
    expect(isValidPurchase(makeAffordableState(), 'goal', filteredMap)).toBe(true)
  })

  it('rejects the trophy under buy-upgrade goal when too expensive', () => {
    const buyUpgradeGoal = {
      type: 'buy-upgrade',
      label: '🏆 Race to Buy',
      safetyCapSec: 600,
    } as const
    const filteredMap = new Map<string, UpgradeDefinition>(
      getAvailableUpgrades(idlerDef, buyUpgradeGoal).map((u) => [u.id, u]),
    )
    const state = makeAffordableState()
    state.resources.r0 = 100 // trophy costs 30000
    expect(isValidPurchase(state, 'goal', filteredMap)).toBe(false)
  })
})

// ─── isValidPurchase: prerequisites ──────────────────────────────────

describe('isValidPurchase — prerequisites', () => {
  // Self-contained prerequisite fixtures (independent of any mode's tree).
  const prereqUpgrades: UpgradeDefinition[] = [
    { id: 'root', cost: { r0: 1 }, purchaseLimit: 1, modifiers: [] },
    { id: 'a', cost: { r0: 1 }, purchaseLimit: 1, modifiers: [] },
    { id: 'b', cost: { r0: 1 }, purchaseLimit: 1, modifiers: [] },
    {
      id: 'andChild', // requires root
      cost: { r0: 1 },
      purchaseLimit: 1,
      modifiers: [],
      prerequisites: { type: 'all', items: [{ type: 'upgrade', id: 'root' }] },
    },
    {
      id: 'orChild', // requires a OR b
      cost: { r0: 1 },
      purchaseLimit: 1,
      modifiers: [],
      prerequisites: {
        type: 'any',
        items: [
          { type: 'upgrade', id: 'a' },
          { type: 'upgrade', id: 'b' },
        ],
      },
    },
  ]
  const prereqMap = new Map(prereqUpgrades.map((u) => [u.id, u]))

  function makeState(overrides: Partial<PlayerState> = {}): PlayerState {
    return {
      score: 0,
      resources: { r0: 9999, r1: 9999 },
      upgrades: Object.fromEntries(prereqUpgrades.map((u) => [u.id, 0])),
      generators: {},
      meta: { highlight: 'r0' },
      ...overrides,
    }
  }

  it('accepts root-level upgrades (no prerequisites) immediately', () => {
    const state = makeState()
    expect(isValidPurchase(state, 'root', prereqMap)).toBe(true)
  })

  it('rejects an AND-prereq child when its prerequisite is unowned', () => {
    const state = makeState()
    expect(isValidPurchase(state, 'andChild', prereqMap)).toBe(false)
  })

  it('accepts an AND-prereq child once its prerequisite is owned', () => {
    const state = makeState({
      upgrades: { ...Object.fromEntries(prereqUpgrades.map((u) => [u.id, 0])), root: 1 },
    })
    expect(isValidPurchase(state, 'andChild', prereqMap)).toBe(true)
  })

  it('rejects an OR-prereq child when neither branch is owned', () => {
    const state = makeState()
    expect(isValidPurchase(state, 'orChild', prereqMap)).toBe(false)
  })

  it('accepts an OR-prereq child when at least one branch is owned', () => {
    const state = makeState({
      upgrades: { ...Object.fromEntries(prereqUpgrades.map((u) => [u.id, 0])), a: 1 },
    })
    expect(isValidPurchase(state, 'orChild', prereqMap)).toBe(true)
  })
})
