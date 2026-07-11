// @game/shared — headless queue-strategy simulation engine.
//
// Drives a QueueStrategy through a headless game loop. The engine walks the
// action list with a single cursor, embodying one primitive: "advance simulated
// time until the current action's condition holds, then apply it and move on."
//   - instant actions (set_highlight, set_click_rate) apply with no time passing
//   - buy / buy_generator block until affordable (count = N back-to-back units)
//   - wait blocks on an explicit predicate
// The round timer is the hard stop; whatever's left in the queue is reported as
// not-reached. See docs/plans/23-timeline-strategy-simulation.md.

import { MAX_CPS, TICK_INTERVAL_MS } from '../game-config.js'
import {
  collectModifiers,
  createInitialState,
  getModeDefinition,
  isClickUnlocked,
} from '../modes/index.js'
import type { ModeDefinition } from '../modes/types.js'
import { applyPassiveTick, computeClickIncome, computePassiveRates } from '../modifiers/pipeline.js'
import type { GameMode, UpgradeDefinition } from '../types.js'
import { applySimAction } from './apply.js'
import type { QueueStrategy, SimAction, WaitCondition } from './strategy.js'

// ─── Result types ────────────────────────────────────────────────────

export interface TickSnapshot {
  tick: number
  timeSec: number
  score: number
  resources: Record<string, number>
  incomePerSec: Record<string, number>
  /** Comma-joined labels of actions applied during this tick (for chart markers). */
  event: string
}

export interface SimEvent {
  /** Derived fire-time — an output of the run, not authored. */
  timeSec: number
  /** Index into the strategy's action list. */
  index: number
  kind: SimAction['kind']
  label: string
}

export interface NotReached {
  index: number
  action: SimAction
  /**
   * Why it never (fully) fired: a permanent block ('maxed' | 'prerequisite' |
   * 'choice-group' | 'locked' | 'unknown'), 'unaffordable'/'waiting' when the
   * round ended mid-block, or 'round-ended' for actions the cursor never reached.
   */
  reason: string
  /** For a partially-applied count buy: how many units/levels did fire. */
  boughtSoFar?: number
}

export interface SimResult {
  name: string
  mode: GameMode
  snapshots: TickSnapshot[]
  finalScore: number
  events: SimEvent[]
  notReached: NotReached[]
}

/**
 * When the simulation stops:
 * - `timed`: run for exactly `durationSec`.
 * - `score`: run until score ≥ `target` (or the safety cap is hit).
 * - `race_to_buy`: run until the whole queue completes — i.e. the last action
 *   (the goal purchase) fires — or the safety cap is hit.
 */
export type SimGoal =
  | { kind: 'timed'; durationSec: number }
  | { kind: 'score'; target: number; safetyCapSec?: number }
  | { kind: 'race_to_buy'; safetyCapSec?: number }

/** Fallback cap for open-ended goals (`score`, `race_to_buy`) that never resolve. */
export const DEFAULT_SIM_CAP_SEC = 600

export interface SimulateOptions {
  /** Override the mode definition instead of resolving from the registry (tests). */
  modeDef?: ModeDefinition
  /** Override the round length; defaults to the mode's timed goal, else 35s. */
  roundDurationSec?: number
  /** Termination condition. Defaults to a timed goal of `roundDurationSec`. */
  goal?: SimGoal
}

// ─── Engine ──────────────────────────────────────────────────────────

