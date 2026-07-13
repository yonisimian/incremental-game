/**
 * Convert a recorded live playthrough (an ordered list of `PlayerAction`s) into
 * an authorable `QueueStrategy` for the Queue tab.
 *
 * Buys, generator purchases, and highlight switches map 1:1 (and consecutive
 * identical buys collapse into a single `count`). Clicking is the lossy case:
 * a `QueueStrategy` has no per-click action, only a persistent `set_click_rate`,
 * so contiguous same-resource click runs are converted to a measured-CPS rate
 * that stays in effect until the player's clicking changes (a new resource or a
 * materially different rate). This faithfully reproduces the common "click while
 * saving up for the next buy" pattern; front-loaded bursts followed by long
 * idle clicking may over-earn, so the exported strategy is meant to be reviewed
 * and tweaked in the editable Queue tab.
 */

import { MAX_CPS } from '@game/shared'
import type { GameMode, PlayerAction, QueueStrategy, SimAction } from '@game/shared'

/**
 * Two consecutive clicks more than this far apart (ms) belong to different
 * clicking phases — the player paused, so we don't average across the gap.
 */
const PHASE_GAP_MS = 1000

/** A contiguous run of same-resource clicks. */
interface ClickPhase {
  resource: string | undefined
  startMs: number
  cps: number
}

/** Group clicks into phases and measure each phase's clicks-per-second. */
function detectClickPhases(clicks: PlayerAction[]): ClickPhase[] {
  const phases: ClickPhase[] = []
  let run: PlayerAction[] = []

  const flush = (): void => {
    // A rate needs at least two clicks to measure an interval; drop lone clicks.
    if (run.length >= 2) {
      const startMs = run[0].timestamp
      const spanSec = (run[run.length - 1].timestamp - startMs) / 1000
      // N clicks span N−1 intervals; guard against a zero span (same-ms clicks).
      const cps = spanSec > 0 ? (run.length - 1) / spanSec : MAX_CPS
      const rounded = Math.min(Math.round(cps * 10) / 10, MAX_CPS)
      phases.push({ resource: run[0].resource, startMs, cps: rounded })
    }
    run = []
  }

  for (const click of clicks) {
    if (run.length > 0) {
      const prev = run[run.length - 1]
      if (click.resource !== prev.resource || click.timestamp - prev.timestamp > PHASE_GAP_MS) {
        flush()
      }
    }
    run.push(click)
  }
  flush()

  return phases
}

/** A queue action tagged with the wall-clock time it happened, for ordering. */
interface TimedAction {
  ms: number
  action: SimAction
}

/**
 * Build a `QueueStrategy` from recorded actions. `mode` and `name` come from the
 * live round. Actions are emitted in wall-clock order; the queue engine derives
 * timing at run, so timestamps are dropped from the output.
 */
export function liveActionsToStrategy(
  actions: readonly PlayerAction[],
  mode: GameMode,
  name: string,
): QueueStrategy {
  const timed: TimedAction[] = []

  // Non-click actions map directly, keyed by their timestamp.
  for (const a of actions) {
    if (a.type === 'buy' && a.upgradeId !== undefined) {
      timed.push({ ms: a.timestamp, action: { kind: 'buy', upgradeId: a.upgradeId } })
    } else if (a.type === 'buy_generator' && a.generatorId !== undefined) {
      timed.push({
        ms: a.timestamp,
        action: { kind: 'buy_generator', generatorId: a.generatorId },
      })
    } else if (a.type === 'set_highlight' && a.highlight !== undefined) {
      timed.push({ ms: a.timestamp, action: { kind: 'set_highlight', highlight: a.highlight } })
    }
  }

  // Clicks become one set_click_rate per phase, at the phase's start time.
  const clicks = actions.filter((a) => a.type === 'click')
  for (const phase of detectClickPhases(clicks)) {
    const action: SimAction =
      phase.resource !== undefined
        ? { kind: 'set_click_rate', resource: phase.resource, cps: phase.cps }
        : { kind: 'set_click_rate', cps: phase.cps }
    timed.push({ ms: phase.startMs, action })
  }

  // Stable-sort by time (preserve original relative order for equal timestamps).
  timed.sort((a, b) => a.ms - b.ms)

  return { version: 1, name, mode, actions: compress(timed.map((t) => t.action)) }
}

/**
 * Post-process the ordered actions:
 * - collapse consecutive identical buys / generator buys into one `count`,
 * - drop a `set_click_rate` that doesn't change the currently-active rate.
 *
 * Two adjacent but *different* click rates are both kept — they're distinct
 * phases (e.g. switching the clicked resource). Only one persists in-engine, but
 * the export preserves what the player actually did for later editing.
 */
function compress(actions: SimAction[]): SimAction[] {
  const out: SimAction[] = []

  for (const action of actions) {
    const prev = out.length > 0 ? out[out.length - 1] : undefined

    if (
      prev !== undefined &&
      action.kind === 'buy' &&
      prev.kind === 'buy' &&
      prev.upgradeId === action.upgradeId
    ) {
      prev.count = (prev.count ?? 1) + 1
      continue
    }
    if (
      prev !== undefined &&
      action.kind === 'buy_generator' &&
      prev.kind === 'buy_generator' &&
      prev.generatorId === action.generatorId
    ) {
      prev.count = (prev.count ?? 1) + 1
      continue
    }
    // Skip a click rate that doesn't change the currently-active rate.
    if (action.kind === 'set_click_rate') {
      const active = lastClickRate(out)
      if (active && sameRate(active, action)) continue
    }

    out.push({ ...action })
  }

  return out
}

type ClickRateAction = Extract<SimAction, { kind: 'set_click_rate' }>

/** Whether two click rates are indistinguishable (same resource + cps). */
function sameRate(a: ClickRateAction, b: ClickRateAction): boolean {
  return a.cps === b.cps && a.resource === b.resource
}

/** The most recent set_click_rate in the output so far, if any. */
function lastClickRate(out: SimAction[]): ClickRateAction | null {
  for (let i = out.length - 1; i >= 0; i--) {
    const a = out[i]
    if (a.kind === 'set_click_rate') return a
  }
  return null
}
