import { describe, expect, it } from 'vitest'
import {
  BATTERY_CHARGE_KEY,
  BATTERY_DEFAULTS,
  advanceHighlightBattery,
  batteryFactor,
  collectBatteryParams,
  readBatteryCharge,
} from '../src/highlight-battery.js'
import { applyEffect } from '../src/effects/index.js'
import {
  collectModifiers,
  computeRateBreakdown,
  getHighlightMultiplier,
} from '../src/modes/index.js'
import { computePassiveRates } from '../src/modifiers/pipeline.js'
import { isHighlightBatteryActive } from '../src/unlock-gates.js'
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

/** An upgrade whose sole effect unlocks `system`. */
function unlockUpgrade(id: string, system: string): UpgradeDefinition {
  return makeUpgrade(id, [{ type: 'systemUnlock', system }])
}

/** A mode whose `shb` upgrade grants the battery, plus any extra upgrades. */
function batteryMode(extra: UpgradeDefinition[] = []): ModeDefinition {
  return makeMode({ upgrades: [unlockUpgrade('shb', 'highlightBattery'), ...extra] })
}

/** State with the battery granted, `highlight` held (null = released). */
function batteryState(
  highlight: string | null,
  upgrades: Record<string, number> = {},
  charge?: number,
): PlayerState {
  const state = makeState({ shb: 1, ...upgrades })
  state.meta.highlight = highlight
  if (charge !== undefined) state.meta[BATTERY_CHARGE_KEY] = charge
  return state
}

// ─── isHighlightBatteryActive ────────────────────────────────────────

describe('isHighlightBatteryActive', () => {
  it('is hidden when no upgrade grants it', () => {
    // The inverse of the input systems: an ungated *battery* stays off, where an
    // ungated click/highlight would be on.
    expect(isHighlightBatteryActive(makeState(), makeMode())).toBe(false)
  })

  it('is inactive while the granting upgrade is unowned', () => {
    const mode = makeMode({ upgrades: [unlockUpgrade('shb', 'highlightBattery')] })
    expect(isHighlightBatteryActive(makeState(), mode)).toBe(false)
  })

  it('is active once the granting upgrade is owned', () => {
    const mode = makeMode({ upgrades: [unlockUpgrade('shb', 'highlightBattery')] })
    expect(isHighlightBatteryActive(makeState({ shb: 1 }), mode)).toBe(true)
  })

  it('is inactive while the highlight itself is still locked', () => {
    // A battery for a highlight you can't use would charge and drain against
    // nothing, so the battery gate implies the highlight gate.
    const mode = makeMode({
      upgrades: [unlockUpgrade('sh', 'highlight'), unlockUpgrade('shb', 'highlightBattery')],
    })
    expect(isHighlightBatteryActive(makeState({ shb: 1 }), mode)).toBe(false)
    expect(isHighlightBatteryActive(makeState({ sh: 1, shb: 1 }), mode)).toBe(true)
  })

  it('is inactive in a mode with highlighting disabled', () => {
    const mode = makeMode({
      highlightEnabled: false,
      initialMeta: {},
      upgrades: [unlockUpgrade('shb', 'highlightBattery')],
    })
    expect(isHighlightBatteryActive(makeState({ shb: 1 }), mode)).toBe(false)
  })
})

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

// ─── advanceHighlightBattery ─────────────────────────────────────────

