/**
 * Idler Balance Simulation Script
 *
 * Automates upgrade chain traces for every meaningful idler strategy.
 * Outputs a comparison table and timeline compliance report.
 *
 * Run: pnpm sim:idler
 * Prereq: pnpm --filter @game/shared build
 */

import {
  IDLER_UPGRADES,
  INITIAL_PLAYER_STATE,
  ROUND_DURATION_SEC,
  TICK_INTERVAL_MS,
  applyIdlerPassiveIncome,
  applyIdlerPurchase,
} from '@game/shared';
import type {
  CurrencyHighlight,
  PlayerState,
  UpgradeId,
} from '@game/shared';

// ─── Strategy types ──────────────────────────────────────────────────

interface StrategyAction {
  type: 'buy' | 'set_highlight';
  upgradeId?: UpgradeId;
  highlight?: CurrencyHighlight;
}

interface Strategy {
  name: string;
  actions: StrategyAction[];
}

// ─── Helpers ─────────────────────────────────────────────────────────

const buy = (upgradeId: UpgradeId): StrategyAction => ({
  type: 'buy',
  upgradeId,
});

const highlight = (h: CurrencyHighlight): StrategyAction => ({
  type: 'set_highlight',
  highlight: h,
});

// ─── Upgrade lookup (for affordability checks) ──────────────────────

const upgradeMap = new Map(IDLER_UPGRADES.map((u) => [u.id, u]));

// ─── Strategies ──────────────────────────────────────────────────────

const STRATEGIES: Strategy[] = [
  {
    name: 'All-In (TR→SA→LM)',
    actions: [
      highlight('ale'), buy('tavern-recruits'),
      highlight('wood'), buy('sharpened-axes'), buy('lumber-mill'),
    ],
  },
  {
    name: 'Skip TR (SA→LM)',
    actions: [
      highlight('wood'), buy('sharpened-axes'), buy('lumber-mill'),
    ],
  },
  {
    name: 'Skip LM (TR→SA)',
    actions: [
      highlight('ale'), buy('tavern-recruits'),
      highlight('wood'), buy('sharpened-axes'),
    ],
  },
  {
    name: 'SA only',
    actions: [highlight('wood'), buy('sharpened-axes')],
  },
  {
    name: 'TR only',
    actions: [highlight('ale'), buy('tavern-recruits'), highlight('wood')],
  },
  {
    name: 'No upgrades',
    actions: [highlight('wood')],
  },
  {
    name: 'All-In + LC (ale rush)',
    actions: [
      highlight('ale'), buy('tavern-recruits'),
      highlight('wood'), buy('sharpened-axes'), buy('lumber-mill'),
      highlight('ale'), buy('liquid-courage'), highlight('wood'),
    ],
  },
  {
    name: 'All-In + LC (passive ale)',
    actions: [
      highlight('ale'), buy('tavern-recruits'),
      highlight('wood'), buy('sharpened-axes'), buy('lumber-mill'),
      buy('liquid-courage'),
    ],
  },
  {
    name: 'TR→SA→LC (skip LM)',
    actions: [
      highlight('ale'), buy('tavern-recruits'),
      highlight('wood'), buy('sharpened-axes'),
      highlight('ale'), buy('liquid-courage'), highlight('wood'),
    ],
  },
  {
    name: 'SA-first (SA→TR→LM)',
    actions: [
      highlight('wood'), buy('sharpened-axes'),
      highlight('ale'), buy('tavern-recruits'),
      highlight('wood'), buy('lumber-mill'),
    ],
  },
];

// ─── Simulation ──────────────────────────────────────────────────────

interface SimResult {
  name: string;
  score: number;
  purchaseTimes: Record<string, number | null>; // upgradeId → second, or null
  idleFrom: number; // second of last purchase
}

function createInitialState(): PlayerState {
  return {
    score: INITIAL_PLAYER_STATE.score,
    currency: INITIAL_PLAYER_STATE.currency,
    upgrades: { ...INITIAL_PLAYER_STATE.upgrades },
    wood: 0,
    ale: 0,
    highlight: 'wood',
  };
}

function isActionImmediate(action: StrategyAction): boolean {
  return action.type === 'set_highlight';
}

function canAfford(state: PlayerState, action: StrategyAction): boolean {
  if (action.type === 'set_highlight') return true;
  if (action.type === 'buy' && action.upgradeId) {
    const def = upgradeMap.get(action.upgradeId);
    if (!def) return false;
    if (def.costCurrency === 'wood') return (state.wood ?? 0) >= def.cost;
    if (def.costCurrency === 'ale') return (state.ale ?? 0) >= def.cost;
    return state.currency >= def.cost;
  }
  return false;
}

function executeAction(state: PlayerState, action: StrategyAction): void {
  if (action.type === 'set_highlight' && action.highlight) {
    state.highlight = action.highlight;
  } else if (action.type === 'buy' && action.upgradeId) {
    applyIdlerPurchase(state, action.upgradeId);
  }
}

