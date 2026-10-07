import { describe, expect, it } from 'vitest'
import type { PlayerState } from '../src/types.js'
import { cooldownUntilSec, startCooldown, sweepCooldowns } from '../src/cooldowns.js'

function makeState(gameSec: number, overrides?: Partial<PlayerState>): PlayerState {
  return {
    score: 0,
    resources: {},
    upgrades: {},
    generators: {},
    pendingAttacks: [],
    meta: { gameSec },
    ...overrides,
  }
}

describe('cooldownUntilSec', () => {
  it('is null when nothing is cooling down', () => {
    expect(cooldownUntilSec(makeState(0), 'attack', 'a0')).toBeNull()
  })

  it('reads the lift time while the cooldown runs', () => {
    const state = makeState(10, { cooldowns: [{ kind: 'attack', id: 'a0', untilSec: 25 }] })
    expect(cooldownUntilSec(state, 'attack', 'a0')).toBe(25)
  })

  it('reads an elapsed entry as null before the sweep (the lift instant is ready)', () => {
    const cooldowns = [{ kind: 'attack' as const, id: 'a0', untilSec: 25 }]
    expect(cooldownUntilSec(makeState(25, { cooldowns }), 'attack', 'a0')).toBeNull()
    expect(cooldownUntilSec(makeState(30, { cooldowns }), 'attack', 'a0')).toBeNull()
  })

  it('keeps attack and pact ids apart', () => {
    const state = makeState(0, { cooldowns: [{ kind: 'pact', id: 'a0', untilSec: 25 }] })
    expect(cooldownUntilSec(state, 'attack', 'a0')).toBeNull()
    expect(cooldownUntilSec(state, 'pact', 'a0')).toBe(25)
  })
})

describe('startCooldown', () => {
  it('creates the field on first use', () => {
    const state = makeState(0)
    startCooldown(state, 'attack', 'a0', 12)
    expect(state.cooldowns).toEqual([{ kind: 'attack', id: 'a0', untilSec: 12 }])
  })

  it('replaces an existing entry for the same pair, leaving others alone', () => {
    const state = makeState(0, {
      cooldowns: [
        { kind: 'attack', id: 'a0', untilSec: 12 },
        { kind: 'pact', id: 'a0', untilSec: 40 },
      ],
    })
    startCooldown(state, 'attack', 'a0', 30)
    expect(state.cooldowns).toHaveLength(2)
    expect(cooldownUntilSec(state, 'attack', 'a0')).toBe(30)
    expect(cooldownUntilSec(state, 'pact', 'a0')).toBe(40)
  })
})

describe('sweepCooldowns', () => {
  it('drops the lifted entries and keeps the running ones', () => {
    const state = makeState(0, {
      cooldowns: [
        { kind: 'attack', id: 'a0', untilSec: 10 },
        { kind: 'attack', id: 'a1', untilSec: 20 },
      ],
    })
    sweepCooldowns(state, 10)
    expect(state.cooldowns).toEqual([{ kind: 'attack', id: 'a1', untilSec: 20 }])
  })

  it('deletes the field once nothing is left', () => {
    const state = makeState(0, { cooldowns: [{ kind: 'attack', id: 'a0', untilSec: 10 }] })
    sweepCooldowns(state, 11)
    expect(state).not.toHaveProperty('cooldowns')
  })

  it('leaves a state with no cooldowns untouched', () => {
    const state = makeState(0)
    sweepCooldowns(state, 5)
    expect(state).not.toHaveProperty('cooldowns')
  })
})