describe('advanceHighlightBattery', () => {
  const half = BATTERY_DEFAULTS.maxCharge / 2

  it('does nothing while the battery is locked', () => {
    const state = makeState()
    state.meta.highlight = 'r0'
    advanceHighlightBattery(state, batteryMode(), 1)
    // Not even the key — a mode without a battery never grows one.
    expect(BATTERY_CHARGE_KEY in state.meta).toBe(false)
    expect(readBatteryCharge(state)).toBeNull()
  })

  it('seeds at half capacity on the first tick, then integrates from there', () => {
    const state = batteryState(null)
    advanceHighlightBattery(state, batteryMode(), 1)
    // Seeded at half, then one second of charging at the default 1/sec.
    expect(readBatteryCharge(state)).toBeCloseTo(half + 1)
  })

  it('drains while a resource is held', () => {
    const state = batteryState('r0', {}, 10)
    advanceHighlightBattery(state, batteryMode(), 0.25)
    expect(readBatteryCharge(state)).toBeCloseTo(9.75)
  })

  it('charges while the highlight is released', () => {
    const state = batteryState(null, {}, 10)
    advanceHighlightBattery(state, batteryMode(), 0.25)
    expect(readBatteryCharge(state)).toBeCloseTo(10.25)
  })

  it('clamps at empty rather than going negative', () => {
    const state = batteryState('r0', {}, 0.1)
    advanceHighlightBattery(state, batteryMode(), 1)
    expect(readBatteryCharge(state)).toBe(0)
  })

  it('clamps at capacity rather than overfilling', () => {
    const state = batteryState(null, {}, BATTERY_DEFAULTS.maxCharge - 0.1)
    advanceHighlightBattery(state, batteryMode(), 1)
    expect(readBatteryCharge(state)).toBe(BATTERY_DEFAULTS.maxCharge)
  })

  it('honours upgraded rates', () => {
    const mode = batteryMode([
      makeUpgrade('cs', [{ type: 'batteryStat', stat: 'chargeRate', op: 'add', value: 3 }]),
      makeUpgrade('ds', [{ type: 'batteryStat', stat: 'drainRate', op: 'mult', value: 0.5 }]),
    ])
    const charging = batteryState(null, { cs: 1 }, 0)
    advanceHighlightBattery(charging, mode, 1)
    expect(readBatteryCharge(charging)).toBeCloseTo(4) // 1 default + 3

    const draining = batteryState('r0', { ds: 1 }, 10)
    advanceHighlightBattery(draining, mode, 1)
    expect(readBatteryCharge(draining)).toBeCloseTo(9.5) // 1 * 0.5
  })

  it('seeds against the upgraded capacity, not the default one', () => {
    const mode = batteryMode([
      makeUpgrade('mc', [{ type: 'batteryStat', stat: 'maxCharge', op: 'add', value: 20 }]),
    ])
    const state = batteryState('r0', { mc: 1 })
    advanceHighlightBattery(state, mode, 0)
    expect(readBatteryCharge(state)).toBeCloseTo(20) // half of 20 + 20
  })

  it('clamps a stored charge that now exceeds a shrunken capacity', () => {
    // Only reachable via a mis-authored `mult` below 1, but the stored charge
    // must not sit above the cap forever.
    const mode = batteryMode([
      makeUpgrade('shrink', [{ type: 'batteryStat', stat: 'maxCharge', op: 'mult', value: 0.25 }]),
    ])
    const state = batteryState(null, { shrink: 1 }, BATTERY_DEFAULTS.maxCharge)
    advanceHighlightBattery(state, mode, 0)
    expect(readBatteryCharge(state)).toBe(BATTERY_DEFAULTS.maxCharge * 0.25)
  })

  it('re-seeds from a corrupt stored charge instead of propagating it', () => {
    const state = batteryState(null)
    state.meta[BATTERY_CHARGE_KEY] = Number.NaN
    advanceHighlightBattery(state, batteryMode(), 1)
    expect(readBatteryCharge(state)).toBeCloseTo(half + 1)
  })

  it('holds steady across a zero-length tick', () => {
    const state = batteryState('r0', {}, 7)
    advanceHighlightBattery(state, batteryMode(), 0)
    expect(readBatteryCharge(state)).toBe(7)
  })
})

// ─── batteryFactor ───────────────────────────────────────────────────

describe('batteryFactor', () => {
  it('is neutral while the battery is locked', () => {
    expect(batteryFactor(makeState(), batteryMode())).toBe(1)
  })

  it('is neutral before the charge is seeded', () => {
    // Unlocked but not yet ticked: no charge state, so nothing to pay out.
    expect(batteryFactor(makeState({ shb: 1 }), batteryMode())).toBe(1)
  })

  it('pays the full factor at any charge above empty', () => {
    // A gate, not a scale: 1 unit pays the same as a full tank.
    expect(batteryFactor(batteryState('r0', {}, 1), batteryMode())).toBe(BATTERY_DEFAULTS.factor)
    expect(batteryFactor(batteryState('r0', {}, BATTERY_DEFAULTS.maxCharge), batteryMode())).toBe(
      BATTERY_DEFAULTS.factor,
    )
  })

  it('snaps back to neutral at empty', () => {
    expect(batteryFactor(batteryState('r0', {}, 0), batteryMode())).toBe(1)
  })

  it('reflects an upgraded factor', () => {
    const mode = batteryMode([
      makeUpgrade('bp', [{ type: 'batteryStat', stat: 'factor', op: 'add', value: 0.5 }]),
    ])
    expect(batteryFactor(batteryState('r0', { bp: 2 }, 5), mode)).toBeCloseTo(
      BATTERY_DEFAULTS.factor + 1,
    )
  })
})

// ─── The factor in the pipeline ──────────────────────────────────────

