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
export function getHighlight(state: Readonly<PlayerState>): string {
  return (state.meta.highlight as string | undefined) ?? 'r0'
}

// ─── Dynamic (state-derived) modifiers ───────────────────────────────

/**
 * Emit dynamic modifiers based on runtime player state.
 * The highlight mechanic: highlighted resource gets ×2 (or ×4 with u0 / sharpened-axes).
 */
export function collectIdlerDynamic(state: Readonly<PlayerState>): Modifier[] {
  const highlight = getHighlight(state)
  const sharpenedAxes = state.upgrades.u0 > 0
  return [{ stage: 'multiplicative', field: highlight, value: sharpenedAxes ? 4 : 2 }]
}

// ─── Upgrades ────────────────────────────────────────────────────────

const idlerUpgrades: readonly UpgradeDefinition[] = [
  {
    id: 'u0', // Sharpened Axes
    cost: 30,
    costCurrency: 'r0',
    category: 'tree',
    position: { x: 200, y: 0 },
    modifiers: [], // meta-modifier — effect expressed in collectIdlerDynamic
  },
  {
    id: 'u1', // Heavy Logging
    cost: 25,
    costCurrency: 'r0',
    category: 'tree',
    position: { x: 0, y: 0 },
    modifiers: [{ stage: 'additive', field: 'r0', value: 5 }],
  },
  {
    id: 'u2', // Royal Brewery
    cost: 25,
    costCurrency: 'r1',
    category: 'tree',
    position: { x: 400, y: 0 },
    modifiers: [{ stage: 'additive', field: 'r1', value: 5 }],
  },
  {
    id: 'u3', // Master Craftsmen
    cost: 10,
    costCurrency: 'r1',
    category: 'tree',
    position: { x: 500, y: 200 },
    prerequisites: ['u2'],
    repeatable: true,
    modifiers: [{ stage: 'additive', field: 'r0', value: 5 }], // scaled by count
  },
  {
    id: 'u4', // Industrial Era
    cost: 50,
    costCurrency: 'r0',
    category: 'tree',
    position: { x: 200, y: 400 },
    prerequisites: ['u1', 'u0', 'u2'],
    modifiers: [
      { stage: 'multiplicative', field: 'r0', value: 1.25 },
      { stage: 'multiplicative', field: 'r1', value: 1.25 },
    ],
  },

  // ─── Trophy upgrade (buy-upgrade goal only) ─────────────────────────
  {
    id: 'u5', // Royal Throne
    cost: 1000,
    costCurrency: 'r0',
    goalType: 'buy-upgrade',
    modifiers: [],
  },
]

// ─── Generators ──────────────────────────────────────────────────────────────

const idlerGenerators: readonly GeneratorDefinition[] = [
  {
    id: 'g0', // Woodcutter
    baseCost: 10,
    costScaling: 1.15,
    costCurrency: 'r0',
    production: { resource: 'r0', rate: 0.2 },
  },
  {
    id: 'g1', // Brewer
    baseCost: 10,
    costScaling: 1.15,
    costCurrency: 'r1',
    production: { resource: 'r1', rate: 0.2 },
  },
  {
    id: 'g2', // Sawmill
    baseCost: 50,
    costScaling: 1.15,
    costCurrency: 'r1',
    production: { resource: 'r0', rate: 1 },
  },
  {
    id: 'g3', // Tavern
    baseCost: 50,
    costScaling: 1.15,
    costCurrency: 'r0',
    production: { resource: 'r1', rate: 1 },
  },
]

// ─── Flavor ──────────────────────────────────────────────────────────

const idlerFlavor: ModeFlavor = {
  themeClass: 'theme-medieval',
  scoreLabel: 'Total',
  showClickStats: false,
  resources: [
    { key: 'r0', displayName: 'Wood', icon: '🪵' },
    { key: 'r1', displayName: 'Ale', icon: '🍺' },
  ],
  upgrades: [
    { id: 'u0', name: '🪓 Sharpened Axes', description: 'Highlight boost → 4× (from 2×)' },
    { id: 'u1', name: '🌲 Heavy Logging', description: '+5 base 🪵/sec' },
    { id: 'u2', name: '👑 Royal Brewery', description: '+5 base 🍺/sec' },
    { id: 'u3', name: '👷 Master Craftsmen', description: '+5 base 🪵/sec (stackable)' },
    { id: 'u4', name: '⚙️ Industrial Era', description: 'All production ×1.25' },
    {
      id: 'u5',
      name: '👑 Royal Throne',
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
    { type: 'timed', durationSec: IDLER_ROUND_DURATION_SEC },
    {
      type: 'target-score',
      target: IDLER_TARGET_SCORE,
      safetyCapSec: TARGET_SCORE_SAFETY_CAP_SEC,
    },
    { type: 'buy-upgrade', safetyCapSec: BUY_UPGRADE_SAFETY_CAP_SEC },
  ],
}
