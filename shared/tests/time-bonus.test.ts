import { describe, expect, it } from 'vitest'
import {
  applyPurchase,
  collectModifiers,
  collectDynamicBonuses,
  createInitialState,
  getModeDefinition,
  isTimeBonusRetroactive,
  timeBonusFraction,
  timedUpgradeIds,
  validateModeDefinition,
} from '../src/index.js'
import type { ModeDefinition, PlayerState, UpgradeDefinition } from '../src/index.js'

// A minimal two-resource mode carrying one full clock branch: the payout on
// `clock`, a repeatable raise on `boost`, and the retro flip on `retro`. Costs
// are free so a test can buy at an exact `gameSec` without also modelling income.
function clockMode(payout: Partial<Record<string, unknown>> = {}): ModeDefinition {
  const upgrades: UpgradeDefinition[] = [
    {
      id: 'clock',
      cost: {},
      purchaseLimit: 1,
      effects: [
        {
          type: 'timeScaledModifier',
          clock: 'clock',
          field: 'r0',
          stage: 'multiplicative',
          perMinute: 0.1,
          ...payout,
        },
      ],
    },
    {
      id: 'boost',
      cost: {},
      purchaseLimit: Infinity,
      effects: [{ type: 'timeFactorBoost', clock: 'clock', perMinute: 0.1 }],
    },
    {
      id: 'retro',
      cost: {},
      purchaseLimit: 1,
      effects: [{ type: 'timeRetroactive', clock: 'clock' }],
    },
  ]
  const idler = getModeDefinition('idler')
  return {
    ...idler,
    upgrades,
    // The idler's own flavor with its upgrade table swapped for this mode's, so
    // `validateModeDefinition` sees a complete flavor (it rejects missing and
    // orphaned entries alike).
    flavors: [
      {
        ...idler.flavors[0],
        upgrades: upgrades.map((u) => ({ id: u.id, name: u.id, icon: '⏳', description: u.id })),
      },
    ],
  }
}

/** Buy `id` at game second `sec`. */
function buyAt(state: PlayerState, mode: ModeDefinition, id: string, sec: number): void {
  state.meta.gameSec = sec
  applyPurchase(state, id, mode)
}

/** The multiplicative factor the clock's payout is contributing on `r0`. */
function factorOn(state: PlayerState, mode: ModeDefinition, resource = 'r0'): number {
  return collectModifiers(state, mode)
    .filter((m) => m.field === resource && m.stage === 'multiplicative')
    .reduce((acc, m) => acc * m.value, 1)
}

