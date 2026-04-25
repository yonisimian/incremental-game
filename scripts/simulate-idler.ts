/**
 * Idler Balance Simulation Script
 *
 * Automates upgrade chain traces for every meaningful idler strategy.
 * Tavern Recruits (TR) is repeatable (+1 base wood/sec each, 15 ale).
 * Sharpened Axes (SA, 30 wood) and Lumber Mill (LM, 80 wood) are one-shot.
 *
 * Run: pnpm sim:idler
 * Prereq: pnpm --filter @game/shared build
 */

import {
  IDLER_UPGRADES,
  INITIAL_PLAYER_STATE,
  TICK_INTERVAL_MS,
  applyIdlerPurchase,
  applyPassiveTick,
  collectModifiers,
  getModeDefinition,
} from '@game/shared'
import type { CurrencyHighlight, PlayerState, UpgradeId } from '@game/shared'

const idlerDef = getModeDefinition('idler')

// ─── Strategy types ──────────────────────────────────────────────────

interface StrategyAction {
  type: 'buy' | 'set_highlight'
  upgradeId?: UpgradeId
  highlight?: CurrencyHighlight
}

interface Strategy {
  name: string
  actions: StrategyAction[]
}

// ─── Helpers ─────────────────────────────────────────────────────────

const buy = (upgradeId: UpgradeId): StrategyAction => ({
  type: 'buy',
  upgradeId,
})

const highlight = (h: CurrencyHighlight): StrategyAction => ({
  type: 'set_highlight',
  highlight: h,
})

// ─── Upgrade lookup (for affordability checks) ──────────────────────

const upgradeMap = new Map(IDLER_UPGRADES.map((u) => [u.id, u]))

// ─── Strategies ──────────────────────────────────────────────────────
// With repeatable TR, key decision is how many TRs to stack before
// switching to wood upgrades.

const STRATEGIES: Strategy[] = [
  {
    name: 'No upgrades',
    actions: [highlight('wood')],
  },
  {
    name: 'SA only',
    actions: [highlight('wood'), buy('sharpened-axes')],
  },
  {
    name: 'SA→LM',
    actions: [highlight('wood'), buy('sharpened-axes'), buy('lumber-mill')],
  },
  {
    name: 'TR×1→SA→LM',
    actions: [
      highlight('ale'),
      buy('tavern-recruits'),
      highlight('wood'),
      buy('sharpened-axes'),
      buy('lumber-mill'),
    ],
  },
  {
    name: 'TR×2→SA→LM',
    actions: [
      highlight('ale'),
      buy('tavern-recruits'),
      buy('tavern-recruits'),
      highlight('wood'),
      buy('sharpened-axes'),
      buy('lumber-mill'),
    ],
  },
  {
    name: 'TR×3→SA→LM',
    actions: [
      highlight('ale'),
      buy('tavern-recruits'),
      buy('tavern-recruits'),
      buy('tavern-recruits'),
      highlight('wood'),
      buy('sharpened-axes'),
      buy('lumber-mill'),
    ],
  },
  {
    name: 'TR×4→SA→LM',
    actions: [
      highlight('ale'),
      buy('tavern-recruits'),
      buy('tavern-recruits'),
      buy('tavern-recruits'),
      buy('tavern-recruits'),
      highlight('wood'),
      buy('sharpened-axes'),
      buy('lumber-mill'),
    ],
  },
  {
    name: 'TR×1→SA',
    actions: [highlight('ale'), buy('tavern-recruits'), highlight('wood'), buy('sharpened-axes')],
  },
  {
    name: 'TR×2→SA',
    actions: [
      highlight('ale'),
      buy('tavern-recruits'),
      buy('tavern-recruits'),
      highlight('wood'),
      buy('sharpened-axes'),
    ],
  },
  {
    name: 'TR×1 only',
    actions: [highlight('ale'), buy('tavern-recruits'), highlight('wood')],
  },
  {
    name: 'TR×3 only',
    actions: [
      highlight('ale'),
      buy('tavern-recruits'),
      buy('tavern-recruits'),
      buy('tavern-recruits'),
      highlight('wood'),
    ],
  },
  {
    name: 'SA→TR×1→LM',
    actions: [
      highlight('wood'),
      buy('sharpened-axes'),
      highlight('ale'),
      buy('tavern-recruits'),
      highlight('wood'),
      buy('lumber-mill'),
    ],
  },
  {
    name: 'SA→TR×2→LM',
    actions: [
      highlight('wood'),
      buy('sharpened-axes'),
      highlight('ale'),
      buy('tavern-recruits'),
      buy('tavern-recruits'),
      highlight('wood'),
      buy('lumber-mill'),
    ],
  },
]

// ─── Simulation ──────────────────────────────────────────────────────

interface SimResult {
  name: string
  score: number
  trCount: number
  purchaseLog: { id: string; time: number }[]
  lastPurchaseSec: number
}

