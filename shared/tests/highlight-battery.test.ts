import { describe, expect, it } from 'vitest'
import { BATTERY_DEFAULTS, collectBatteryParams } from '../src/highlight-battery.js'
import { applyEffect } from '../src/effects/index.js'
import type { ModeDefinition } from '../src/modes/types.js'
import type { EffectRef, PlayerState, UpgradeDefinition } from '../src/types.js'

// ─── Fixtures ────────────────────────────────────────────────────────

function makeUpgrade(id: string, effects: EffectRef[]): UpgradeDefinition {
  return { id, cost: { r0: { baseCost: 10 } }, purchaseLimit: 10, effects }
}

function makeMode(overrides?: Partial<ModeDefinition>): ModeDefinition {
  const upgrades = overrides?.upgrades ?? []
  return {
    resources: ['r0'],
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
        resources: [{ key: 'r0', displayName: 'r0', icon: '🪵' }],
        upgrades: upgrades.map((u) => ({ id: u.id, name: u.id, icon: '⬆️', description: '' })),
        generators: [],
        attacks: [],
        pacts: [],
      },
    ],
    ...overrides,
  }
}

function makeState(upgrades: Record<string, number> = {}): PlayerState {
  return { score: 0, resources: {}, upgrades, generators: {}, pendingAttacks: [], meta: {} }
}

// ─── batteryStat params ──────────────────────────────────────────────

describe('batteryStat params', () => {
  const mode = makeMode()

  it('echoes the authored adjustment', () => {
    expect(
      applyEffect(
        { type: 'batteryStat', stat: 'factor', op: 'add', value: 0.5 },
        makeState(),
        mode,
      ),
    ).toEqual({ kind: 'batteryStat', stat: 'factor', op: 'add', value: 0.5 })
  })

  it('rejects an unknown stat', () => {
    expect(() =>
      applyEffect({ type: 'batteryStat', stat: 'nope', op: 'add', value: 1 }, makeState(), mode),
    ).toThrow()
  })

  it('rejects an unknown op', () => {
    expect(() =>
      applyEffect(
        { type: 'batteryStat', stat: 'factor', op: 'divide', value: 1 },
        makeState(),
        mode,
      ),
    ).toThrow()
  })
})

// ─── collectBatteryParams ────────────────────────────────────────────

describe('collectBatteryParams', () => {
  it('returns the defaults when nothing adjusts the battery', () => {
    expect(collectBatteryParams(makeState(), makeMode())).toEqual(BATTERY_DEFAULTS)
  })

  it('ignores an unowned upgrade', () => {
    const mode = makeMode({
      upgrades: [makeUpgrade('bp', [{ type: 'batteryStat', stat: 'factor', op: 'add', value: 1 }])],
    })
    expect(collectBatteryParams(makeState(), mode).factor).toBe(BATTERY_DEFAULTS.factor)
  })

  it('scales an add linearly by owned count', () => {
    const mode = makeMode({
      upgrades: [
        makeUpgrade('mc', [{ type: 'batteryStat', stat: 'maxCharge', op: 'add', value: 5 }]),
      ],
    })
    expect(collectBatteryParams(makeState({ mc: 3 }), mode).maxCharge).toBe(
      BATTERY_DEFAULTS.maxCharge + 15,
    )
  })

  it('compounds a mult by owned count', () => {
    const mode = makeMode({
      upgrades: [
        makeUpgrade('ds', [{ type: 'batteryStat', stat: 'drainRate', op: 'mult', value: 0.5 }]),
      ],
    })
    // 1 * 0.5^3
    expect(collectBatteryParams(makeState({ ds: 3 }), mode).drainRate).toBeCloseTo(0.125)
  })

  it('applies every add before any mult, whatever the authoring order', () => {
    const addFirst = makeMode({
      upgrades: [
        makeUpgrade('a', [{ type: 'batteryStat', stat: 'chargeRate', op: 'add', value: 1 }]),
        makeUpgrade('m', [{ type: 'batteryStat', stat: 'chargeRate', op: 'mult', value: 2 }]),
      ],
    })
    const multFirst = makeMode({
      upgrades: [
        makeUpgrade('m', [{ type: 'batteryStat', stat: 'chargeRate', op: 'mult', value: 2 }]),
        makeUpgrade('a', [{ type: 'batteryStat', stat: 'chargeRate', op: 'add', value: 1 }]),
      ],
    })
    const owned = { a: 1, m: 1 }
    // (1 default + 1 add) * 2 — never 1 + (1 * 2).
    expect(collectBatteryParams(makeState(owned), addFirst).chargeRate).toBe(4)
    expect(collectBatteryParams(makeState(owned), multFirst).chargeRate).toBe(4)
  })

  it('stacks adjustments from separate upgrades', () => {
    const mode = makeMode({
      upgrades: [
        makeUpgrade('a', [{ type: 'batteryStat', stat: 'factor', op: 'add', value: 0.5 }]),
        makeUpgrade('b', [{ type: 'batteryStat', stat: 'factor', op: 'add', value: 1 }]),
      ],
    })
    expect(collectBatteryParams(makeState({ a: 1, b: 2 }), mode).factor).toBeCloseTo(
      BATTERY_DEFAULTS.factor + 0.5 + 2,
    )
  })

  it('collects mode-level refs once, ungated by ownership', () => {
    const mode = makeMode({
      effects: [{ type: 'batteryStat', stat: 'maxCharge', op: 'mult', value: 2 }],
    })
    expect(collectBatteryParams(makeState(), mode).maxCharge).toBe(BATTERY_DEFAULTS.maxCharge * 2)
  })

  it('reads several stats from one upgrade independently', () => {
    const mode = makeMode({
      upgrades: [
        makeUpgrade('combo', [
          { type: 'batteryStat', stat: 'chargeRate', op: 'add', value: 2 },
          { type: 'batteryStat', stat: 'drainRate', op: 'mult', value: 0.5 },
        ]),
      ],
    })
    const params = collectBatteryParams(makeState({ combo: 1 }), mode)
    expect(params.chargeRate).toBe(3)
    expect(params.drainRate).toBe(0.5)
    expect(params.factor).toBe(BATTERY_DEFAULTS.factor)
  })

  it('clamps a mis-authored negative to the stat floor', () => {
    // A negative drain would charge while holding the highlight, and a factor
    // under 1 would turn the reward into a penalty — both stay inert instead.
    const mode = makeMode({
      upgrades: [
        makeUpgrade('bad', [
          { type: 'batteryStat', stat: 'drainRate', op: 'add', value: -100 },
          { type: 'batteryStat', stat: 'factor', op: 'mult', value: -2 },
        ]),
      ],
    })
    const params = collectBatteryParams(makeState({ bad: 1 }), mode)
    expect(params.drainRate).toBe(0)
    expect(params.factor).toBe(1)
  })

  it('never resolves a zero capacity (the charge ratio divides by it)', () => {
    const mode = makeMode({
      upgrades: [
        makeUpgrade('zero', [{ type: 'batteryStat', stat: 'maxCharge', op: 'mult', value: 0 }]),
      ],
    })
    expect(collectBatteryParams(makeState({ zero: 1 }), mode).maxCharge).toBeGreaterThan(0)
  })
})
