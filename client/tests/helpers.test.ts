import { describe, expect, it } from 'vitest'
import type { UpgradeDefinition } from '@game/shared'
import { COUNTDOWN_SEC, ROUND_DURATION_SEC } from '@game/shared'
import type { GameState } from '../src/game.js'
import { canBuy, formatUpgradesPurchased, isUnlocked } from '../src/ui/helpers.js'

// ─── Test fixture helpers ────────────────────────────────────────────

function makeUpgrade(overrides: Partial<UpgradeDefinition> = {}): UpgradeDefinition {
  return {
    id: 'test-upgrade',
    name: 'Test',
    cost: 10,
    description: '',
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
      resources: { wood: 100, ale: 100 },
      upgrades: {},
      generators: {},
      meta: { highlight: 'wood' },
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
    const u = makeUpgrade({ cost: 50, costCurrency: 'wood' })
    const state = makeState({ resources: { wood: 100, ale: 0 } })
    expect(canBuy(state, u)).toBe(true)
  })

  it('returns false when locked even if affordable', () => {
    const u = makeUpgrade({ cost: 50, costCurrency: 'wood', prerequisites: ['ghost'] })
    const state = makeState({ resources: { wood: 9999, ale: 9999 } })
    expect(canBuy(state, u)).toBe(false)
  })

  it('returns false when unlocked but cannot afford', () => {
    const u = makeUpgrade({ cost: 50, costCurrency: 'wood' })
    const state = makeState({ resources: { wood: 0, ale: 9999 } })
    expect(canBuy(state, u)).toBe(false)
  })

  it('returns false for one-shot upgrade already owned', () => {
    const u = makeUpgrade({ cost: 10, costCurrency: 'wood' })
    const state = makeState({
      resources: { wood: 9999, ale: 0 },
      upgrades: { 'test-upgrade': 1 },
    })
    expect(canBuy(state, u)).toBe(false)
  })

  it('returns true for repeatable upgrade already owned (with funds)', () => {
    const u = makeUpgrade({ cost: 10, costCurrency: 'wood', repeatable: true })
    const state = makeState({
      resources: { wood: 9999, ale: 0 },
      upgrades: { 'test-upgrade': 3 },
    })
    expect(canBuy(state, u)).toBe(true)
  })
})

// ─── formatUpgradesPurchased ─────────────────────────────────────────

describe('formatUpgradesPurchased', () => {
  const upgrades: UpgradeDefinition[] = [
    makeUpgrade({ id: 'tavern-recruits', name: '🍻 Tavern Recruits' }),
    makeUpgrade({ id: 'sharpened-axes', name: '🪓 Sharpened Axes' }),
    makeUpgrade({ id: 'lumber-mill', name: '🏗️ Lumber Mill' }),
  ]

  it('returns "none" for an empty list', () => {
    expect(formatUpgradesPurchased([], upgrades)).toBe('none')
  })

  it('shows a single non-repeated purchase as just the name', () => {
    expect(formatUpgradesPurchased(['sharpened-axes'], upgrades)).toBe('🪓 Sharpened Axes')
  })

  it('aggregates repeats with ×N suffix', () => {
    expect(
      formatUpgradesPurchased(['tavern-recruits', 'tavern-recruits', 'tavern-recruits'], upgrades),
    ).toBe('🍻 Tavern Recruits ×3')
  })

  it('preserves first-purchase order across distinct ids', () => {
    expect(
      formatUpgradesPurchased(
        ['tavern-recruits', 'sharpened-axes', 'tavern-recruits', 'lumber-mill'],
        upgrades,
      ),
    ).toBe('🍻 Tavern Recruits ×2, 🪓 Sharpened Axes, 🏗️ Lumber Mill')
  })

  it('falls back to the raw id for unknown upgrades', () => {
    expect(formatUpgradesPurchased(['ghost', 'ghost'], upgrades)).toBe('ghost ×2')
  })
})
