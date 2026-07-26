import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  analyzeCoverage,
  analyzeDominance,
  analyzePacing,
  envelopeFor,
  getModeDefinition,
  neutralizeClick,
  neutralizeMechanic,
  parseStrategy,
  simResultsToScores,
  simulate,
  validateEnvelope,
} from '../src/index.js'
import type {
  ModeDefinition,
  QueueStrategy,
  SimAction,
  SimEvent,
  SimGoal,
  SimResult,
  TargetEnvelope,
  TickSnapshot,
} from '../src/index.js'

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
  strategies: QueueStrategy[]
  results: SimResult[]
  viable: Set<string>
  envelope: TargetEnvelope
  goal: SimGoal
} {
  const envelope = envelopeFor('idler', 'timed') as TargetEnvelope
  const durationSec = envelope.checkpoints[envelope.checkpoints.length - 1].timeSec
  const goal: SimGoal = { kind: 'timed', durationSec }

  const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'strategies', 'idler')
  const strategies = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => parseStrategy(JSON.parse(readFileSync(join(dir, f), 'utf8'))))

  const results = strategies.map((s) => simulate(s, { goal }))
  const scores = simResultsToScores(results, envelope)
  const report = validateEnvelope(envelope, scores, scores)
  const viable = new Set(report.strategies.filter((s) => s.viable).map((s) => s.name))
  return { strategies, results, viable, envelope, goal }
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

// ─── Phase 8b: neutralization transforms (pure) ──────────────────────

describe('neutralizeMechanic / neutralizeClick', () => {
  const domMode = {
    scoreResource: 'r0',
    clicksEnabled: true,
    upgrades: [{ id: 'u0', cost: { r0: { baseCost: 1 } }, effects: [{ type: 'boost' }] }],
    generators: [
      { id: 'g0', cost: { r1: { baseCost: 5 } }, production: { resource: 'r0', rate: 7 } },
    ],
  } as unknown as ModeDefinition

  it('strips an upgrade\u2019s effects while leaving cost and prereqs intact', () => {
    const out = neutralizeMechanic(domMode, { kind: 'upgrade', id: 'u0' })
    expect(out.upgrades[0].effects).toEqual([])
    expect(out.upgrades[0].cost).toEqual(domMode.upgrades[0].cost)
    // original is untouched (pure clone)
    expect(domMode.upgrades[0].effects).toHaveLength(1)
  })

  it('zeroes a generator\u2019s production rate while leaving cost intact', () => {
    const out = neutralizeMechanic(domMode, { kind: 'generator', id: 'g0' })
    expect(out.generators[0].production.rate).toBe(0)
    expect(out.generators[0].cost).toEqual(domMode.generators[0].cost)
    expect(domMode.generators[0].production.rate).toBe(7)
  })

  it('returns the mode unchanged for a click ref (not a mode-level mechanic)', () => {
    expect(neutralizeMechanic(domMode, { kind: 'click', id: 'click' })).toBe(domMode)
  })

  it('drops every set_click_rate action from a strategy', () => {
    const strat = {
      version: 1,
      name: 'S',
      mode: 'idler',
      actions: [
        { kind: 'buy', upgradeId: 'u0' },
        { kind: 'set_click_rate', cps: 8 },
      ],
    } as unknown as QueueStrategy
    const out = neutralizeClick(strat)
    expect(out.actions.some((a) => a.kind === 'set_click_rate')).toBe(false)
    expect(out.actions).toHaveLength(1)
    // original untouched
    expect(strat.actions).toHaveLength(2)
  })
})

// ─── Phase 8b: dominance unit tests ──────────────────────────────────
//
// A controlled fixture: a single build buys a set of upgrades (and optionally
// clicks). `resim` fakes the engine — it detects which mechanic the analyzer
// neutralized (the upgrade whose `effects` were emptied, or the missing
// `set_click_rate`) and subtracts that mechanic's configured contribution from
// the base score. All costs are in the score resource with a flat curve and a
// score income rate of 1, so `costScoreEquiv` is exactly `cost * levels`.

interface UpgradeSpec {
  cost: number
  contribution: number
  levels?: number
}

