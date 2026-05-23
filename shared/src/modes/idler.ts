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

/**
 * Emit dynamic modifiers based on runtime player state.
 * The highlight mechanic: highlighted resource gets ×2 (or ×4 with u0 / sharpened-axes).
 */
function collectIdlerDynamic(state: Readonly<PlayerState>): Modifier[] {
  const highlight = getHighlight(state)
  const sharpenedAxes = state.upgrades.u0 > 0
  return [{ stage: 'multiplicative', field: highlight, value: sharpenedAxes ? 4 : 2 }]
}

// ─── Upgrades ────────────────────────────────────────────────────────

const idlerUpgrades: readonly UpgradeDefinition[] = [
  {
    id: 'u0', // Sharpened Axes
    cost: 15,
    costCurrency: 'r0',
    purchaseLimit: 1,
    category: 'tree',
    position: { x: 0, y: 0 },
    modifiers: [], // meta-modifier — effect expressed in collectIdlerDynamic
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
  {
    id: 'u2', // Royal Brewery
    cost: 10,
    costCurrency: 'r1',
    purchaseLimit: 1,
    category: 'tree',
    position: { x: 400, y: 0 },
    modifiers: [{ stage: 'additive', field: 'r1', value: 5 }],
  },
  {
    id: 'u4', // Industrial Era
    cost: 600,
    costCurrency: 'r0',
    purchaseLimit: 1,
    category: 'tree',
    position: { x: 300, y: 300 },
    prerequisites: {
      type: 'any',
      items: [
        { type: 'upgrade', id: 'u6' },
        { type: 'upgrade', id: 'u7' },
      ],
    },
    modifiers: [
      { stage: 'multiplicative', field: 'r0', value: 1.25 },
      { stage: 'multiplicative', field: 'r1', value: 1.25 },
    ],
  },
  {
    id: 'u6', // Skilled Foremen
    cost: 200,
    costCurrency: 'r0',
    purchaseLimit: 1,
    category: 'tree',
    position: { x: 200, y: 150 },
    prerequisites: { type: 'all', items: [{ type: 'upgrade', id: 'u1' }] },
    // +4 wood/sec per owned Woodcutter (generator-targeted additive)
    modifiers: [{ stage: 'additive', field: 'g0', value: 4 }],
  },
  {
    id: 'u7', // Yeast Cultivators
    cost: 180,
    costCurrency: 'r0',
    purchaseLimit: 1,
    category: 'tree',
    position: { x: 400, y: 150 },
    prerequisites: { type: 'all', items: [{ type: 'upgrade', id: 'u2' }] },
    // ×2 total Brewer output (generator-targeted multiplicative)
    modifiers: [{ stage: 'multiplicative', field: 'g1', value: 2 }],
  },
  {
    id: 'u8', // Resource Hoarders
    cost: 240,
    costCurrency: 'r0',
    purchaseLimit: 1,
    category: 'tree',
    position: { x: 100, y: 300 },
    prerequisites: { type: 'all', items: [{ type: 'upgrade', id: 'u6' }] },
    modifiers: [],
    dynamicModifier: (state) => {
      const bonus = Math.min(state.resources.r0 * 0.001, 1)
      return bonus > 0 ? { stage: 'multiplicative', field: 'r0', value: 1 + bonus } : null
    },
  },
  {
    id: 'u9', // Cellar Masters
    cost: 100,
    costCurrency: 'r1',
    purchaseLimit: 1,
    category: 'tree',
    position: { x: 500, y: 300 },
    prerequisites: { type: 'all', items: [{ type: 'upgrade', id: 'u7' }] },
    modifiers: [],
    dynamicModifier: (state) => {
      const bonus = Math.min(state.resources.r1 * 0.001, 1)
      return bonus > 0 ? { stage: 'multiplicative', field: 'r1', value: 1 + bonus } : null
    },
  },
  {
    id: 'u10', // Dominant Harvesters
    cost: 600,
    costCurrency: 'r0',
    purchaseLimit: 1,
    category: 'tree',
    position: { x: 200, y: 450 },
    prerequisites: { type: 'all', items: [{ type: 'upgrade', id: 'u4' }] },
    choiceGroup: 'generator-count',
    modifiers: [],
    dynamicModifier: (state) => {
      const generatorIds = ['g0', 'g1', 'g2', 'g3'] as const
      let winner: (typeof generatorIds)[number] = 'g0'
      let maxCount = state.generators[winner] ?? 0
      for (const id of generatorIds) {
        const count = state.generators[id] ?? 0
        if (count > maxCount) {
          maxCount = count
          winner = id
        }
      }
      return maxCount > 0 ? { stage: 'multiplicative', field: winner, value: 2 } : null
    },
  },
  {
    id: 'u11', // Balanced Engineering
    cost: 400,
    costCurrency: 'r0',
    purchaseLimit: 1,
    category: 'tree',
    position: { x: 400, y: 450 },
    prerequisites: { type: 'all', items: [{ type: 'upgrade', id: 'u4' }] },
    choiceGroup: 'generator-count',
    modifiers: [],
    dynamicModifier: (state) => {
      const generatorIds = ['g0', 'g1', 'g2', 'g3'] as const
      const counts = generatorIds.map((id) => state.generators[id] ?? 0)
      const avg = counts.reduce((sum, c) => sum + c, 0) / counts.length
      if (avg <= 0) return null
      const deviation = counts.reduce((sum, c) => sum + Math.abs(c - avg), 0) / counts.length
      const balanceRatio = Math.max(0, 1 - deviation / avg)
      const bonus = 1 + balanceRatio * 0.25
      return { stage: 'multiplicative', field: 'globalMultiplier', value: bonus }
    },
  },

  {
    id: 'u12', // Time-Based Multiplier
    cost: 800,
    costCurrency: 'r0',
    purchaseLimit: 1,
    category: 'tree',
    position: { x: 0, y: 150 },
    modifiers: [],
    dynamicModifier: (state) => {
      const purchasedAt = state.meta.purchasedAt as Record<string, number> | undefined
      const t0 = purchasedAt?.u12
      const now = state.meta.gameSec as number | undefined
      if (t0 === undefined || now === undefined) return null
      const elapsed = now - t0
      const multiplier = Math.min(1 + (1 / 60) * elapsed, 10)
      return { stage: 'multiplicative', field: 'globalMultiplier', value: multiplier }
    },
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
    { id: 'u0', name: '🪓 Sharpened Axes', description: 'Highlight boost → 4× (from 2×)' },
    { id: 'u1', name: '🌲 Heavy Logging', description: '+5 base 🪵/sec' },
    { id: 'u2', name: '👑 Royal Brewery', description: '+5 base 🍺/sec' },
    { id: 'u4', name: '⚙️ Industrial Era', description: 'All production ×1.25' },
    {
      id: 'u6',
      name: '👥 Skilled Foremen',
      description: 'Each Woodcutter produces +4 additional 🪵/sec',
    },
    { id: 'u7', name: '🍺 Yeast Cultivators', description: 'All Brewers produce ×2 🍺' },
    {
      id: 'u8',
      name: '💰 Resource Hoarders',
      description: '+0.1% 🪵 production per banked 🪵',
    },
    {
      id: 'u9',
      name: '🧊 Cellar Masters',
      description: '+0.1% 🍺 production per banked 🍺',
    },
    {
      id: 'u10',
      name: '🌾 Dominant Harvesters',
      description: 'Your most-owned generator gets ×2 output',
    },
    {
      id: 'u11',
      name: '⚖️ Balanced Engineering',
      description: 'Up to +25% all production when all 4 generator counts are even',
    },
    {
      id: 'u12',
      name: '⏳ Time Investment',
      description: 'All production grows over time (up to ×10, +1/60 per sec)',
    },
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
    { type: 'timed', label: '⏱ Timed', durationSec: IDLER_ROUND_DURATION_SEC },
    {
      type: 'target-score',
      label: '🎯 Race to Score',
      target: IDLER_TARGET_SCORE,
      safetyCapSec: TARGET_SCORE_SAFETY_CAP_SEC,
    },
    { type: 'buy-upgrade', label: '🏆 Race to Buy', safetyCapSec: BUY_UPGRADE_SAFETY_CAP_SEC },
  ],
}
