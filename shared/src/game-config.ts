import type { GameMode, Goal, PlayerState, UpgradeDefinition } from './types.js'

// ─── Round ───────────────────────────────────────────────────────────

/** Default round duration in seconds (clicker timed). */
export const ROUND_DURATION_SEC = 30

/** Default round duration in seconds (idler timed). */
export const IDLER_ROUND_DURATION_SEC = 35

/** Default target score for clicker target-score mode. */
export const CLICKER_TARGET_SCORE = 666

/** Default target score for idler target-score mode. */
export const IDLER_TARGET_SCORE = 364

/** Safety cap for target-score matches (seconds). */
export const TARGET_SCORE_SAFETY_CAP_SEC = 300

/** Countdown before round starts (seconds). */
export const COUNTDOWN_SEC = 3

// ─── Server Tick Rates ───────────────────────────────────────────────

/** How often the server computes passive income (ms). */
export const TICK_INTERVAL_MS = 250

/** How often the server broadcasts state updates (ms). */
export const BROADCAST_INTERVAL_MS = 500

// ─── Anti-Cheat ──────────────────────────────────────────────────────

/** Maximum clicks per second allowed before server rejects actions. */
export const MAX_CPS = 20

// ─── Heartbeat ───────────────────────────────────────────────────────

/** Ping interval for WebSocket keepalive (ms). */
export const HEARTBEAT_INTERVAL_MS = 30_000

/** Time to wait for pong before terminating connection (ms). */
export const HEARTBEAT_TIMEOUT_MS = 10_000

// ─── Reconnection ────────────────────────────────────────────────────

/** Grace period for reconnection before forfeit (ms). */
export const RECONNECT_GRACE_MS = 10_000

// ─── Upgrades ────────────────────────────────────────────────────────

export const CLICKER_UPGRADES: readonly UpgradeDefinition[] = [
  {
    id: 'auto-clicker',
    name: 'Auto-Clicker',
    cost: 10,
    description: '+1 currency/sec passively',
  },
  {
    id: 'double-click',
    name: 'Double Click',
    cost: 25,
    description: 'Each manual click gives +2 instead of +1',
  },
  {
    id: 'multiplier',
    name: 'Multiplier',
    cost: 100,
    description: '2x all income',
  },
] as const

export const IDLER_UPGRADES: readonly UpgradeDefinition[] = [
  {
    id: 'sharpened-axes',
    name: '🪓 Sharpened Axes',
    cost: 30,
    costCurrency: 'wood',
    description: 'Highlight boost → 4× (from 2×)',
  },
  {
    id: 'lumber-mill',
    name: '🏗️ Lumber Mill',
    cost: 80,
    costCurrency: 'wood',
    description: '+2 base 🪵/sec',
  },
  {
    id: 'tavern-recruits',
    name: '🍻 Tavern Recruits',
    cost: 15,
    costCurrency: 'ale',
    description: '+1 base 🪵/sec (stackable)',
    repeatable: true,
  },
] as const

/** @deprecated Use CLICKER_UPGRADES instead. Kept for backward compat. */
export const UPGRADES = CLICKER_UPGRADES

// ─── Per-Mode Config ─────────────────────────────────────────────────

export interface ModeConfig {
  upgrades: readonly UpgradeDefinition[]
  /** Available win conditions for this game mode. */
  goals: readonly Goal[]
  /** Base passive income per second (before upgrades). 0 for clicker. */
  basePassivePerSec: number
  /** Whether manual clicks are allowed. */
  clicksEnabled: boolean
}

export const MODE_CONFIGS: Record<GameMode, ModeConfig> = {
  clicker: {
    upgrades: CLICKER_UPGRADES,
    goals: [
      { type: 'timed', durationSec: ROUND_DURATION_SEC },
      {
        type: 'target-score',
        target: CLICKER_TARGET_SCORE,
        safetyCapSec: TARGET_SCORE_SAFETY_CAP_SEC,
      },
    ],
    basePassivePerSec: 0,
    clicksEnabled: true,
  },
  idler: {
    upgrades: IDLER_UPGRADES,
    goals: [
      { type: 'timed', durationSec: IDLER_ROUND_DURATION_SEC },
      {
        type: 'target-score',
        target: IDLER_TARGET_SCORE,
        safetyCapSec: TARGET_SCORE_SAFETY_CAP_SEC,
      },
    ],
    basePassivePerSec: 1,
    clicksEnabled: false,
  },
}

/** Get the default goal for a mode (first in the goals array). */
export function getDefaultGoal(mode: GameMode): Goal {
  return MODE_CONFIGS[mode].goals[0]
}

// ─── Derived Helpers ─────────────────────────────────────────────────

/** Initial player state at the start of each round. */
export const INITIAL_PLAYER_STATE = {
  score: 0,
  currency: 0,
  upgrades: {
    'auto-clicker': false,
    'double-click': false,
    multiplier: false,
    'sharpened-axes': false,
    'lumber-mill': false,
    'tavern-recruits': 0,
  },
} as const satisfies PlayerState
