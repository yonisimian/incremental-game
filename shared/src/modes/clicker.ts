import type { GeneratorDefinition } from '../types.js'
import type { ModeDefinition, ModeFlavor } from './types.js'
import {
  BUY_UPGRADE_SAFETY_CAP_SEC,
  CLICKER_TARGET_SCORE,
  ROUND_DURATION_SEC,
  TARGET_SCORE_SAFETY_CAP_SEC,
} from '../game-config.js'

// ─── Generators ─────────────────────────────────────────────────────────────

const clickerGenerators: readonly GeneratorDefinition[] = [
  {
    id: 'g0', // Cursor
    baseCost: 15,
    costScaling: 1.15,
    costCurrency: 'r0',
    production: { resource: 'r0', rate: 0.5 },
  },
  {
    id: 'g1', // Intern
    baseCost: 100,
    costScaling: 1.15,
    costCurrency: 'r0',
    production: { resource: 'r0', rate: 3 },
  },
  {
    id: 'g2', // Factory
    baseCost: 500,
    costScaling: 1.15,
    costCurrency: 'r0',
    production: { resource: 'r0', rate: 15 },
  },
]

// ─── Flavor ──────────────────────────────────────────────────────────

const clickerFlavor: ModeFlavor = {
  themeClass: 'theme-clicker',
  scoreLabel: 'Score',
  showClickStats: true,
  resources: [{ key: 'r0', displayName: 'Gold', icon: '💰', className: 'gold' }],
  upgrades: [
    { id: 'u0', name: 'Double Click', description: 'Each manual click gives +2 instead of +1' },
    { id: 'u1', name: 'Multiplier', description: '2x all income' },
    {
      id: 'u2',
      name: 'The Coronation',
      description: 'An ostentatious ceremony declaring you Click Monarch.',
    },
  ],
  generators: [
    { id: 'g0', name: 'Cursor', icon: '🖱️' },
    { id: 'g1', name: 'Intern', icon: '👨‍💼' },
    { id: 'g2', name: 'Factory', icon: '🏭' },
  ],
}

// ─── Mode Definition ─────────────────────────────────────────────────────────

/** Clicker mode definition — click fast, buy upgrades, outscore your opponent. */
export const clickerMode: ModeDefinition = {
  resources: ['r0'],
  scoreResource: 'r0',
  clicksEnabled: true,
  highlightEnabled: false,
  initialResources: { r0: 0 },
  initialMeta: {},
  nativeModifiers: [
    { stage: 'additive', field: 'clickIncome', value: 1 }, // base 1 per click
  ],
  upgrades: [
    {
      id: 'u0', // Double Click
      cost: 25,
      modifiers: [{ stage: 'additive', field: 'clickIncome', value: 1 }],
    },
    {
      id: 'u1', // Multiplier
      cost: 100,
      modifiers: [
        { stage: 'multiplicative', field: 'clickIncome', value: 2 },
        { stage: 'multiplicative', field: 'r0', value: 2 },
      ],
    },
    {
      id: 'u2', // The Coronation
      cost: 1000,
      goalType: 'buy-upgrade',
      modifiers: [],
    },
  ],
  generators: clickerGenerators,
  flavor: clickerFlavor,
  goals: [
    { type: 'timed', durationSec: ROUND_DURATION_SEC },
    {
      type: 'target-score',
      target: CLICKER_TARGET_SCORE,
      safetyCapSec: TARGET_SCORE_SAFETY_CAP_SEC,
    },
    { type: 'buy-upgrade', safetyCapSec: BUY_UPGRADE_SAFETY_CAP_SEC },
  ],
}
