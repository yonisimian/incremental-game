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

const clickerDef = getModeDefinition('clicker')
const testUpgradeMap = new Map<string, UpgradeDefinition>(clickerDef.upgrades.map((u) => [u.id, u]))

describe('isValidPurchase', () => {
  function makeState(overrides: Partial<PlayerState> = {}): PlayerState {
    return {
      score: 0,
      resources: { currency: 50 },
      upgrades: {
        'auto-clicker': 0,
        'double-click': 0,
        multiplier: 0,
      },
      generators: {},
      meta: {},
      ...overrides,
    }
  }

  it('accepts a valid purchase', () => {
    expect(
      isValidPurchase(
        makeState({ resources: { currency: 10 } }),
        'auto-clicker',
        testUpgradeMap,
        clickerDef,
      ),
    ).toBe(true)
  })

  it('accepts at exact cost', () => {
    expect(
      isValidPurchase(
        makeState({ resources: { currency: 25 } }),
        'double-click',
        testUpgradeMap,
        clickerDef,
      ),
    ).toBe(true)
  })

  it('rejects if already owned', () => {
    const state = makeState({
      resources: { currency: 100 },
      upgrades: {
        'auto-clicker': 1,
        'double-click': 0,
        multiplier: 0,
      },
    })
    expect(isValidPurchase(state, 'auto-clicker', testUpgradeMap, clickerDef)).toBe(false)
  })

  it('rejects if too expensive', () => {
    expect(
      isValidPurchase(
        makeState({ resources: { currency: 9 } }),
        'auto-clicker',
        testUpgradeMap,
        clickerDef,
      ),
    ).toBe(false)
  })

  it('rejects an unknown upgrade ID', () => {
    expect(
      isValidPurchase(
        makeState({ resources: { currency: 9999 } }),
        'bogus',
        testUpgradeMap,
        clickerDef,
      ),
    ).toBe(false)
  })

  it('rejects a cross-mode upgrade not in the map', () => {
    expect(
      isValidPurchase(
        makeState({ resources: { currency: 9999 } }),
        'sharpened-axes',
        testUpgradeMap,
        clickerDef,
      ),
    ).toBe(false)
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
      resources: { currency: 9999 },
      upgrades: Object.fromEntries(clickerDef.upgrades.map((u) => [u.id, 0])),
      generators: {},
      meta: {},
    }
  }

  it('rejects the trophy under timed goal (filtered out of map)', () => {
    const timedGoal = { type: 'timed', durationSec: 30 } as const
    const filteredMap = new Map<string, UpgradeDefinition>(
      getAvailableUpgrades(clickerDef, timedGoal).map((u) => [u.id, u]),
    )
    expect(isValidPurchase(makeAffordableState(), 'coronation', filteredMap, clickerDef)).toBe(
      false,
    )
  })

  it('accepts the trophy under buy-upgrade goal when affordable', () => {
    const buyUpgradeGoal = { type: 'buy-upgrade', safetyCapSec: 600 } as const
    const filteredMap = new Map<string, UpgradeDefinition>(
      getAvailableUpgrades(clickerDef, buyUpgradeGoal).map((u) => [u.id, u]),
    )
    expect(isValidPurchase(makeAffordableState(), 'coronation', filteredMap, clickerDef)).toBe(true)
  })

  it('rejects the trophy under buy-upgrade goal when too expensive', () => {
    const buyUpgradeGoal = { type: 'buy-upgrade', safetyCapSec: 600 } as const
    const filteredMap = new Map<string, UpgradeDefinition>(
      getAvailableUpgrades(clickerDef, buyUpgradeGoal).map((u) => [u.id, u]),
    )
    const state = makeAffordableState()
    state.resources.currency = 100 // trophy costs 1000
    expect(isValidPurchase(state, 'coronation', filteredMap, clickerDef)).toBe(false)
  })
})

// ─── isValidPurchase: prerequisites (idler tree) ─────────────────────

const idlerDef = getModeDefinition('idler')
const idlerUpgradeMap = new Map<string, UpgradeDefinition>(idlerDef.upgrades.map((u) => [u.id, u]))

describe('isValidPurchase — prerequisites', () => {
  function makeIdlerState(overrides: Partial<PlayerState> = {}): PlayerState {
    return {
      score: 0,
      resources: { wood: 9999, ale: 9999 },
      upgrades: Object.fromEntries(idlerDef.upgrades.map((u) => [u.id, 0])),
      generators: {},
      meta: { highlight: 'wood' },
      ...overrides,
    }
  }

  it('rejects industrial-era when no prerequisites are owned (even with infinite resources)', () => {
    const state = makeIdlerState()
    expect(isValidPurchase(state, 'industrial-era', idlerUpgradeMap, idlerDef)).toBe(false)
  })

  it('rejects industrial-era when only one of two prerequisites is owned (AND-semantics)', () => {
    const state = makeIdlerState({
      upgrades: {
        ...Object.fromEntries(idlerDef.upgrades.map((u) => [u.id, 0])),
        'heavy-logging': 1, // royal-brewery still unowned
      },
    })
    expect(isValidPurchase(state, 'industrial-era', idlerUpgradeMap, idlerDef)).toBe(false)
  })

  it('accepts industrial-era when both prerequisites are owned', () => {
    const state = makeIdlerState({
      upgrades: {
        ...Object.fromEntries(idlerDef.upgrades.map((u) => [u.id, 0])),
        'heavy-logging': 1,
        'royal-brewery': 1,
      },
    })
    expect(isValidPurchase(state, 'industrial-era', idlerUpgradeMap, idlerDef)).toBe(true)
  })

  it('rejects master-craftsmen when royal-brewery is unowned', () => {
    const state = makeIdlerState()
    expect(isValidPurchase(state, 'master-craftsmen', idlerUpgradeMap, idlerDef)).toBe(false)
  })

  it('accepts root-level upgrades (no prerequisites) immediately', () => {
    const state = makeIdlerState()
    expect(isValidPurchase(state, 'heavy-logging', idlerUpgradeMap, idlerDef)).toBe(true)
    expect(isValidPurchase(state, 'royal-brewery', idlerUpgradeMap, idlerDef)).toBe(true)
  })
})