function simulate(strategy: Strategy): SimResult {
  const state = createInitialState();
  const tickSec = TICK_INTERVAL_MS / 1000;
  const totalTicks = (ROUND_DURATION_SEC * 1000) / TICK_INTERVAL_MS;

  const purchaseTimes: Record<string, number | null> = {
    'tavern-recruits': null,
    'sharpened-axes': null,
    'lumber-mill': null,
    'liquid-courage': null,
  };
  let actionIndex = 0;
  let lastPurchaseSec = 0;

  // Pre-loop: drain immediate (zero-cost) actions before any income
  while (
    actionIndex < strategy.actions.length &&
    isActionImmediate(strategy.actions[actionIndex])
  ) {
    executeAction(state, strategy.actions[actionIndex]);
    actionIndex++;
  }

  // Main simulation loop
  for (let tick = 0; tick < totalTicks; tick++) {
    const currentSec = (tick + 1) * tickSec; // time after this tick

    // Step 1: passive income
    applyIdlerPassiveIncome(state, tickSec);

    // Step 2: execute ready actions (may be multiple per tick)
    while (
      actionIndex < strategy.actions.length &&
      canAfford(state, strategy.actions[actionIndex])
    ) {
      const action = strategy.actions[actionIndex];
      executeAction(state, action);

      if (action.type === 'buy' && action.upgradeId) {
        purchaseTimes[action.upgradeId] = currentSec;
        lastPurchaseSec = currentSec;
      }

      actionIndex++;
    }
  }

  return {
    name: strategy.name,
    score: Math.round(state.score * 100) / 100, // avoid float noise
    purchaseTimes,
    idleFrom: lastPurchaseSec,
  };
}

// ─── Output formatting ──────────────────────────────────────────────

function formatTime(sec: number | null): string {
  if (sec === null) return '  —  ';
  return `${sec.toFixed(1)}s`.padStart(5);
}

function printComparisonTable(results: SimResult[]): void {
  const bestScore = Math.max(...results.map((r) => r.score));

  console.log('\n┌─────────────────────────────────────────────────────────────────────────────────────┐');
  console.log('│                           STRATEGY COMPARISON TABLE                                │');
  console.log('├─────────────────────────────────────────────────────────────────────────────────────┤');
  console.log('│ Strategy                    Score  % Best   TR @    SA @    LM @    LC @  Idle from │');
  console.log('├─────────────────────────────────────────────────────────────────────────────────────┤');

  for (const r of results) {
    const pct = ((r.score / bestScore) * 100).toFixed(0).padStart(3);
    const name = r.name.padEnd(25);
    const score = r.score.toFixed(0).padStart(6);
    const tr = formatTime(r.purchaseTimes['tavern-recruits']);
    const sa = formatTime(r.purchaseTimes['sharpened-axes']);
    const lm = formatTime(r.purchaseTimes['lumber-mill']);
    const lc = formatTime(r.purchaseTimes['liquid-courage']);
    const idle = r.idleFrom > 0 ? `${r.idleFrom.toFixed(1)}s`.padStart(5) : '  0.0s';
    console.log(`│ ${name} ${score}   ${pct}%  ${tr}   ${sa}   ${lm}   ${lc}    ${idle} │`);
  }

  console.log('└─────────────────────────────────────────────────────────────────────────────────────┘');
}

// ─── Timeline compliance ────────────────────────────────────────────

interface PhaseCheck {
  label: string;
  start: number;
  end: number;
}

const PHASES: PhaseCheck[] = [
  { label: '0–12s  Accumulation', start: 0, end: 12 },
  { label: '12–30s Mid-game', start: 12, end: 30 },
  { label: '30–50s Execution', start: 30, end: 50 },
  { label: '50–60s Sprint', start: 50, end: 60 },
];

function printTimelineCompliance(results: SimResult[]): void {
  console.log('\n┌─────────────────────────────────────────────────────────────────────────────────────┐');
  console.log('│                           TIMELINE COMPLIANCE                                      │');
  console.log('└─────────────────────────────────────────────────────────────────────────────────────┘');

  for (const r of results) {
    console.log(`\n  Strategy: ${r.name}`);

    const allPurchases = Object.entries(r.purchaseTimes)
      .filter(([, t]) => t !== null)
      .map(([id, t]) => ({ id, time: t as number }))
      .sort((a, b) => a.time - b.time);

    for (const phase of PHASES) {
      const inPhase = allPurchases.filter(
        (p) => p.time >= phase.start && p.time < phase.end,
      );

      const upgradeNames: Record<string, string> = {
        'tavern-recruits': 'TR',
        'sharpened-axes': 'SA',
        'lumber-mill': 'LM',
        'liquid-courage': 'LC',
      };

      let status: string;
      let detail: string;

      if (phase.label.includes('Accumulation')) {
        // Target: first buy between 8–15s
        const firstBuy = allPurchases[0];
        if (!firstBuy) {
          status = '⚠️';
          detail = 'No purchases in entire round';
        } else if (firstBuy.time < 8) {
          status = '⚠️';
          detail = `First buy at ${firstBuy.time.toFixed(1)}s (target: 8–15s)`;
        } else if (firstBuy.time <= 15) {
          status = '✅';
          detail = `First buy at ${firstBuy.time.toFixed(1)}s`;
        } else {
          status = '❌';
          detail = `First buy at ${firstBuy.time.toFixed(1)}s (too late, target: 8–15s)`;
        }
      } else if (inPhase.length > 0) {
        status = '✅';
        detail = inPhase
          .map((p) => `${upgradeNames[p.id] ?? p.id} at ${p.time.toFixed(1)}s`)
          .join(', ');
      } else if (r.idleFrom < phase.start) {
        status = '❌';
        detail = `No purchases (idle from ${r.idleFrom.toFixed(1)}s)`;
      } else {
        status = '⚠️';
        detail = 'No purchases';
      }

      console.log(`    ${phase.label}:  ${status} ${detail}`);
    }
  }
  console.log('');
}

// ─── Main ────────────────────────────────────────────────────────────

const results = STRATEGIES.map(simulate);
printComparisonTable(results);
printTimelineCompliance(results);
