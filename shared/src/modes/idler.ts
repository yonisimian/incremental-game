import type { Modifier } from '../modifiers/types.js'
import type { GeneratorDefinition, PlayerState, UpgradeDefinition } from '../types.js'
import type { ModeDefinition } from './types.js'
import {
  BUY_UPGRADE_SAFETY_CAP_SEC,
  IDLER_ROUND_DURATION_SEC,
  IDLER_TARGET_SCORE,
  TARGET_SCORE_SAFETY_CAP_SEC,
} from '../game-config.js'

/** Idler highlight values. */
export type IdlerHighlight = 'wood' | 'ale'

/** Get the currently highlighted resource for idler mode. */
export function getHighlight(state: Readonly<PlayerState>): IdlerHighlight {
  return (state.meta.highlight as IdlerHighlight | undefined) ?? 'wood'
}

// ─── Dynamic (state-derived) modifiers ───────────────────────────────

/**
 * Emit dynamic modifiers based on runtime player state.
 * The highlight mechanic: highlighted resource gets ×2 (or ×4 with sharpened-axes).
 */
export function collectIdlerDynamic(state: Readonly<PlayerState>): Modifier[] {
  const highlight = getHighlight(state)
  const sharpenedAxes = (state.upgrades['sharpened-axes'] ?? 0) > 0
  return [{ stage: 'multiplicative', field: highlight, value: sharpenedAxes ? 4 : 2 }]
}

// ─── Upgrades ────────────────────────────────────────────────────────

const idlerUpgrades: readonly UpgradeDefinition[] = [
  {
    id: 'sharpened-axes',
    name: '🪓 Sharpened Axes',
    cost: 30,
    costCurrency: 'wood',
    description: 'Highlight boost → 4× (from 2×)',
    modifiers: [], // meta-modifier — effect expressed in collectIdlerDynamic
  },
  {
    id: 'lumber-mill',
    name: '🏗️ Lumber Mill',
    cost: 80,
    costCurrency: 'wood',
    description: '+2 base 🪵/sec',
    modifiers: [{ stage: 'additive', field: 'wood', value: 2 }],
  },
  {
    id: 'tavern-recruits',
    name: '🍻 Tavern Recruits',
    cost: 15,
    costCurrency: 'ale',
    description: '+1 base 🪵/sec (stackable)',
    repeatable: true,
    modifiers: [{ stage: 'additive', field: 'wood', value: 1 }], // scaled by count
  },

  // ─── Tree-panel upgrades ────────────────────────────────────────────
  // Note: array order determines Q/W/E/R hotkey mapping (per UPGRADE_HOTKEYS).
  // Reordering here silently re-maps the keys.
  {
    id: 'heavy-logging',
    name: '🌲 Heavy Logging',
    cost: 25,
    costCurrency: 'wood',
    description: '+5 base 🪵/sec',
    category: 'tree',
    position: { x: 0, y: 0 },
    modifiers: [{ stage: 'additive', field: 'wood', value: 5 }],
  },
  {
    id: 'royal-brewery',
    name: '👑 Royal Brewery',
    cost: 25,
    costCurrency: 'ale',
    description: '+5 base 🍺/sec',
    category: 'tree',
    position: { x: 400, y: 0 },
    modifiers: [{ stage: 'additive', field: 'ale', value: 5 }],
  },
  {
    id: 'master-craftsmen',
    name: '👷 Master Craftsmen',
    cost: 10,
    costCurrency: 'ale',
    description: '+5 base 🪵/sec (stackable)',
    category: 'tree',
    // Offset to the right of royal-brewery so the royal→industrial line
    // doesn't visually graze this node mid-segment.
    position: { x: 500, y: 200 },
    prerequisites: ['royal-brewery'],
    repeatable: true,
    modifiers: [{ stage: 'additive', field: 'wood', value: 5 }], // scaled by count
  },
  {
    id: 'industrial-era',
    name: '⚙️ Industrial Era',
    cost: 50,
    costCurrency: 'wood',
    description: 'All production ×1.25',
    category: 'tree',
    position: { x: 200, y: 400 },
    prerequisites: ['heavy-logging', 'royal-brewery'],
    modifiers: [
      { stage: 'multiplicative', field: 'wood', value: 1.25 },
      { stage: 'multiplicative', field: 'ale', value: 1.25 },
    ],
  },

  // ─── Trophy upgrade (buy-upgrade goal only) ─────────────────────────
  {
    id: 'royal-throne',
    name: '👑 Royal Throne',
    cost: 1000,
    costCurrency: 'wood',
    description: 'Carved from the finest oak. Cements your reign.',
    goalType: 'buy-upgrade',
    modifiers: [],
  },
]

// ─── Generators ──────────────────────────────────────────────────────────────

const idlerGenerators: readonly GeneratorDefinition[] = [
  {
    id: 'woodcutter',
    name: 'Woodcutter',
    icon: '🪓',
    baseCost: 10,
    costScaling: 1.15,
    costCurrency: 'wood',
    costIcon: '🪵',
    production: { resource: 'wood', rate: 0.2 },
  },
  {
    id: 'brewer',
    name: 'Brewer',
    icon: '🍺',
    baseCost: 10,
    costScaling: 1.15,
    costCurrency: 'ale',
    costIcon: '🍺',
    production: { resource: 'ale', rate: 0.2 },
  },
  {
    id: 'sawmill',
    name: 'Sawmill',
    icon: '🏗️',
    baseCost: 50,
    costScaling: 1.15,
    costCurrency: 'ale',
    costIcon: '🍺',
    production: { resource: 'wood', rate: 1 },
  },
  {
    id: 'tavern',
    name: 'Tavern',
    icon: '🍻',
    baseCost: 50,
    costScaling: 1.15,
    costCurrency: 'wood',
    costIcon: '🪵',
    production: { resource: 'ale', rate: 1 },
  },
]

// ─── Mode Definition ─────────────────────────────────────────────────

/** Idler mode definition — passive income only, pure upgrade strategy. */
export const idlerMode: ModeDefinition = {
  resources: ['wood', 'ale'],
  scoreResource: 'wood',
  clicksEnabled: false,
  initialResources: { wood: 0, ale: 0 },
  initialMeta: { highlight: 'wood' },
  collectDynamic: collectIdlerDynamic,
  nativeModifiers: [
    { stage: 'additive', field: 'wood', value: 1 }, // base 1 wood/s
    { stage: 'additive', field: 'ale', value: 1 }, // base 1 ale/s
  ],
  upgrades: idlerUpgrades,
  generators: idlerGenerators,
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