function dominanceFixture(spec: {
  base: number
  clickContribution?: number
  upgrades: Record<string, UpgradeSpec>
}): {
  mode: ModeDefinition
  strategies: QueueStrategy[]
  baseline: SimResult[]
  viable: Set<string>
  resim: (s: QueueStrategy, m: ModeDefinition) => SimResult
} {
  const mode = {
    scoreResource: 'r0',
    clicksEnabled: spec.clickContribution !== undefined,
    upgrades: Object.entries(spec.upgrades).map(([id, u]) => ({
      id,
      cost: { r0: { baseCost: u.cost } },
      effects: [{ type: 'boost' }],
    })),
    generators: [],
  } as unknown as ModeDefinition

  const events: SimEvent[] = []
  for (const [id, u] of Object.entries(spec.upgrades)) {
    for (let i = 0; i < (u.levels ?? 1); i++) events.push(ev('buy', `buy:${id}`))
  }
  const actions: SimAction[] = Object.keys(spec.upgrades).map((id) => ({
    kind: 'buy',
    upgradeId: id,
  }))
  if (spec.clickContribution !== undefined) {
    events.push(ev('set_click_rate', 'click:8'))
    actions.push({ kind: 'set_click_rate', cps: 8 })
  }

  const strategy = { version: 1, name: 'S', mode: 'idler', actions } as unknown as QueueStrategy
  const baseline: SimResult = {
    name: 'S',
    mode: 'idler',
    snapshots: [
      { tick: 0, timeSec: 1, score: 0, resources: {}, incomePerSec: { r0: 1 }, event: '' },
    ],
    finalScore: spec.base,
    events,
    notReached: [],
    goalReached: true,
  }

  const resim = (s: QueueStrategy, m: ModeDefinition): SimResult => {
    let score = spec.base
    const clickGone =
      spec.clickContribution !== undefined && !s.actions.some((a) => a.kind === 'set_click_rate')
    if (clickGone) score -= spec.clickContribution ?? 0
    const neutralized = m.upgrades.find((u) => (u.effects?.length ?? 0) === 0)
    if (neutralized) score -= spec.upgrades[neutralized.id].contribution
    return { ...baseline, finalScore: score }
  }

  return { mode, strategies: [strategy], baseline: [baseline], viable: new Set(['S']), resim }
}

describe('analyzeDominance — cost-normalized ROI', () => {
  it('flags a free mechanic with positive contribution as overpowered (infinite ROI)', () => {
    const f = dominanceFixture({
      base: 1000,
      clickContribution: 300,
      upgrades: { u0: { cost: 100, contribution: 100 } },
    })
    const report = analyzeDominance(f.mode, f.strategies, f.baseline, f.viable, f.resim)
    const click = report.rows.find((r) => r.id === 'click')
    expect(click?.finding).toBe('overpowered')
    expect(click?.roi).toBe(Infinity)
    expect(click?.costScoreEquiv).toBe(0)
  })

  it('flags a costed mechanic whose ROI dwarfs the corpus median', () => {
    // u0: cost 1, contributes 100 → ROI 100; u1/u2: cost 100, contributes 100 → ROI 1.
    // median ROI = 1, threshold 3× = 3, so only u0 is overpowered.
    const f = dominanceFixture({
      base: 1000,
      upgrades: {
        u0: { cost: 1, contribution: 100 },
        u1: { cost: 100, contribution: 100 },
        u2: { cost: 100, contribution: 100 },
      },
    })
    const report = analyzeDominance(f.mode, f.strategies, f.baseline, f.viable, f.resim)
    expect(report.rows.find((r) => r.id === 'u0')?.finding).toBe('overpowered')
    expect(report.rows.find((r) => r.id === 'u1')?.finding).toBe('fine')
    expect(report.medianRoi).toBe(1)
  })

  it('does not flag a load-bearing but fairly priced mechanic', () => {
    // Highest raw contribution, but its ROI sits at the median → correct design.
    const f = dominanceFixture({
      base: 1000,
      upgrades: {
        u0: { cost: 500, contribution: 500 },
        u1: { cost: 100, contribution: 100 },
        u2: { cost: 100, contribution: 100 },
      },
    })
    const report = analyzeDominance(f.mode, f.strategies, f.baseline, f.viable, f.resim)
    const u0 = report.rows.find((r) => r.id === 'u0')
    expect(u0?.finding).toBe('fine')
    // ...but it does carry the largest share of contribution.
    expect(u0?.share).toBeGreaterThan(0.5)
  })

  it('floors contribution at zero when neutralization raises the score', () => {
    const f = dominanceFixture({
      base: 1000,
      upgrades: { u0: { cost: 10, contribution: -50 } },
    })
    const report = analyzeDominance(f.mode, f.strategies, f.baseline, f.viable, f.resim)
    const u0 = report.rows.find((r) => r.id === 'u0')
    expect(u0?.contribution).toBe(0)
    expect(u0?.finding).toBe('fine')
  })
})

