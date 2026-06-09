import type { Modifier } from '../modifiers/types.js'
import type { GeneratorDefinition, PlayerState, UpgradeDefinition } from '../types.js'
import type { ModeDefinition, ModeFlavor } from './types.js'
import {
  BUY_UPGRADE_SAFETY_CAP_SEC,
  IDLER_ROUND_DURATION_SEC,
  IDLER_TARGET_SCORE,
  TARGET_SCORE_SAFETY_CAP_SEC,
} from '../game-config.js'

/** Get the currently highlighted resource for idler mode. */
function getHighlight(state: Readonly<PlayerState>): string {
  return (state.meta.highlight as string | undefined) ?? 'r0'
}

// ─── Dynamic (state-derived) modifiers ───────────────────────────────

/** Upgrade ID that gates the highlight mechanic. Must match `highlightUnlockUpgrade` below. */
const HIGHLIGHT_UNLOCK = 'uh'

/**
 * Emit dynamic modifiers based on runtime player state.
 * The highlight mechanic: highlighted resource gets ×2.
 * Requires the unlock-highlight upgrade to be purchased before taking effect.
 */
function collectIdlerDynamic(state: Readonly<PlayerState>): Modifier[] {
  if ((state.upgrades[HIGHLIGHT_UNLOCK] ?? 0) === 0) return []
  const highlight = getHighlight(state)
  return [{ stage: 'multiplicative', field: highlight, value: 2 }]
}

// ─── Upgrades ────────────────────────────────────────────────────────
//
// Phase 0 (data-driven tree master plan): the proof-of-concept tree was wiped to
// a minimal functional stub. Kept just enough to keep the mode playable while the
// real, data-driven tree is authored in later phases:
//   - uh: unlocks the highlight mechanic (mode-level dynamic, see collectIdlerDynamic)
//   - u1: a single static production upgrade (a buy target for bots/tests)
//   - u5: the buy-upgrade trophy (so the default Race-to-Buy goal is winnable)
// All per-upgrade dynamic-modifier closures were removed; they return as data-driven
// effects in Phase 2.

const idlerUpgrades: readonly UpgradeDefinition[] = [
  {
    id: 'uh', // Unlock Highlight
    cost: 5,
    costCurrency: 'r0',
    purchaseLimit: 1,
    category: 'tree',
    position: { x: 0, y: 0 },
    modifiers: [], // unlocks the highlight mechanic (checked in collectIdlerDynamic)
  },
  {
    id: 'u1', // Heavy Logging
    cost: 25,
    costCurrency: 'r0',
    purchaseLimit: 1,
    category: 'tree',
    position: { x: 200, y: 0 },
    modifiers: [{ stage: 'additive', field: 'r0', value: 5 }],
  },

  // ─── Trophy upgrade (buy-upgrade goal only) ─────────────────────────
  {
    id: 'u5', // Royal Throne
    cost: 30000,
    costCurrency: 'r0',
    purchaseLimit: 1,
    goalType: 'buy-upgrade',
    category: 'tree',
    position: { x: 600, y: 0 },
    modifiers: [],
  },
]

// ─── Generators ──────────────────────────────────────────────────────────────

const idlerGenerators: readonly GeneratorDefinition[] = [
  {
    id: 'g0', // Woodcutter
    baseCost: 10,
    costScaling: 1.15,
    costCurrency: 'r1',
    production: { resource: 'r0', rate: 0.5 },
  },
  {
    id: 'g1', // Brewer
    baseCost: 10,
    costScaling: 1.15,
    costCurrency: 'r1',
    production: { resource: 'r1', rate: 1 },
  },
  {
    id: 'g2', // Sawmill
    baseCost: 50,
    costScaling: 1.2,
    costCurrency: 'r1',
    production: { resource: 'r0', rate: 5 },
  },
  {
    id: 'g3', // Taverns
    baseCost: 600,
    costScaling: 1.5,
    costCurrency: 'r0',
    production: { resource: 'r1', rate: 10 },
  },
]

// ─── Flavor ──────────────────────────────────────────────────────────

const idlerFlavor: ModeFlavor = {
  displayName: 'Idler',
  themeClass: 'theme-medieval',
  scoreLabel: 'Total',
  showClickStats: false,
  resources: [
    { key: 'r0', displayName: 'Wood', icon: '🪵' },
    { key: 'r1', displayName: 'Ale', icon: '🍺' },
  ],
  upgrades: [
    {
      id: 'uh',
      name: '🔦 Focus Training',
      icon: '🔦',
      description: 'Unlock highlighting (×2 to selected resource)',
    },
    { id: 'u1', name: '🌲 Heavy Logging', icon: '🌲', description: '+5 base 🪵/sec' },
    {
      id: 'u5',
      name: '👑 Royal Throne',
      icon: '👑',
      description: 'Carved from the finest oak. Cements your reign.',
    },
  ],
  generators: [
    { id: 'g0', name: 'Woodcutter', icon: '🪓' },
    { id: 'g1', name: 'Brewer', icon: '🍺' },
    { id: 'g2', name: 'Sawmill', icon: '🏗️' },
    { id: 'g3', name: 'Tavern', icon: '🍻' },
  ],
}

// ─── Mode Definition ─────────────────────────────────────────────────

/** Idler mode definition — passive income only, pure upgrade strategy. */
export const idlerMode: ModeDefinition = {
  resources: ['r0', 'r1'],
  scoreResource: 'r0',
  clicksEnabled: false,
  highlightEnabled: true,
  highlightUnlockUpgrade: HIGHLIGHT_UNLOCK,
  initialResources: { r0: 0, r1: 0 },
  initialMeta: { highlight: 'r0' },
  collectDynamic: collectIdlerDynamic,
  nativeModifiers: [
    { stage: 'additive', field: 'r0', value: 1 }, // base 1 wood/s
    { stage: 'additive', field: 'r1', value: 1 }, // base 1 ale/s
  ],
  upgrades: idlerUpgrades,
  generators: idlerGenerators,
  flavor: idlerFlavor,
  goals: [
    { type: 'buy-upgrade', label: '🏆 Race to Buy', safetyCapSec: BUY_UPGRADE_SAFETY_CAP_SEC },
    {
      type: 'target-score',
      label: '🎯 Race to Score',
      target: IDLER_TARGET_SCORE,
      safetyCapSec: TARGET_SCORE_SAFETY_CAP_SEC,
    },
    { type: 'timed', label: '⏱ Timed', durationSec: IDLER_ROUND_DURATION_SEC },
  ],
}