export function simulate(strategy: QueueStrategy, options?: SimulateOptions): SimResult {
  const modeDef = options?.modeDef ?? getModeDefinition(strategy.mode)
  const upgradeMap: ReadonlyMap<string, UpgradeDefinition> = new Map(
    modeDef.upgrades.map((u) => [u.id, u]),
  )
  const state = createInitialState(modeDef)

  const timedGoal = modeDef.goals.find((g) => g.type === 'timed')
  const defaultDurationSec =
    options?.roundDurationSec ?? (timedGoal?.type === 'timed' ? timedGoal.durationSec : 35)
  const goal: SimGoal = options?.goal ?? { kind: 'timed', durationSec: defaultDurationSec }

  const tickSec = TICK_INTERVAL_MS / 1000
  // Timed runs exactly `durationSec`; open-ended goals loop up to a safety cap
  // and break early when their condition is met (checked at the end of each tick).
  const capSec =
    goal.kind === 'timed' ? goal.durationSec : (goal.safetyCapSec ?? DEFAULT_SIM_CAP_SEC)
  const totalTicks = Math.round((capSec * 1000) / TICK_INTERVAL_MS)

  const snapshots: TickSnapshot[] = []
  const events: SimEvent[] = []
  const notReached: NotReached[] = []

  // ── Engine state ──
  let cursor = 0
  let activeCursor = -1 // which cursor `remainingCount`/`waitStartSec` describe
  let remainingCount = 0 // units left for the current buy/buy_generator action
  let waitStartSec: number | null = null // when the current `seconds` wait began
  let clickCps = 0 // background clicking policy (set_click_rate)
  let clickResource: string | undefined

  const label = (action: SimAction): string => {
    switch (action.kind) {
      case 'buy':
        return `buy:${action.upgradeId}`
      case 'buy_generator':
        return `gen:${action.generatorId}`
      case 'set_highlight':
        return `highlight:${action.highlight}`
      case 'set_click_rate':
        return `click:${action.cps}`
      case 'wait':
        return 'wait'
    }
  }

  const record = (timeSec: number, action: SimAction): void => {
    events.push({ timeSec, index: cursor, kind: action.kind, label: label(action) })
  }

  const isWaitSatisfied = (cond: WaitCondition, timeSec: number): boolean => {
    if (cond.kind === 'seconds')
      return waitStartSec !== null && timeSec - waitStartSec >= cond.seconds
    return (state.resources[cond.resource] ?? 0) >= cond.amount
  }

  // Walk the cursor as far as possible at the given time: drain instant actions,
  // buy every affordable unit, and stop at the first action that must block.
  const processCursor = (timeSec: number): void => {
    while (cursor < strategy.actions.length) {
      const action = strategy.actions[cursor]

      // Lazily initialize per-action state the first time we sit on this cursor.
      if (cursor !== activeCursor) {
        activeCursor = cursor
        remainingCount =
          action.kind === 'buy' || action.kind === 'buy_generator' ? (action.count ?? 1) : 0
        waitStartSec = action.kind === 'wait' && action.until.kind === 'seconds' ? timeSec : null
      }

      switch (action.kind) {
        case 'set_click_rate':
          clickCps = action.cps
          clickResource = action.resource
          record(timeSec, action)
          cursor++
          continue
        case 'set_highlight':
          applySimAction(state, action, modeDef, upgradeMap)
          record(timeSec, action)
          cursor++
          continue
        case 'wait':
          if (isWaitSatisfied(action.until, timeSec)) {
            cursor++
            continue
          }
          return // predicate not met yet — block
        case 'buy':
        case 'buy_generator': {
          while (remainingCount > 0) {
            const result = applySimAction(state, action, modeDef, upgradeMap)
            if (result.status === 'applied') {
              record(timeSec, action)
              remainingCount--
              continue
            }
            if (result.status === 'transient') return // unaffordable — block
            // Permanent block: give up on the rest of this action's count.
            notReached.push({
              index: cursor,
              action,
              reason: result.reason,
              boughtSoFar: (action.count ?? 1) - remainingCount,
            })
            remainingCount = 0
          }
          cursor++
          continue
        }
      }
    }
  }

  // Apply everything doable at t=0 (leading highlight/click-rate, waits already
  // satisfied, buys affordable from the starting resources) before any income.
  processCursor(0)

  for (let tick = 0; tick < totalTicks; tick++) {
    const timeSec = (tick + 1) * tickSec

    // 1) passive + generator income
    const modifiers = collectModifiers(state, modeDef)
    applyPassiveTick(state, modeDef.resources, modeDef.scoreResource, modifiers, tickSec)

    // 2) background clicking at the current policy rate
    if (clickCps > 0 && isClickUnlocked(state, modeDef)) {
      const cps = Math.min(clickCps, MAX_CPS)
      // Mirror peak CPS into meta BEFORE computing click income, so a
      // `relativeModifier` sourced from `meta:peakCps` sees it (matches server).
      const prevPeak = (state.meta.peakCps as number | undefined) ?? 0
      state.meta.peakCps = Math.max(prevPeak, cps)
      const clickIncome = computeClickIncome(collectModifiers(state, modeDef))
      const gain = clickIncome * cps * tickSec
      const res =
        clickResource && modeDef.resources.includes(clickResource)
          ? clickResource
          : modeDef.scoreResource
      state.resources[res] = (state.resources[res] ?? 0) + gain
      if (res === modeDef.scoreResource) state.score += gain
    }

    // 3) advance the queue
    const eventsBefore = events.length
    processCursor(timeSec)
    const tickEvents = events.slice(eventsBefore).map((e) => e.label)

    // 4) snapshot
    const rates = computePassiveRates(collectModifiers(state, modeDef), modeDef.resources)
    snapshots.push({
      tick,
      timeSec,
      score: state.score,
      resources: { ...state.resources },
      incomePerSec: rates,
      event: tickEvents.join(', '),
    })

    // 5) goal reached? (open-ended goals only) — stop once satisfied.
    if (goal.kind === 'score' && state.score >= goal.target) break
    if (goal.kind === 'race_to_buy' && cursor >= strategy.actions.length) break
  }

  // Round ended: report anything left in the queue.
  if (cursor < strategy.actions.length) {
    const current = strategy.actions[cursor]
    notReached.push({
      index: cursor,
      action: current,
      reason: blockReasonAtRoundEnd(current),
      ...(current.kind === 'buy' || current.kind === 'buy_generator'
        ? { boughtSoFar: (current.count ?? 1) - remainingCount }
        : {}),
    })
    for (let i = cursor + 1; i < strategy.actions.length; i++) {
      notReached.push({ index: i, action: strategy.actions[i], reason: 'round-ended' })
    }
  }

  return {
    name: strategy.name,
    mode: strategy.mode,
    snapshots,
    finalScore: Math.round(state.score * 100) / 100,
    events,
    notReached,
  }

  function blockReasonAtRoundEnd(action: SimAction): string {
    if (action.kind === 'wait') return 'waiting'
    // buy/buy_generator were blocked (transient) or instants (unreachable);
    // 'unaffordable' is the expected reason for a blocked purchase at timeout.
    if (action.kind === 'buy' || action.kind === 'buy_generator') return 'unaffordable'
    return 'round-ended'
  }
}
