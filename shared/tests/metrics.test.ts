import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  analyzeCoverage,
  envelopeFor,
  getModeDefinition,
  parseStrategy,
  simResultsToScores,
  simulate,
  validateEnvelope,
} from '../src/index.js'
import type { ModeDefinition, SimEvent, SimResult, TargetEnvelope } from '../src/index.js'

// The shared test setup (`setup.ts`) loads the idler tree + balance sidecar
// before any test runs, so `getModeDefinition` / `envelopeFor` resolve here.

// ─── Synthetic unit tests ────────────────────────────────────────────

/** A minimal mode carrying only the fields `analyzeCoverage` reads. */
function mode(opts?: { clicksEnabled?: boolean }): ModeDefinition {
  return {
    upgrades: [{ id: 'u0' }, { id: 'u1' }],
    generators: [{ id: 'g0' }, { id: 'g1' }],
    clicksEnabled: opts?.clicksEnabled ?? true,
  } as unknown as ModeDefinition
}

function ev(kind: SimEvent['kind'], label: string): SimEvent {
  return { timeSec: 1, index: 0, kind, label }
}

function result(name: string, events: SimEvent[]): SimResult {
  return {
    name,
    mode: 'idler',
    snapshots: [],
    finalScore: 0,
    events,
    notReached: [],
    goalReached: true,
  }
}

describe('analyzeCoverage — set membership', () => {
  it('flags a mechanic no viable build fires as dead', () => {
    const results = [result('A', [ev('buy', 'buy:u0')]), result('B', [ev('buy', 'buy:u0')])]
    const report = analyzeCoverage(mode(), results, new Set(['A', 'B']))
    const u1 = report.mechanics.find((m) => m.id === 'u1')
    expect(u1?.finding).toBe('dead')
    expect(u1?.coverage).toBe(0)
  })

  it('flags a mechanic every viable build fires as mandatory', () => {
    const results = [result('A', [ev('buy', 'buy:u0')]), result('B', [ev('buy', 'buy:u0')])]
    const report = analyzeCoverage(mode(), results, new Set(['A', 'B']))
    const u0 = report.mechanics.find((m) => m.id === 'u0')
    expect(u0?.finding).toBe('mandatory')
    expect(u0?.coverage).toBe(1)
    expect(u0?.usedBy).toEqual(['A', 'B'])
  })

  it('flags a mechanic some-but-not-all builds fire as fine', () => {
    const results = [
      result('A', [ev('buy', 'buy:u0')]),
      result('B', [ev('buy_generator', 'gen:g0')]),
    ]
    const report = analyzeCoverage(mode(), results, new Set(['A', 'B']))
    const u0 = report.mechanics.find((m) => m.id === 'u0')
    expect(u0?.finding).toBe('fine')
    expect(u0?.coverage).toBe(0.5)
  })

  it('ignores results outside the viable set', () => {
    const results = [result('A', [ev('buy', 'buy:u0')]), result('nonviable', [ev('buy', 'buy:u1')])]
    const report = analyzeCoverage(mode(), results, new Set(['A']))
    expect(report.viableCount).toBe(1)
    // u1 was only fired by the excluded build → dead among viable builds.
    expect(report.mechanics.find((m) => m.id === 'u1')?.finding).toBe('dead')
  })

  it('counts clicking only when the rate is above zero', () => {
    const zero = analyzeCoverage(
      mode(),
      [result('A', [ev('set_click_rate', 'click:0')])],
      new Set(['A']),
    )
    expect(zero.mechanics.find((m) => m.id === 'click')?.finding).toBe('dead')

    const active = analyzeCoverage(
      mode(),
      [result('A', [ev('set_click_rate', 'click:8')])],
      new Set(['A']),
    )
    expect(active.mechanics.find((m) => m.id === 'click')?.finding).toBe('mandatory')
  })

  it('omits the click row when the mode disables clicking', () => {
    const report = analyzeCoverage(mode({ clicksEnabled: false }), [], new Set())
    expect(report.mechanics.some((m) => m.kind === 'click')).toBe(false)
  })
})

// ─── Acceptance: reproduce idler's documented debt ───────────────────
//
// Phase 8's go/no-go is that, run against the authored corpus, the detector
// independently rediscovers what we already know by hand (plan 25, Phase 2):
// generators can't ramp in the round (dead content) and clicking dominates.
// This test proves 8a's slice of that: dead generators + mandatory clicking.

function idlerTimedCorpus(): {
  results: SimResult[]
  viable: Set<string>
  envelope: TargetEnvelope
} {
  const envelope = envelopeFor('idler', 'timed') as TargetEnvelope
  const durationSec = envelope.checkpoints[envelope.checkpoints.length - 1].timeSec

  const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'strategies', 'idler')
  const strategies = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => parseStrategy(JSON.parse(readFileSync(join(dir, f), 'utf8'))))

  const results = strategies.map((s) => simulate(s, { goal: { kind: 'timed', durationSec } }))
  const scores = simResultsToScores(results, envelope)
  const report = validateEnvelope(envelope, scores, scores)
  const viable = new Set(report.strategies.filter((s) => s.viable).map((s) => s.name))
  return { results, viable, envelope }
}

describe('analyzeCoverage — idler acceptance', () => {
  const { results, viable } = idlerTimedCorpus()
  const report = analyzeCoverage(getModeDefinition('idler'), results, viable)
  const findingFor = (id: string) => report.mechanics.find((m) => m.id === id)?.finding

  it('classifies the same viable count the balance gate does', () => {
    expect(report.viableCount).toBe(viable.size)
    expect(viable.size).toBeGreaterThanOrEqual(6)
  })

  it('flags the late generators as dead content (generators cannot ramp in-round)', () => {
    // g2 and g3 sit too deep in the cost curve for any viable 35s build to reach.
    expect(findingFor('g2')).toBe('dead')
    expect(findingFor('g3')).toBe('dead')
  })

  it('does not flag clicking as dead — it is a live, dominant mechanic', () => {
    expect(findingFor('click')).not.toBe('dead')
  })

  it('finds at least one non-dead upgrade (guards the event-label contract)', () => {
    // A positive assertion: if `simulate()`'s `buy:<id>` event-label format ever
    // changes, `mechanicsUsed`'s parsing would silently mark *every* upgrade dead
    // — the "is dead" assertions above would still pass, but this one would fail.
    expect(report.mechanics.some((m) => m.kind === 'upgrade' && m.finding !== 'dead')).toBe(true)
  })

  it('surfaces at least one dead generator among the findings', () => {
    const deadGenerators = report.mechanics.filter(
      (m) => m.kind === 'generator' && m.finding === 'dead',
    )
    expect(deadGenerators.length).toBeGreaterThan(0)
  })
})
