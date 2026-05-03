import { describe, expect, it } from 'vitest'
import type { ModeFlavor, UpgradeDefinition } from '@game/shared'
import { COUNTDOWN_SEC, ROUND_DURATION_SEC } from '@game/shared'
import type { GameState } from '../src/game.js'
import { canBuy, formatUpgradesPurchased, isUnlocked } from '../src/ui/helpers.js'

// ─── Test fixture helpers ────────────────────────────────────────────

function makeUpgrade(overrides: Partial<UpgradeDefinition> = {}): UpgradeDefinition {
  return {
    id: 'test-upgrade',
    cost: 10,
    modifiers: [],
    ...overrides,
  }
}

function makeState(overrides: Partial<GameState['player']> = {}): GameState {
  return {
    screen: 'playing',
    mode: 'idler',
    goal: { type: 'timed', durationSec: ROUND_DURATION_SEC },
    player: {
      score: 0,
      resources: { r0: 100, r1: 100 },
      upgrades: {},
      generators: {},
      meta: { highlight: 'r0' },
      ...overrides,
    },
    opponent: {
      score: 0,
      resources: {},
      upgrades: {},
      generators: {},
      meta: {},
    },
    timeLeft: ROUND_DURATION_SEC,
    matchId: 'test-match',
    upgrades: [],
    countdown: COUNTDOWN_SEC,
    endData: null,
    playerName: '',
    opponentName: '',
  }
}

// ─── isUnlocked ──────────────────────────────────────────────────────

describe('isUnlocked', () => {
  it('returns true when prerequisites are missing/undefined', () => {
    const u = makeUpgrade()
    expect(isUnlocked(makeState(), u)).toBe(true)
  })

  it('returns true when prerequisites array is empty', () => {
    const u = makeUpgrade({ prerequisites: [] })
    expect(isUnlocked(makeState(), u)).toBe(true)
  })

  it('returns true when all prerequisites are owned (count >= 1)', () => {
    const u = makeUpgrade({ prerequisites: ['parent-a', 'parent-b'] })
    const state = makeState({ upgrades: { 'parent-a': 1, 'parent-b': 1 } })
    expect(isUnlocked(state, u)).toBe(true)
  })

  it('returns false when any single prerequisite is unowned (AND-semantics)', () => {
    const u = makeUpgrade({ prerequisites: ['parent-a', 'parent-b'] })
    const state = makeState({ upgrades: { 'parent-a': 1, 'parent-b': 0 } })
    expect(isUnlocked(state, u)).toBe(false)
  })

  it('returns false when prerequisite key is missing entirely from upgrades map (treated as 0)', () => {
    const u = makeUpgrade({ prerequisites: ['ghost'] })
    const state = makeState({ upgrades: {} })
    expect(isUnlocked(state, u)).toBe(false)
  })

  it('returns true when prerequisite is owned multiple times (repeatable parent)', () => {
    const u = makeUpgrade({ prerequisites: ['stackable-parent'] })
    const state = makeState({ upgrades: { 'stackable-parent': 5 } })
    expect(isUnlocked(state, u)).toBe(true)
  })
})

// ─── canBuy ──────────────────────────────────────────────────────────

describe('canBuy', () => {
  it('returns true when unlocked AND can afford', () => {
    const u = makeUpgrade({ cost: 50, costCurrency: 'r0' })
    const state = makeState({ resources: { r0: 100, r1: 0 } })
    expect(canBuy(state, u)).toBe(true)
  })

  it('returns false when locked even if affordable', () => {
    const u = makeUpgrade({ cost: 50, costCurrency: 'r0', prerequisites: ['ghost'] })
    const state = makeState({ resources: { r0: 9999, r1: 9999 } })
    expect(canBuy(state, u)).toBe(false)
  })

  it('returns false when unlocked but cannot afford', () => {
    const u = makeUpgrade({ cost: 50, costCurrency: 'r0' })
    const state = makeState({ resources: { r0: 0, r1: 9999 } })
    expect(canBuy(state, u)).toBe(false)
  })

  it('returns false for one-shot upgrade already owned', () => {
    const u = makeUpgrade({ cost: 10, costCurrency: 'r0' })
    const state = makeState({
      resources: { r0: 9999, r1: 0 },
      upgrades: { 'test-upgrade': 1 },
    })
    expect(canBuy(state, u)).toBe(false)
  })

  it('returns true for repeatable upgrade already owned (with funds)', () => {
    const u = makeUpgrade({ cost: 10, costCurrency: 'r0', repeatable: true })
    const state = makeState({
      resources: { r0: 9999, r1: 0 },
      upgrades: { 'test-upgrade': 3 },
    })
    expect(canBuy(state, u)).toBe(true)
  })
})

// ─── formatUpgradesPurchased ─────────────────────────────────────────

describe('formatUpgradesPurchased', () => {
  const testFlavor: ModeFlavor = {
    themeClass: 'theme-test',
    scoreLabel: 'Score',
    showClickStats: false,
    resources: [],
    upgrades: [
      { id: 'u0', name: '🍻 Tavern Recruits', description: '' },
      { id: 'u1', name: '🪓 Sharpened Axes', description: '' },
      { id: 'u2', name: '🏗️ Lumber Mill', description: '' },
    ],
    generators: [],
  }

  it('returns "none" for an empty list', () => {
    expect(formatUpgradesPurchased([], testFlavor)).toBe('none')
  })

  it('shows a single non-repeated purchase as just the name', () => {
    expect(formatUpgradesPurchased(['u1'], testFlavor)).toBe('🪓 Sharpened Axes')
  })

  it('aggregates repeats with ×N suffix', () => {
    expect(formatUpgradesPurchased(['u0', 'u0', 'u0'], testFlavor)).toBe('🍻 Tavern Recruits ×3')
  })

  it('preserves first-purchase order across distinct ids', () => {
    expect(formatUpgradesPurchased(['u0', 'u1', 'u0', 'u2'], testFlavor)).toBe(
      '🍻 Tavern Recruits ×2, 🪓 Sharpened Axes, 🏗️ Lumber Mill',
    )
  })

  it('falls back to the raw id for unknown upgrades', () => {
    expect(formatUpgradesPurchased(['ghost', 'ghost'], testFlavor)).toBe('ghost ×2')
  })
})