function createInitialState(): PlayerState {
  return {
    score: INITIAL_PLAYER_STATE.score,
    currency: INITIAL_PLAYER_STATE.currency,
    upgrades: { ...INITIAL_PLAYER_STATE.upgrades },
    wood: 0,
    ale: 0,
    highlight: 'wood',
  }
}

function isActionImmediate(action: StrategyAction): boolean {
  return action.type === 'set_highlight'
}

function canAfford(state: PlayerState, action: StrategyAction): boolean {
  if (action.type === 'set_highlight') return true
  if (action.type === 'buy' && action.upgradeId) {
    const def = upgradeMap.get(action.upgradeId)
    if (!def) return false
    if (def.costCurrency === 'wood') return (state.wood ?? 0) >= def.cost
    if (def.costCurrency === 'ale') return (state.ale ?? 0) >= def.cost
    return state.currency >= def.cost
  }
  return false
}

function executeAction(state: PlayerState, action: StrategyAction): void {
  if (action.type === 'set_highlight' && action.highlight) {
    state.highlight = action.highlight
  } else if (action.type === 'buy' && action.upgradeId) {
    applyIdlerPurchase(state, action.upgradeId)
  }
}

function simulate(strategy: Strategy): SimResult {
  const state = createInitialState()
  const timedGoal = idlerDef.goals.find((g) => g.type === 'timed')
  const roundDurationSec = timedGoal && timedGoal.type === 'timed' ? timedGoal.durationSec : 35
  const tickSec = TICK_INTERVAL_MS / 1000
  const totalTicks = (roundDurationSec * 1000) / TICK_INTERVAL_MS

  const purchaseLog: { id: string; time: number }[] = []
  let actionIndex = 0
  let lastPurchaseSec = 0

  // Pre-loop: drain immediate (zero-cost) actions before any income
  while (
    actionIndex < strategy.actions.length &&
    isActionImmediate(strategy.actions[actionIndex])
  ) {
    executeAction(state, strategy.actions[actionIndex])
    actionIndex++
  }

  // Main simulation loop
  for (let tick = 0; tick < totalTicks; tick++) {
    const currentSec = (tick + 1) * tickSec // time after this tick

    // Step 1: passive income
    applyPassiveTick(
      state,
      idlerDef.resources,
      idlerDef.scoreResource,
      collectModifiers(state, idlerDef),
      tickSec,
    )

    // Step 2: execute ready actions (may be multiple per tick)
    while (
      actionIndex < strategy.actions.length &&
      canAfford(state, strategy.actions[actionIndex])
    ) {
      const action = strategy.actions[actionIndex]
      executeAction(state, action)

      if (action.type === 'buy' && action.upgradeId) {
        purchaseLog.push({ id: action.upgradeId, time: currentSec })
        lastPurchaseSec = currentSec
      }

      actionIndex++
    }
  }

  return {
    name: strategy.name,
    score: Math.round(state.score * 100) / 100,
    trCount: Number(state.upgrades['tavern-recruits']) || 0,
    purchaseLog,
    lastPurchaseSec,
  }
}

// ─── Output formatting ──────────────────────────────────────────────

const UPGRADE_ABBR: Record<string, string> = {
  'tavern-recruits': 'TR',
  'sharpened-axes': 'SA',
  'lumber-mill': 'LM',
}

function printComparisonTable(results: SimResult[]): void {
  const bestScore = Math.max(...results.map((r) => r.score))

  console.log(
    '\n┌────────────────────────────────────────────────────────────────────────────────────┐',
  )
  console.log(
    '│                           STRATEGY COMPARISON TABLE                               │',
  )
  console.log(
    '├────────────────────────────────────────────────────────────────────────────────────┤',
  )
  console.log(
    '│ Strategy              Score  % Best  TR#  Purchase timeline                       │',
  )
  console.log(
    '├────────────────────────────────────────────────────────────────────────────────────┤',
  )

  for (const r of results) {
    const pct = ((r.score / bestScore) * 100).toFixed(0).padStart(3)
    const name = r.name.padEnd(20)
    const score = r.score.toFixed(0).padStart(6)
    const trCount = String(r.trCount).padStart(2)

    const timeline = r.purchaseLog
      .map((p) => `${UPGRADE_ABBR[p.id] ?? p.id}@${p.time.toFixed(1)}s`)
      .join(' → ')

    console.log(`│ ${name} ${score}   ${pct}%   ${trCount}  ${timeline.padEnd(38)}│`)
  }

  console.log(
    '└────────────────────────────────────────────────────────────────────────────────────┘',
  )
}

// ─── Main ────────────────────────────────────────────────────────────

const results = STRATEGIES.map(simulate)
results.sort((a, b) => b.score - a.score)
printComparisonTable(results)
