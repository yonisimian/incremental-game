import { describe, expect, it } from 'vitest'
import { BATTERY_DEFAULTS, COUNTDOWN_SEC, ROUND_DURATION_SEC } from '@game/shared'
import type { BatteryParams } from '@game/shared'
import type { GameState } from '../src/game.js'
import {
  batteryBarLabel,
  predictCharge,
  renderBatteryBar,
  type ChargeAnchor,
} from '../src/ui/panels/battery-bar.js'

// ─── Fixtures ────────────────────────────────────────────────────────

/**
 * A playing state on the *real* idler mode (the stub tree has no battery node),
 * so the gate is exercised through `shb-unlock` exactly as it ships.
 */
function makeState(
  upgrades: Record<string, number>,
  meta: Record<string, unknown> = { highlight: 'r0' },
): GameState {
  return {
    screen: 'playing',
    mode: 'idler',
    goal: { type: 'timed', label: '⏱ Timed', durationSec: ROUND_DURATION_SEC },
    player: { score: 0, resources: {}, upgrades, generators: {}, pendingAttacks: [], meta },
    opponent: { score: 0, resources: {}, rates: {} },
    opponentPurchaseFeed: [],
    debuffs: [],
    timeLeft: ROUND_DURATION_SEC,
    paused: false,
    vsBot: false,
    matchId: 'test-match',
    upgrades: [],
    countdown: COUNTDOWN_SEC,
    endData: null,
    playerName: '',
    opponentName: '',
    roomCode: null,
    roomSettings: null,
    roomPlayers: [],
    isRoomCreator: false,
    serverActiveRooms: 0,
    roomError: null,
  }
}

const params: BatteryParams = { factor: 1.5, maxCharge: 20, chargeRate: 1, drainRate: 2 }
const anchor = (charge: number, held: boolean): ChargeAnchor => ({
  charge,
  atMs: 1000,
  held,
  paused: false,
  params,
})

// ─── renderBatteryBar ────────────────────────────────────────────────

describe('renderBatteryBar', () => {
  it('renders nothing while the lantern is locked', () => {
    expect(renderBatteryBar(makeState({ 'sh-unlock': 1 }))).toBe('')
  })

  it('renders nothing when the highlight itself is locked', () => {
    // Unreachable through the tree's prerequisites, but the bar must not appear
    // for a battery whose highlight isn't usable.
    expect(renderBatteryBar(makeState({ 'shb-unlock': 1 }))).toBe('')
  })

  it('renders a meter once the lantern is owned', () => {
    const html = renderBatteryBar(makeState({ 'sh-unlock': 1, 'shb-unlock': 1 }))
    expect(html).toContain('battery-bar')
    expect(html).toContain('battery-bar-fill')
    expect(html).toContain('role="meter"')
  })
})

// ─── predictCharge ───────────────────────────────────────────────────

describe('predictCharge', () => {
  it('returns the anchored charge at the anchor instant', () => {
    expect(predictCharge(anchor(10, true), 1000)).toBe(10)
  })

  it('drains at drainRate while a resource is held', () => {
    // 2/sec for 2s.
    expect(predictCharge(anchor(10, true), 3000)).toBeCloseTo(6)
  })

  it('charges at chargeRate while released', () => {
    expect(predictCharge(anchor(10, false), 3000)).toBeCloseTo(12)
  })

  it('clamps at empty rather than predicting negative charge', () => {
    // A snapshot can be up to a broadcast interval stale, so the prediction has
    // to survive running past the end of the tank.
    expect(predictCharge(anchor(1, true), 60_000)).toBe(0)
  })

  it('clamps at capacity rather than overfilling', () => {
    expect(predictCharge(anchor(19, false), 60_000)).toBe(params.maxCharge)
  })
})

// ─── batteryBarLabel ─────────────────────────────────────────────────

describe('batteryBarLabel', () => {
  it('counts down the seconds left while held', () => {
    // 10 units at 2/sec.
    expect(batteryBarLabel(10, params, true)).toBe('5s left')
  })

  it('reads empty at zero while held', () => {
    expect(batteryBarLabel(0, params, true)).toBe('empty')
  })

  it('counts up to full while released', () => {
    // 10 units missing at 1/sec.
    expect(batteryBarLabel(10, params, false)).toBe('10s to full')
  })

  it('reads full at capacity while released', () => {
    expect(batteryBarLabel(params.maxCharge, params, false)).toBe('full')
  })

  it('uses the default rates when nothing is upgraded', () => {
    expect(batteryBarLabel(BATTERY_DEFAULTS.maxCharge / 2, BATTERY_DEFAULTS, true)).toBe('10s left')
  })

  it('rounds seconds up, so a charged bar never reads 0s left', () => {
    // Guard against `formatNumber`'s scientific notation flooring the value: at
    // 9.99 units and 1/sec this must not read "9s left", and at 0.2 units left it
    // must not read "0s left" while the bar is still visibly charged.
    expect(batteryBarLabel(9.99, { ...params, drainRate: 1 }, true)).toBe('10s left')
    expect(batteryBarLabel(0.2, { ...params, drainRate: 1 }, true)).toBe('1s left')
  })
})
