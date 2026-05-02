/**
 * Idler Balance Simulation Script
 *
 * Automates upgrade chain traces for every meaningful idler strategy.
 * Play-panel upgrades have been removed; all upgrades are now in the tree.
 * Sharpened Axes (SA, 30 wood, tree) doubles highlight to 4×.
 * Heavy Logging (HL, 25 wood, tree) adds +5 wood/sec.
 * Royal Brewery (RB, 25 ale, tree) adds +5 ale/sec.
 * Master Craftsmen (MC, 10 ale, tree, repeatable, prereq: RB) adds +5 wood/sec each.
 * Industrial Era (IE, 50 wood, tree, prereqs: HL+SA+RB) multiplies all ×1.25.
 *
 * Run: pnpm sim:idler
 * Prereq: pnpm --filter @game/shared build
 */

import {
  TICK_INTERVAL_MS,
  applyPassiveTick,
  applyPurchase,
  collectModifiers,
  createInitialState,
  getModeDefinition,
} from '@game/shared'
import type { PlayerState } from '@game/shared'

const idlerDef = getModeDefinition('idler')

// ─── Strategy types ──────────────────────────────────────────────────

interface StrategyAction {
  type: 'buy' | 'set_highlight'
  upgradeId?: string
  highlight?: string
}

interface Strategy {
  name: string
  actions: StrategyAction[]
}

// ─── Helpers ─────────────────────────────────────────────────────────

const buy = (upgradeId: string): StrategyAction => ({
  type: 'buy',
  upgradeId,
})

const highlight = (h: string): StrategyAction => ({
  type: 'set_highlight',
  highlight: h,
})

// ─── Upgrade lookup (for affordability checks) ──────────────────────

const upgradeMap = new Map(idlerDef.upgrades.map((u) => [u.id, u]))

// ─── Strategies ──────────────────────────────────────────────────────
// With tree upgrades, key decisions are which order to buy SA/HL/RB and
// how many MCs to stack before going for Industrial Era.

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
    name: 'HL only',
    actions: [highlight('wood'), buy('heavy-logging')],
  },
  {
    name: 'SA→HL',
    actions: [highlight('wood'), buy('sharpened-axes'), buy('heavy-logging')],
  },
  {
    name: 'HL→SA',
    actions: [highlight('wood'), buy('heavy-logging'), buy('sharpened-axes')],
  },
  {
    name: 'RB→MC×1→SA→HL',
    actions: [
      highlight('ale'),
      buy('royal-brewery'),
      buy('master-craftsmen'),
      highlight('wood'),
      buy('sharpened-axes'),
      buy('heavy-logging'),
    ],
  },
  {
    name: 'RB→MC×2→SA→HL',
    actions: [
      highlight('ale'),
      buy('royal-brewery'),
      buy('master-craftsmen'),
      buy('master-craftsmen'),
      highlight('wood'),
      buy('sharpened-axes'),
      buy('heavy-logging'),
    ],
  },
  {
    name: 'RB→MC×3→SA→HL',
    actions: [
      highlight('ale'),
      buy('royal-brewery'),
      buy('master-craftsmen'),
      buy('master-craftsmen'),
      buy('master-craftsmen'),
      highlight('wood'),
      buy('sharpened-axes'),
      buy('heavy-logging'),
    ],
  },
  {
    name: 'SA→HL→RB→IE',
    actions: [
      highlight('wood'),
      buy('sharpened-axes'),
      buy('heavy-logging'),
      highlight('ale'),
      buy('royal-brewery'),
      highlight('wood'),
      buy('industrial-era'),
    ],
  },
  {
    name: 'RB→MC×1→SA→HL→IE',
    actions: [
      highlight('ale'),
      buy('royal-brewery'),
      buy('master-craftsmen'),
      highlight('wood'),
      buy('sharpened-axes'),
      buy('heavy-logging'),
      buy('industrial-era'),
    ],
  },
  {
    name: 'RB→MC×2→SA→HL→IE',
    actions: [
      highlight('ale'),
      buy('royal-brewery'),
      buy('master-craftsmen'),
      buy('master-craftsmen'),
      highlight('wood'),
      buy('sharpened-axes'),
      buy('heavy-logging'),
      buy('industrial-era'),
    ],
  },
  {
    name: 'RB only',
    actions: [highlight('ale'), buy('royal-brewery'), highlight('wood')],
  },
  {
    name: 'RB→MC×1',
    actions: [highlight('ale'), buy('royal-brewery'), buy('master-craftsmen'), highlight('wood')],
  },
]

// ─── Simulation ──────────────────────────────────────────────────────

interface SimResult {
  name: string
  score: number
  mcCount: number
  purchaseLog: { id: string; time: number }[]
  lastPurchaseSec: number
}

function createLocalInitialState(): PlayerState {
  return createInitialState(idlerDef)
}

function isActionImmediate(action: StrategyAction): boolean {
  return action.type === 'set_highlight'
}

function canAfford(state: PlayerState, action: StrategyAction): boolean {
  if (action.type === 'set_highlight') return true
  if (action.type === 'buy' && action.upgradeId) {
    const def = upgradeMap.get(action.upgradeId)
    if (!def) return false
    const costResource = def.costCurrency ?? idlerDef.scoreResource
    return (state.resources[costResource] ?? 0) >= def.cost
  }
  return false
}

function executeAction(state: PlayerState, action: StrategyAction): void {
  if (action.type === 'set_highlight' && action.highlight) {
    state.meta['highlight'] = action.highlight
  } else if (action.type === 'buy' && action.upgradeId) {
    applyPurchase(state, action.upgradeId, idlerDef)
  }
}

function simulate(strategy: Strategy): SimResult {
  const state = createLocalInitialState()
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
    mcCount: Number(state.upgrades['master-craftsmen']) || 0,
    purchaseLog,
    lastPurchaseSec,
  }
}

// ─── Output formatting ──────────────────────────────────────────────

const UPGRADE_ABBR: Record<string, string> = {
  'sharpened-axes': 'SA',
  'heavy-logging': 'HL',
  'royal-brewery': 'RB',
  'master-craftsmen': 'MC',
  'industrial-era': 'IE',
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
    '│ Strategy              Score  % Best  MC#  Purchase timeline                       │',
  )
  console.log(
    '├────────────────────────────────────────────────────────────────────────────────────┤',
  )

  for (const r of results) {
    const pct = ((r.score / bestScore) * 100).toFixed(0).padStart(3)
    const name = r.name.padEnd(20)
    const score = r.score.toFixed(0).padStart(6)
    const mcCount = String(r.mcCount).padStart(2)

    const timeline = r.purchaseLog
      .map((p) => `${UPGRADE_ABBR[p.id] ?? p.id}@${p.time.toFixed(1)}s`)
      .join(' → ')

    console.log(`│ ${name} ${score}   ${pct}%   ${mcCount}  ${timeline.padEnd(38)}│`)
  }

  console.log(
    '└────────────────────────────────────────────────────────────────────────────────────┘',
  )
}

// ─── Main ────────────────────────────────────────────────────────────

const results = STRATEGIES.map(simulate)
results.sort((a, b) => b.score - a.score)
printComparisonTable(results)
