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
  const mods: Modifier[] = []
  const sharpenedAxes = state.upgrades.u0 > 0
  mods.push({ stage: 'multiplicative', field: highlight, value: sharpenedAxes ? 4 : 2 })

  // u8: provide a small multiplicative bonus to Wood based on hoarded Wood
  if (state.upgrades.u8 > 0) {
    const bonus = Math.floor(state.resources.r0 / 10) * 0.01
    if (bonus > 0) mods.push({ stage: 'multiplicative', field: 'r0', value: 1 + bonus })
  }

  // u9: provide a small multiplicative bonus to Ale based on hoarded Ale
  if (state.upgrades.u9 > 0) {
    const bonus = Math.floor(state.resources.r1 / 10) * 0.01
    if (bonus > 0) mods.push({ stage: 'multiplicative', field: 'r1', value: 1 + bonus })
  }

  // u10: Dominant Harvesters — apply ×2 to one top generator (lowest-tier wins ties)
  if (state.upgrades.u10 > 0) {
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
    if (maxCount > 0) mods.push({ stage: 'multiplicative', field: winner, value: 2 })
  }

  // u11: Balanced Engineering — global bonus from generator count balance
  if (state.upgrades.u11 > 0) {
    const generatorIds = ['g0', 'g1', 'g2', 'g3'] as const
    const counts = generatorIds.map((id) => state.generators[id] ?? 0)
    const avg = counts.reduce((sum, count) => sum + count, 0) / counts.length
    if (avg > 0) {
      const deviation =
        counts.reduce((sum, count) => sum + Math.abs(count - avg), 0) / counts.length
      const balanceRatio = Math.max(0, 1 - deviation / avg)
      const globalBonus = 1 + balanceRatio * 0.25
      mods.push({ stage: 'multiplicative', field: 'globalMultiplier', value: globalBonus })
    }
  }

  return mods
}

// ─── Upgrades ────────────────────────────────────────────────────────

const idlerUpgrades: readonly UpgradeDefinition[] = [
  {
    id: 'u0', // Sharpened Axes
    cost: 30,
    costCurrency: 'r0',
    maxLevel: 1,
    category: 'tree',
    position: { x: 200, y: 0 },
    modifiers: [], // meta-modifier — effect expressed in collectIdlerDynamic
  },
  {
    id: 'u1', // Heavy Logging
    cost: 25,
    costCurrency: 'r0',
    maxLevel: 1,
    category: 'tree',
    position: { x: 0, y: 0 },
    modifiers: [{ stage: 'additive', field: 'r0', value: 5 }],
  },
  {
    id: 'u2', // Royal Brewery
    cost: 25,
    costCurrency: 'r1',
    maxLevel: 1,
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
    modifiers: [{ stage: 'additive', field: 'r0', value: 5 }], // scaled by count
  },
  {
    id: 'u4', // Industrial Era
    cost: 50,
    costCurrency: 'r0',
    maxLevel: 1,
    category: 'tree',
    position: { x: 200, y: 400 },
    prerequisites: ['u1', 'u0', 'u2'],
    modifiers: [
      { stage: 'multiplicative', field: 'r0', value: 1.25 },
      { stage: 'multiplicative', field: 'r1', value: 1.25 },
    ],
  },
  {
    id: 'u6', // Skilled Foremen
    cost: 60,
    costCurrency: 'r0',
    maxLevel: 1,
    category: 'tree',
    position: { x: 0, y: 500 },
    prerequisites: ['u1'],
    modifiers: [{ stage: 'additive', field: 'g0', value: 4 }],
  },
  {
    id: 'u7', // Yeast Cultivators
    cost: 60,
    costCurrency: 'r1',
    maxLevel: 1,
    category: 'tree',
    position: { x: 400, y: 500 },
    prerequisites: ['u2'],
    modifiers: [{ stage: 'multiplicative', field: 'g1', value: 2 }],
  },

  {
    id: 'u8', // Resource Hoarders
    cost: 40,
    costCurrency: 'r0',
    maxLevel: 1,
    category: 'tree',
    position: { x: 150, y: 500 },
    prerequisites: ['u1'],
    modifiers: [], // dynamic: bonus based on banked r0 (handled in collectIdlerDynamic)
  },
  {
    id: 'u9', // Cellar Masters
    cost: 40,
    costCurrency: 'r1',
    maxLevel: 1,
    category: 'tree',
    position: { x: 350, y: 500 },
    prerequisites: ['u2'],
    modifiers: [], // dynamic: bonus based on banked r1 (handled in collectIdlerDynamic)
  },
  {
    id: 'u10', // Dominant Harvesters
    cost: 80,
    costCurrency: 'r0',
    maxLevel: 1,
    category: 'tree',
    position: { x: 200, y: 400 },
    modifiers: [], // dynamic: chooses one top generator for ×2
  },
  {
    id: 'u11', // Balanced Engineering
    cost: 80,
    costCurrency: 'r1',
    maxLevel: 1,
    category: 'tree',
    position: { x: 300, y: 400 },
    modifiers: [], // dynamic: global bonus from generator balance
  },

  // ─── Trophy upgrade (buy-upgrade goal only) ─────────────────────────
  {
    id: 'u5', // Royal Throne
    cost: 1000,
    costCurrency: 'r0',
    maxLevel: 1,
    goalType: 'buy-upgrade',
    category: 'tree',
    position: { x: 200, y: 600 },
    prerequisites: ['u4'],
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
    production: { resource: 'r0', rate: 1 },
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
    { id: 'u3', name: '👷 Master Craftsmen', description: '+5 base 🪵/sec (stackable)' },
    { id: 'u4', name: '⚙️ Industrial Era', description: 'All production ×1.25' },
    {
      id: 'u6',
      name: '👥 Skilled Foremen',
      description: '+4 woodcutter output per owned Woodcutter',
    },
    { id: 'u7', name: '🍺 Yeast Cultivators', description: 'Brewers produce 100% more Ale' },
    {
      id: 'u8',
      name: '💰 Resource Hoarders',
      description: 'More Wood in bank → small production bonus',
    },
    {
      id: 'u9',
      name: '🧊 Cellar Masters',
      description: 'More Ale in bank → small production bonus',
    },
    {
      id: 'u10',
      name: '🌾 Dominant Harvesters',
      description: 'The strongest generator gains ×2 output (lower-tier wins ties).',
    },
    {
      id: 'u11',
      name: '⚖️ Balanced Engineering',
      description: 'All production gets a bonus when generator counts are balanced.',
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
