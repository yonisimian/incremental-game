import type { ModeDefinition } from './types.js'
import {
  CLICKER_TARGET_SCORE,
  ROUND_DURATION_SEC,
  TARGET_SCORE_SAFETY_CAP_SEC,
} from '../game-config.js'

/** Clicker mode definition — click fast, buy upgrades, outscore your opponent. */
export const clickerMode: ModeDefinition = {
  resources: ['currency'],
  scoreResource: 'currency',
  clicksEnabled: true,
  nativeModifiers: [
    { stage: 'additive', field: 'clickIncome', value: 1 }, // base 1 per click
  ],
  upgrades: [
    {
      id: 'auto-clicker',
      name: 'Auto-Clicker',
      cost: 10,
      description: '+1 currency/sec passively',
      modifiers: [{ stage: 'additive', field: 'currency', value: 1 }],
    },
    {
      id: 'double-click',
      name: 'Double Click',
      cost: 25,
      description: 'Each manual click gives +2 instead of +1',
      modifiers: [{ stage: 'additive', field: 'clickIncome', value: 1 }],
    },
    {
      id: 'multiplier',
      name: 'Multiplier',
      cost: 100,
      description: '2x all income',
      modifiers: [
        { stage: 'multiplicative', field: 'clickIncome', value: 2 },
        { stage: 'multiplicative', field: 'currency', value: 2 },
      ],
    },
  ],
  goals: [
    { type: 'timed', durationSec: ROUND_DURATION_SEC },
    {
      type: 'target-score',
      target: CLICKER_TARGET_SCORE,
      safetyCapSec: TARGET_SCORE_SAFETY_CAP_SEC,
    },
  ],
}
