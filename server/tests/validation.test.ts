import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isValidClick, isValidPurchase } from '../src/validation.js'
import { MAX_CPS, CLICKER_UPGRADES } from '@game/shared'
import type { PlayerState, UpgradeDefinition, UpgradeId } from '@game/shared'

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

const testUpgradeMap = new Map<UpgradeId, UpgradeDefinition>(CLICKER_UPGRADES.map((u) => [u.id, u]))

describe('isValidPurchase', () => {
  function makeState(overrides: Partial<PlayerState> = {}): PlayerState {
    return {
      score: 0,
      currency: 50,
      upgrades: {
        'auto-clicker': false,
        'double-click': false,
        multiplier: false,
        accelerator: false,
        'double-income': false,
      },
      ...overrides,
    }
  }

  it('accepts a valid purchase', () => {
    expect(isValidPurchase(makeState({ currency: 10 }), 'auto-clicker', testUpgradeMap)).toBe(true)
  })

  it('accepts at exact cost', () => {
    expect(isValidPurchase(makeState({ currency: 25 }), 'double-click', testUpgradeMap)).toBe(true)
  })

  it('rejects if already owned', () => {
    const state = makeState({
      currency: 100,
      upgrades: {
        'auto-clicker': true,
        'double-click': false,
        multiplier: false,
        accelerator: false,
        'double-income': false,
      },
    })
    expect(isValidPurchase(state, 'auto-clicker', testUpgradeMap)).toBe(false)
  })

  it('rejects if too expensive', () => {
    expect(isValidPurchase(makeState({ currency: 9 }), 'auto-clicker', testUpgradeMap)).toBe(false)
  })

  it('rejects an unknown upgrade ID', () => {
    expect(isValidPurchase(makeState({ currency: 9999 }), 'bogus' as any, testUpgradeMap)).toBe(
      false,
    )
  })

  it('rejects a cross-mode upgrade not in the map', () => {
    expect(isValidPurchase(makeState({ currency: 9999 }), 'accelerator', testUpgradeMap)).toBe(
      false,
    )
  })
})
