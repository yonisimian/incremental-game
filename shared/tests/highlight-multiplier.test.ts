import { describe, expect, it } from 'vitest'
import { getHighlightMultiplier } from '../src/modes/index.js'
import type { ModeDefinition } from '../src/modes/types.js'
import type { EffectRef, PlayerState, UpgradeDefinition } from '../src/types.js'

// ─── Helpers ─────────────────────────────────────────────────────────

function makeUpgrade(id: string, effects: EffectRef[], purchaseLimit = 5): UpgradeDefinition {
  return {
    id,
    cost: { r0: { baseCost: 10, scaleType: 'exponential', scaleFactor: 1 } },
    purchaseLimit,
    effects,
  }
}

function makeMode(overrides?: Partial<ModeDefinition>): ModeDefinition {
  const upgrades = overrides?.upgrades ?? []
  return {
    resources: ['r0', 'r1'],
    scoreResource: 'r0',
    upgrades,
    goals: [{ type: 'timed', label: '⏱ Timed', durationSec: 30 }],
    nativeModifiers: [],
    clicksEnabled: false,
    highlightEnabled: true,
    initialResources: {},
    initialMeta: { highlight: 'r0' },
    generators: [],
    attacks: [],
    pacts: [],
    flavors: [
      {
        id: 'test',
        displayName: 'Test',
        themeClass: 'test',
        scoreLabel: 'Score',
        showClickStats: false,
        resources: [
          { key: 'r0', displayName: 'r0', icon: '🪵' },
          { key: 'r1', displayName: 'r1', icon: '🍺' },
        ],
        upgrades: upgrades.map((u) => ({ id: u.id, name: u.id, icon: '⬆️', description: '' })),
        generators: [],
        attacks: [],
        pacts: [],
      },
    ],
    ...overrides,
  }
}

function makeState(overrides?: Partial<PlayerState>): PlayerState {
  return { score: 0, resources: {}, upgrades: {}, generators: {}, meta: {}, ...overrides }
}

// ─── Tests ───────────────────────────────────────────────────────────

describe('getHighlightMultiplier', () => {
  it('returns 1 when no highlightMultiplier effects are active', () => {
    expect(getHighlightMultiplier(makeState(), makeMode())).toBe(1)
  })

  it('applies a mode-level highlightMultiplier once', () => {
    const mode = makeMode({ effects: [{ type: 'highlightMultiplier', multiplier: 2 }] })
    expect(getHighlightMultiplier(makeState(), mode)).toBe(2)
  })

  it('applies an owned upgrade multiplier and ignores unowned ones', () => {
    const mode = makeMode({
      upgrades: [makeUpgrade('uh', [{ type: 'highlightMultiplier', multiplier: 2 }])],
    })
    expect(getHighlightMultiplier(makeState({ upgrades: {} }), mode)).toBe(1)
    expect(getHighlightMultiplier(makeState({ upgrades: { uh: 1 } }), mode)).toBe(2)
  })

  it('compounds a repeatable upgrade multiplier by owned count', () => {
    const mode = makeMode({
      upgrades: [makeUpgrade('uh', [{ type: 'highlightMultiplier', multiplier: 2 }])],
    })
    // 2 ^ 3 owned = 8
    expect(getHighlightMultiplier(makeState({ upgrades: { uh: 3 } }), mode)).toBe(8)
  })

  it('stacks multiple sources multiplicatively', () => {
    const mode = makeMode({
      effects: [{ type: 'highlightMultiplier', multiplier: 2 }],
      upgrades: [makeUpgrade('uh2', [{ type: 'highlightMultiplier', multiplier: 1.5 }])],
    })
    // 2 (mode) * 1.5 (upgrade) = 3
    expect(getHighlightMultiplier(makeState({ upgrades: { uh2: 1 } }), mode)).toBeCloseTo(3)
  })

  it('is independent of which resource is highlighted', () => {
    const mode = makeMode({ effects: [{ type: 'highlightMultiplier', multiplier: 2 }] })
    expect(getHighlightMultiplier(makeState({ meta: { highlight: 'r0' } }), mode)).toBe(2)
    expect(getHighlightMultiplier(makeState({ meta: { highlight: 'r1' } }), mode)).toBe(2)
  })
})