describe('the battery factor in the pipeline', () => {
  /** Battery mode that also produces 10 r0/sec and doubles the highlight. */
  function producingMode(extra: UpgradeDefinition[] = []): ModeDefinition {
    return makeMode({
      upgrades: [unlockUpgrade('shb', 'highlightBattery'), ...extra],
      effects: [
        { type: 'highlightMultiplier', multiplier: 2 },
        { type: 'baseModifier', stage: 'additive', field: 'b0', value: 10 },
      ],
    })
  }
  const rate = (state: PlayerState, mode: ModeDefinition): number =>
    computePassiveRates(collectModifiers(state, mode), mode.resources).r0

  it('multiplies the highlighted resource on top of the highlight bonus', () => {
    const mode = producingMode()
    // 10 base × 2 highlight × 1.5 battery
    expect(rate(batteryState('r0', {}, 5), mode)).toBeCloseTo(30)
  })

  it('drops the battery share the moment charge hits empty', () => {
    const mode = producingMode()
    // Still the ×2 highlight, but no battery — the snap, not a fade.
    expect(rate(batteryState('r0', {}, 0), mode)).toBeCloseTo(20)
  })

  it('lands on the held resource only, and nowhere while released', () => {
    const mode = makeMode({
      resources: ['r0', 'r1'],
      upgrades: [unlockUpgrade('shb', 'highlightBattery')],
      effects: [
        { type: 'highlightMultiplier', multiplier: 2 },
        { type: 'baseModifier', stage: 'additive', field: 'b0', value: 10 },
        { type: 'baseModifier', stage: 'additive', field: 'b1', value: 10 },
      ],
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
          upgrades: [{ id: 'shb', name: 'shb', icon: '⬆️', description: '' }],
          generators: [],
          attacks: [],
          pacts: [],
        },
      ],
    })
    const held = computePassiveRates(
      collectModifiers(batteryState('r1', {}, 5), mode),
      mode.resources,
    )
    expect(held.r0).toBeCloseTo(10)
    expect(held.r1).toBeCloseTo(30)

    // Released: the battery is charging, and pays out on neither resource.
    const released = computePassiveRates(
      collectModifiers(batteryState(null, {}, 5), mode),
      mode.resources,
    )
    expect(released.r0).toBeCloseTo(10)
    expect(released.r1).toBeCloseTo(10)
  })

  it('does not compound the factor a second time per owning upgrade', () => {
    // The params are already folded by owned count; the emitted modifier must be
    // the resolved factor exactly once, however many levels are owned.
    const mode = producingMode([
      makeUpgrade('bp', [{ type: 'batteryStat', stat: 'factor', op: 'add', value: 0.5 }]),
    ])
    // 10 × 2 highlight × (1.5 + 3×0.5 = 3) battery
    expect(rate(batteryState('r0', { bp: 3 }, 5), mode)).toBeCloseTo(60)
  })
})

// ─── getHighlightMultiplier ──────────────────────────────────────────

describe('getHighlightMultiplier with a battery', () => {
  const mode = makeMode({
    upgrades: [unlockUpgrade('shb', 'highlightBattery')],
    effects: [{ type: 'highlightMultiplier', multiplier: 2 }],
  })

  it('reports the battery share so the panel matches the real rate', () => {
    expect(getHighlightMultiplier(batteryState('r0', {}, 5), mode)).toBeCloseTo(3) // 2 × 1.5
  })

  it('reports the highlight bonus alone at empty', () => {
    expect(getHighlightMultiplier(batteryState('r0', {}, 0), mode)).toBeCloseTo(2)
  })

  it('reports neutral while released', () => {
    expect(getHighlightMultiplier(batteryState(null, {}, 5), mode)).toBe(1)
  })
})

// ─── Rate breakdown ──────────────────────────────────────────────────

describe('computeRateBreakdown with a battery', () => {
  it('still telescopes to the authoritative total', () => {
    // The battery is a shared multiplicative stage, so it scales the buckets
    // rather than forming one — but they must still sum to the real rate, which
    // is what the data panel's bars are drawn from.
    const mode = makeMode({
      upgrades: [
        unlockUpgrade('shb', 'highlightBattery'),
        makeUpgrade('u', [{ type: 'baseModifier', stage: 'additive', field: 'b0', value: 5 }]),
      ],
      effects: [
        { type: 'highlightMultiplier', multiplier: 2 },
        { type: 'baseModifier', stage: 'additive', field: 'b0', value: 10 },
      ],
      generators: [
        { id: 'g0', cost: { r0: { baseCost: 10 } }, production: { resource: 'r0', rate: 3 } },
      ],
      flavors: [
        {
          id: 'test',
          displayName: 'Test',
          themeClass: 'test',
          scoreLabel: 'Score',
          showClickStats: false,
          resources: [{ key: 'r0', displayName: 'r0', icon: '🪵' }],
          upgrades: [
            { id: 'shb', name: 'shb', icon: '⬆️', description: '' },
            { id: 'u', name: 'u', icon: '⬆️', description: '' },
          ],
          generators: [{ id: 'g0', name: 'g0', icon: '⚙️' }],
          attacks: [],
          pacts: [],
        },
      ],
    })
    const state = batteryState('r0', { u: 1 }, 5)
    state.generators.g0 = 2

    const bd = computeRateBreakdown(state, mode).r0
    expect(bd.base + bd.generators).toBeCloseTo(bd.total)
    expect(bd.total).toBeCloseTo(
      computePassiveRates(collectModifiers(state, mode), mode.resources).r0,
    )
  })
})

