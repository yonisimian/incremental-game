import { describe, expect, it } from 'vitest'
import type { SimGoal, SimResult, TickSnapshot } from '@game/shared'
import { envelopeBand, envelopeSectionHtml } from '../src/dev/queue-envelope.js'

const TIMED: SimGoal = { kind: 'timed', durationSec: 35 }
const SCORE: SimGoal = { kind: 'score', target: 500 }

function snap(timeSec: number, score: number): TickSnapshot {
  return {
    tick: Math.round(timeSec * 4),
    timeSec,
    score,
    resources: {},
    incomePerSec: {},
    event: '',
  }
}

/** A result whose score is constant across a full 35s run (reaches every checkpoint). */
function fullRun(name: string, score: number): SimResult {
  const snapshots = [5, 10, 15, 25, 35].map((t) => snap(t, score))
  return {
    name,
    mode: 'idler',
    snapshots,
    finalScore: score,
    events: [],
    notReached: [],
    goalReached: true,
  }
}

describe('envelopeSectionHtml', () => {
  it('shows the empty state when no envelope exists for the goal', () => {
    // No pacing envelope is registered yet, so a score goal has none.
    expect(envelopeSectionHtml('idler', [fullRun('A', 100)], SCORE)).toContain(
      'No envelope for this goal',
    )
  })

  it('shows a prompt when there are no results', () => {
    expect(envelopeSectionHtml('idler', [], TIMED)).toContain('Run a strategy')
  })

  it('guards against runs that stop before the final checkpoint', () => {
    const short: SimResult = {
      name: 'short',
      mode: 'idler',
      snapshots: [snap(5, 10), snap(20, 40)],
      finalScore: 40,
      events: [],
      notReached: [],
      goalReached: true,
    }
    const html = envelopeSectionHtml('idler', [short], TIMED)
    expect(html).toContain('Run ≥ 35s')
    expect(html).not.toContain('envelope-verdict')
  })

  it('renders a FAIL verdict with an exploit warning when scores blow past the band', () => {
    const html = envelopeSectionHtml(
      'idler',
      [fullRun('Exploiter', 1e9), fullRun('Zero', 0)],
      TIMED,
    )
    expect(html).toContain('envelope-verdict fail')
    expect(html).toContain('FAIL')
    expect(html).toContain('perfect-timing only')
    // Both strategies appear as rows, with status-driven row classes.
    expect(html).toContain('Exploiter')
    expect(html).toContain('Zero')
    expect(html).toContain('envelope-row-above')
    expect(html).toContain('envelope-row-below')
    // The over-cap strategy is flagged as an exploit candidate.
    expect(html).toContain('envelope-warnings')
    expect(html).toContain('Exploiter')
  })

  it('escapes strategy names in the rendered table', () => {
    const html = envelopeSectionHtml('idler', [fullRun('<script>', 1e9)], TIMED)
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>')
  })
})

describe('envelopeBand', () => {
  it('returns a well-formed score band for a timed goal', () => {
    const band = envelopeBand('idler', TIMED)
    expect(band).toBeDefined()
    // Equal-length, non-empty arrays so the chart guard accepts it.
    expect(band!.xs.length).toBeGreaterThan(0)
    expect(band!.mins).toHaveLength(band!.xs.length)
    expect(band!.maxs).toHaveLength(band!.xs.length)
    // Checkpoint times ascending; each max ≥ min.
    for (let i = 1; i < band!.xs.length; i++) expect(band!.xs[i]).toBeGreaterThan(band!.xs[i - 1])
    band!.xs.forEach((_, i) => {
      expect(band!.maxs[i]).toBeGreaterThanOrEqual(band!.mins[i])
    })
    expect(band!.label).toBe('Target envelope')
  })

  it('returns no band for a goal without a target envelope', () => {
    expect(envelopeBand('idler', SCORE)).toBeUndefined()
  })
})
