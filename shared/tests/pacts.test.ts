// Plan 42 — passive pacts: the enemy-stat catalog the pact effects read from,
// and the resolvers that turn a pact's description into concrete numbers
// against the partner. Logic tier throughout: every assertion is on a value.

import { describe, expect, it } from 'vitest'
import {
  createInitialState,
  ENEMY_STAT_SCORE_KEY,
  enemyStatKeys,
  enemyStatKeysFor,
  getModeDefinition,
  readEnemyStat,
} from '../src/index.js'
import type { PartnerSnapshot, PlayerState } from '../src/index.js'

// ─── Enemy stats ─────────────────────────────────────────────────────

describe('enemyStatKeys', () => {
  it('names every stat the reader understands, in dropdown order', () => {
    expect(enemyStatKeysFor(['r0', 'r1'], ['u0'], ['g0']).map((f) => f.key)).toEqual([
      'r0',
      'r0:rate',
      'r1',
      'r1:rate',
      'peakCps',
      'score',
      'upgrades',
      'generators',
      'upgrade:u0',
      'generator:g0',
    ])
  })

  it('derives the idler catalog from its resources, upgrades and generators', () => {
    const mode = getModeDefinition('idler')
    const keys = enemyStatKeys(mode).map((f) => f.key)
    for (const r of mode.resources) expect(keys).toContain(r)
    for (const g of mode.generators) expect(keys).toContain(`generator:${g.id}`)
    for (const u of mode.upgrades) expect(keys).toContain(`upgrade:${u.id}`)
    expect(keys).toContain(ENEMY_STAT_SCORE_KEY)
  })

  it('labels each key for the editor', () => {
    const labels = new Map(enemyStatKeysFor(['r0'], ['u0'], ['g0']).map((f) => [f.key, f.label]))
    expect(labels.get('r0:rate')).toMatch(/rate/)
    expect(labels.get('upgrades')).toMatch(/total/i)
    expect(labels.get('generator:g0')).toMatch(/g0/)
  })
})

describe('readEnemyStat', () => {
  function snapshot(patch: Partial<PlayerState> = {}, rates: Record<string, number> = {}) {
    const state: PlayerState = {
      score: 900,
      resources: { r0: 120, r1: 30 },
      upgrades: { u0: 2, u1: 3 },
      generators: { g0: 4, g1: 5 },
      pendingAttacks: [],
      meta: { peakCps: 7 },
      ...patch,
    }
    return { state, rates } satisfies PartnerSnapshot
  }

  it('reads every key in the table', () => {
    const snap = snapshot({}, { r0: 12.5 })
    expect(readEnemyStat(snap, 'r0')).toBe(120)
    expect(readEnemyStat(snap, 'r1')).toBe(30)
    expect(readEnemyStat(snap, 'r0:rate')).toBe(12.5)
    expect(readEnemyStat(snap, 'peakCps')).toBe(7)
    expect(readEnemyStat(snap, 'score')).toBe(900)
    expect(readEnemyStat(snap, 'generator:g0')).toBe(4)
    expect(readEnemyStat(snap, 'generators')).toBe(9)
    expect(readEnemyStat(snap, 'upgrade:u1')).toBe(3)
    expect(readEnemyStat(snap, 'upgrades')).toBe(5)
  })

  // The rule that keeps two rate-mirroring pacts from feeding each other: a
  // `:rate` source reads the snapshot's pact-free figure, never anything on the
  // state (which carries no rate at all).
  it('reads a :rate key from the snapshot rates, not the state', () => {
    const snap = snapshot({ resources: { r0: 1e6 } }, { r0: 3 })
    expect(readEnemyStat(snap, 'r0:rate')).toBe(3)
    expect(readEnemyStat(snapshot({}, {}), 'r0:rate')).toBe(0)
  })

  it('reads a stat the partner has nothing under as 0', () => {
    const fresh = { state: createInitialState(getModeDefinition('idler')), rates: {} }
    expect(readEnemyStat(fresh, 'peakCps')).toBe(0)
    expect(readEnemyStat(fresh, 'generator:g0')).toBe(0)
    expect(readEnemyStat(fresh, 'generators')).toBe(0)
    expect(readEnemyStat(fresh, 'upgrade:nope')).toBe(0)
  })

  it('reads an unknown key as 0', () => {
    expect(readEnemyStat(snapshot(), 'nonsense')).toBe(0)
    expect(readEnemyStat(snapshot(), 'meta:peakCps')).toBe(0)
  })
})