// ─── batteryBand ─────────────────────────────────────────────────────

describe('batteryBand', () => {
  const mode = makeMode()

  it('echoes the authored band', () => {
    expect(
      applyEffect(
        { type: 'batteryBand', band: 'high', threshold: 0.75, bonus: 0.5 },
        makeState(),
        mode,
      ),
    ).toEqual({ kind: 'batteryBand', band: 'high', threshold: 0.75, bonus: 0.5 })
  })

  it('rejects an unknown band', () => {
    expect(() =>
      applyEffect(
        { type: 'batteryBand', band: 'middle', threshold: 0.5, bonus: 0.5 },
        makeState(),
        mode,
      ),
    ).toThrow()
  })

  it('rejects a threshold at the edges (it would cover the whole tank)', () => {
    for (const threshold of [0, 1]) {
      expect(() =>
        applyEffect(
          { type: 'batteryBand', band: 'high', threshold, bonus: 0.5 },
          makeState(),
          mode,
        ),
      ).toThrow()
    }
  })
})

describe('charge bands in batteryFactor', () => {
  /** Battery mode with one band upgrade. */
  function bandMode(band: 'high' | 'low', threshold: number, bonus = 1): ModeDefinition {
    return batteryMode([makeUpgrade('band', [{ type: 'batteryBand', band, threshold, bonus }])])
  }
  const max = BATTERY_DEFAULTS.maxCharge
  const base = BATTERY_DEFAULTS.factor

  it('pays a high band only at or above its threshold', () => {
    const mode = bandMode('high', 0.75)
    expect(batteryFactor(batteryState('r0', { band: 1 }, max), mode)).toBeCloseTo(base + 1)
    expect(batteryFactor(batteryState('r0', { band: 1 }, max * 0.75), mode)).toBeCloseTo(base + 1)
    // Below the band: the flat payout still applies — the band is a bonus, not a
    // prerequisite for the battery working at all.
    expect(batteryFactor(batteryState('r0', { band: 1 }, max * 0.5), mode)).toBeCloseTo(base)
  })

  it('pays a low band only at or below its threshold', () => {
    const mode = bandMode('low', 0.25)
    expect(batteryFactor(batteryState('r0', { band: 1 }, max * 0.1), mode)).toBeCloseTo(base + 1)
    expect(batteryFactor(batteryState('r0', { band: 1 }, max * 0.25), mode)).toBeCloseTo(base + 1)
    expect(batteryFactor(batteryState('r0', { band: 1 }, max * 0.5), mode)).toBeCloseTo(base)
  })

  it('still snaps to neutral at empty, band or not', () => {
    // The low band must not resurrect a payout from an empty tank.
    expect(batteryFactor(batteryState('r0', { band: 1 }, 0), bandMode('low', 0.25))).toBe(1)
  })

  it('is inert while the band upgrade is unowned', () => {
    expect(batteryFactor(batteryState('r0', {}, max), bandMode('high', 0.75))).toBeCloseTo(base)
  })

  it('measures the band against upgraded capacity', () => {
    // 10 units is full on the default tank (band pays) but a quarter of a
    // doubled one (band does not).
    const mode = batteryMode([
      makeUpgrade('band', [{ type: 'batteryBand', band: 'high', threshold: 0.75, bonus: 1 }]),
      makeUpgrade('mc', [{ type: 'batteryStat', stat: 'maxCharge', op: 'mult', value: 2 }]),
    ])
    expect(batteryFactor(batteryState('r0', { band: 1 }, max), mode)).toBeCloseTo(base + 1)
    expect(batteryFactor(batteryState('r0', { band: 1, mc: 1 }, max), mode)).toBeCloseTo(base)
  })

  it('adds up several applicable bands and scales by owned count', () => {
    const mode = batteryMode([
      makeUpgrade('h', [{ type: 'batteryBand', band: 'high', threshold: 0.5, bonus: 1 }]),
      makeUpgrade('l', [{ type: 'batteryBand', band: 'low', threshold: 0.9, bonus: 0.5 }]),
    ])
    // At 60% both bands apply: h once, l at 2 levels.
    expect(batteryFactor(batteryState('r0', { h: 1, l: 2 }, max * 0.6), mode)).toBeCloseTo(
      base + 1 + 1,
    )
  })
})
