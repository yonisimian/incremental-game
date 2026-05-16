/**
 * Simulation engine for the dev panel.
 *
 * Runs a headless game loop for a given strategy and returns per-tick
 * snapshots for charting + a purchase log for timeline markers.
 */

import type { GameMode, ModeDefinition, PlayerState } from '@game/shared'
import {
  TICK_INTERVAL_MS,
  applyPassiveTick,
  applyPurchase,
  collectModifiers,
  computePassiveRates,
  createInitialState,
  getModeDefinition,
  isMaxed,
} from '@game/shared'
import type { Strategy, StrategyAction } from './strategies.js'

// ─── Types ───────────────────────────────────────────────────────────

export interface TickSnapshot {
  tick: number
  timeSec: number
  score: number
  resources: Record<string, number>
  incomePerSec: Record<string, number>
  event: string // "buy:u0" or ""
}

export interface SimResult {
  name: string
  snapshots: TickSnapshot[]
  finalScore: number
  purchaseLog: { id: string; timeSec: number }[]
}

// ─── Helpers ─────────────────────────────────────────────────────────

function isImmediate(action: StrategyAction): boolean {
  return action.type === 'set_highlight'
}

function canAfford(state: PlayerState, action: StrategyAction, modeDef: ModeDefinition): boolean {
  if (action.type === 'set_highlight') return true
  if (action.upgradeId) {
    const def = modeDef.upgrades.find((u) => u.id === action.upgradeId)
    if (!def) return false

    const owned = state.upgrades[action.upgradeId] ?? 0
    if (isMaxed(def, owned)) return false

    // Check prerequisites
    if (def.prerequisites?.some((pid) => (state.upgrades[pid] ?? 0) <= 0)) return false

    const costResource = def.costCurrency ?? modeDef.scoreResource
    return (state.resources[costResource] ?? 0) >= def.cost
  }
  return false
}

function executeAction(state: PlayerState, action: StrategyAction, modeDef: ModeDefinition): void {
  if (action.type === 'set_highlight' && action.highlight) {
    state.meta.highlight = action.highlight
  } else if (action.type === 'buy' && action.upgradeId) {
    applyPurchase(state, action.upgradeId, modeDef)
  }
}

// ─── Simulate ────────────────────────────────────────────────────────

export function simulate(strategy: Strategy, mode: GameMode): SimResult {
  const modeDef = getModeDefinition(mode)
  const state = createInitialState(modeDef)

  const timedGoal = modeDef.goals.find((g) => g.type === 'timed')
  const roundDurationSec = timedGoal?.type === 'timed' ? timedGoal.durationSec : 35
  const tickSec = TICK_INTERVAL_MS / 1000
  const totalTicks = Math.round((roundDurationSec * 1000) / TICK_INTERVAL_MS)

  const snapshots: TickSnapshot[] = []
  const purchaseLog: { id: string; timeSec: number }[] = []
  let actionIndex = 0

  // Pre-loop: drain immediate (zero-cost) actions before any income
  while (actionIndex < strategy.actions.length && isImmediate(strategy.actions[actionIndex])) {
    executeAction(state, strategy.actions[actionIndex], modeDef)
    actionIndex++
  }

  // Main simulation loop
  for (let tick = 0; tick < totalTicks; tick++) {
    const timeSec = (tick + 1) * tickSec

    // Step 1: passive income
    const modifiers = collectModifiers(state, modeDef)
    applyPassiveTick(state, modeDef.resources, modeDef.scoreResource, modifiers, tickSec)

    // Step 2: execute ready actions (may be multiple per tick)
    const events: string[] = []
    while (
      actionIndex < strategy.actions.length &&
      canAfford(state, strategy.actions[actionIndex], modeDef)
    ) {
      const action = strategy.actions[actionIndex]
      executeAction(state, action, modeDef)

      if (action.type === 'buy' && action.upgradeId) {
        purchaseLog.push({ id: action.upgradeId, timeSec })
        events.push(`buy:${action.upgradeId}`)
      }

      actionIndex++
    }

    // Step 3: record snapshot
    const postModifiers = collectModifiers(state, modeDef)
    const rates = computePassiveRates(postModifiers, modeDef.resources)

    snapshots.push({
      tick,
      timeSec,
      score: state.score,
      resources: { ...state.resources },
      incomePerSec: rates,
      event: events.join(', '),
    })
  }

  return {
    name: strategy.name,
    snapshots,
    finalScore: Math.round(state.score * 100) / 100,
    purchaseLog,
  }
}