describe('time clock', () => {
  it('pays nothing until the clock upgrade is bought', () => {
    const mode = clockMode()
    const state = createInitialState(mode)
    state.meta.gameSec = 600
    expect(timeBonusFraction(state, mode, 'clock', 0.1)).toBeNull()
    expect(factorOn(state, mode)).toBe(1)
  })

  it('accrues the authored rate per minute since its purchase', () => {
    const mode = clockMode()
    const state = createInitialState(mode)
    buyAt(state, mode, 'clock', 60)
    state.meta.gameSec = 240 // three minutes later
    expect(timeBonusFraction(state, mode, 'clock', 0.1)).toBeCloseTo(0.3, 10)
    expect(factorOn(state, mode)).toBeCloseTo(1.3, 10)
  })

  it('is neutral on the tick it is bought', () => {
    const mode = clockMode()
    const state = createInitialState(mode)
    buyAt(state, mode, 'clock', 42)
    expect(timeBonusFraction(state, mode, 'clock', 0.1)).toBe(0)
    expect(factorOn(state, mode)).toBe(1)
  })

  it('caps the multiplier at maxFactor', () => {
    const mode = clockMode({ maxFactor: 2 })
    const state = createInitialState(mode)
    buyAt(state, mode, 'clock', 0)
    state.meta.gameSec = 6000 // +1000% uncapped
    expect(factorOn(state, mode)).toBe(2)
  })

  it('runs uncapped when maxFactor is omitted', () => {
    const mode = clockMode()
    const state = createInitialState(mode)
    buyAt(state, mode, 'clock', 0)
    state.meta.gameSec = 6000
    expect(factorOn(state, mode)).toBeCloseTo(11, 10)
  })

  // The whole point of `timeFactorBoost`: a raise bought late is worth less than
  // the same raise bought early, because it only prices time still to come.
  it('counts each boost level from its own purchase, not the clock start', () => {
    const mode = clockMode()
    const state = createInitialState(mode)
    buyAt(state, mode, 'clock', 0)
    buyAt(state, mode, 'boost', 120) // level 1, two minutes in
    state.meta.gameSec = 240
    // base 0.1 × 4min = 0.4, plus boost 0.1 × 2min = 0.2
    expect(timeBonusFraction(state, mode, 'clock', 0.1)).toBeCloseTo(0.6, 10)
  })

  it('adds each level of a repeated boost separately', () => {
    const mode = clockMode()
    const state = createInitialState(mode)
    buyAt(state, mode, 'clock', 0)
    buyAt(state, mode, 'boost', 60)
    buyAt(state, mode, 'boost', 180)
    state.meta.gameSec = 240
    // base 0.1×4 + level1 0.1×3 + level2 0.1×1
    expect(timeBonusFraction(state, mode, 'clock', 0.1)).toBeCloseTo(0.8, 10)
  })

  it('reprices every boost level from the clock start once retroactive', () => {
    const mode = clockMode()
    const state = createInitialState(mode)
    buyAt(state, mode, 'clock', 0)
    buyAt(state, mode, 'boost', 60)
    buyAt(state, mode, 'boost', 180)
    buyAt(state, mode, 'retro', 200)
    state.meta.gameSec = 240
    expect(isTimeBonusRetroactive(state, mode, 'clock')).toBe(true)
    // base 0.1×4 + both levels 0.1×4 each
    expect(timeBonusFraction(state, mode, 'clock', 0.1)).toBeCloseTo(1.2, 10)
  })

  it('retro alone (no boosts) changes nothing', () => {
    const mode = clockMode()
    const state = createInitialState(mode)
    buyAt(state, mode, 'clock', 0)
    buyAt(state, mode, 'retro', 60)
    state.meta.gameSec = 240
    expect(timeBonusFraction(state, mode, 'clock', 0.1)).toBeCloseTo(0.4, 10)
  })

  it('ignores boost levels with no recorded purchase time', () => {
    const mode = clockMode()
    const state = createInitialState(mode)
    buyAt(state, mode, 'clock', 0)
    state.upgrades.boost = 2 // granted behind applyPurchase's back
    state.meta.gameSec = 240
    expect(timeBonusFraction(state, mode, 'clock', 0.1)).toBeCloseTo(0.4, 10)
  })

  it('reports the payout in the live-bonuses snapshot', () => {
    const mode = clockMode()
    const state = createInitialState(mode)
    buyAt(state, mode, 'clock', 0)
    state.meta.gameSec = 120
    const bonus = collectDynamicBonuses(state, mode).find((b) => b.upgradeId === 'clock')
    expect(bonus?.modifiers).toEqual([{ stage: 'multiplicative', field: 'r0', value: 1.2 }])
  })

  it('keeps a full timeline only for the upgrades a clock reads', () => {
    const mode = clockMode()
    expect([...timedUpgradeIds(mode)].sort()).toEqual(['boost', 'clock'])
  })

  it('refuses to boot on a clock id no upgrade defines', () => {
    const mode = clockMode({ clock: 'nope' })
    expect(() => {
      validateModeDefinition('test', mode)
    }).toThrow(/unknown clock upgrade 'nope'/u)
  })

  it('refuses to boot on a payout field the pipeline would ignore', () => {
    const mode = clockMode({ field: 'r9' })
    expect(() => {
      validateModeDefinition('test', mode)
    }).toThrow(/unknown production field 'r9'/u)
  })
})

// ─── The idler's authored branch ─────────────────────────────────────

describe('idler time branch', () => {
  const idler = (): ModeDefinition => getModeDefinition('idler')

  it('boosts both resources from ae-mf-ar-time', () => {
    const mode = idler()
    const state = createInitialState(mode)
    state.resources.r0 = 100_000
    state.resources.r1 = 100_000
    buyAt(state, mode, 'ae-mf-ar-time', 0)
    state.meta.gameSec = 300 // five minutes → +50% each
    expect(factorOn(state, mode, 'r0')).toBeCloseTo(1.5, 10)
    expect(factorOn(state, mode, 'r1')).toBeCloseTo(1.5, 10)
  })

  it('pays more per ae-atf level, and repriced by ae-tf-retro', () => {
    const mode = idler()
    const state = createInitialState(mode)
    state.resources.r0 = 100_000
    state.resources.r1 = 100_000
    buyAt(state, mode, 'ae-mf-ar-time', 0)
    buyAt(state, mode, 'ae-atf', 60)
    buyAt(state, mode, 'ae-atf', 60)
    state.meta.gameSec = 300
    // base 0.1×5min + two levels of 0.1 × 4min
    const withBoosts = factorOn(state, mode, 'r0')
    expect(withBoosts).toBeCloseTo(1.5 + 0.8, 10)

    buyAt(state, mode, 'ae-tf-retro', 300)
    // the two levels now count all five minutes
    expect(factorOn(state, mode, 'r0')).toBeCloseTo(1.5 + 1.0, 10)
  })
})