// ─── Phase 8b acceptance: rediscover click-domination on the idler corpus ──

describe('analyzeDominance — idler acceptance', () => {
  const { strategies, results, viable, goal } = idlerTimedCorpus()
  const report = analyzeDominance(getModeDefinition('idler'), strategies, results, viable, (s, m) =>
    simulate(s, { modeDef: m, goal }),
  )

  it('flags clicking as overpowered — it is free, so any contribution is infinite ROI', () => {
    const click = report.rows.find((r) => r.id === 'click')
    expect(click?.finding).toBe('overpowered')
    expect(click?.roi).toBe(Infinity)
    expect(click?.contribution).toBeGreaterThan(0)
  })

  it('measures a real, cost-normalized ROI for the costed corpus (median is finite)', () => {
    // Guards the ROI machinery end-to-end: if cost reconstruction or the
    // score-equivalent conversion broke, the median would collapse to 0.
    expect(report.medianRoi).toBeGreaterThan(0)
    expect(Number.isFinite(report.medianRoi)).toBe(true)
  })
})

// ─── Phase 8d: pacing / engagement stats ─────────────────────────────

function snap(timeSec: number, income: number, event = ''): TickSnapshot {
  return { tick: timeSec, timeSec, score: 0, resources: {}, incomePerSec: { r0: income }, event }
}

function pacingEvent(index: number, timeSec: number): SimEvent {
  return { timeSec, index, kind: 'buy', label: 'buy:u0' }
}

function pacingResult(name: string, events: SimEvent[], snapshots: TickSnapshot[]): SimResult {
  return {
    name,
    mode: 'idler',
    snapshots,
    finalScore: 0,
    events,
    notReached: [],
    goalReached: true,
  }
}

describe('analyzePacing', () => {
  it('counts distinct authored actions as decisions (count-buys collapse to one)', () => {
    // Three events, but only two distinct action indices → two decisions.
    const events = [pacingEvent(0, 1), pacingEvent(1, 2), pacingEvent(1, 3)]
    const report = analyzePacing([pacingResult('A', events, [])], new Set(['A']))
    expect(report.rows[0].decisions).toBe(2)
  })

  it('reports the first action time, or null when the build never acts', () => {
    const acted = analyzePacing(
      [pacingResult('A', [pacingEvent(0, 5), pacingEvent(1, 2)], [])],
      new Set(['A']),
    )
    expect(acted.rows[0].timeToFirstActionSec).toBe(2)

    const idle = analyzePacing([pacingResult('B', [], [])], new Set(['B']))
    expect(idle.rows[0].timeToFirstActionSec).toBeNull()
  })

  it('measures idle fraction as ticks with no action and flat income', () => {
    // Ticks: [1@flat-idle], [buy → not idle], [2@flat-idle]. denom 3, idle 2.
    const snapshots = [snap(0, 1), snap(1, 1), snap(2, 2, 'buy:u0'), snap(3, 2)]
    const report = analyzePacing([pacingResult('A', [], snapshots)], new Set(['A']))
    expect(report.rows[0].idleFraction).toBeCloseTo(2 / 3, 5)
  })

  it('does not count a growing-income tick as idle even without an action', () => {
    const snapshots = [snap(0, 1), snap(1, 5)]
    const report = analyzePacing([pacingResult('A', [], snapshots)], new Set(['A']))
    expect(report.rows[0].idleFraction).toBe(0)
  })

  it('includes only viable builds', () => {
    const report = analyzePacing(
      [pacingResult('A', [], []), pacingResult('B', [], [])],
      new Set(['A']),
    )
    expect(report.rows.map((r) => r.name)).toEqual(['A'])
  })
})
