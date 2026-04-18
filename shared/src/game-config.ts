import type { GameMode, PlayerState, UpgradeDefinition } from './types.js';

// ─── Round ───────────────────────────────────────────────────────────

/** Default round duration in seconds. */
export const ROUND_DURATION_SEC = 60;

/** Countdown before round starts (seconds). */
export const COUNTDOWN_SEC = 3;

// ─── Server Tick Rates ───────────────────────────────────────────────

/** How often the server computes passive income (ms). */
export const TICK_INTERVAL_MS = 250;

/** How often the server broadcasts state updates (ms). */
export const BROADCAST_INTERVAL_MS = 500;

// ─── Anti-Cheat ──────────────────────────────────────────────────────

/** Maximum clicks per second allowed before server rejects actions. */
export const MAX_CPS = 20;

// ─── Heartbeat ───────────────────────────────────────────────────────

/** Ping interval for WebSocket keepalive (ms). */
export const HEARTBEAT_INTERVAL_MS = 30_000;

/** Time to wait for pong before terminating connection (ms). */
export const HEARTBEAT_TIMEOUT_MS = 10_000;

// ─── Reconnection ────────────────────────────────────────────────────

/** Grace period for reconnection before forfeit (ms). */
export const RECONNECT_GRACE_MS = 10_000;

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
] as const;

export const IDLER_UPGRADES: readonly UpgradeDefinition[] = [
  {
    id: 'sharpened-axes',
    name: '🪓 Sharpened Axes',
    cost: 40,
    costCurrency: 'wood',
    description: 'Highlight boost → 4× (from 2×)',
  },
  {
    id: 'lumber-mill',
    name: '🏗️ Lumber Mill',
    cost: 120,
    costCurrency: 'wood',
    description: '+2 base 🪵/sec',
  },
  {
    id: 'tavern-recruits',
    name: '🍻 Tavern Recruits',
    cost: 10,
    costCurrency: 'ale',
    description: '+1 base 🪵/sec',
  },
  {
    id: 'liquid-courage',
    name: '🫗 Liquid Courage',
    cost: 35,
    costCurrency: 'ale',
    description: 'Convert all 🍺 → 🪵 (one-time)',
  },
] as const;

/** @deprecated Use CLICKER_UPGRADES instead. Kept for backward compat. */
export const UPGRADES = CLICKER_UPGRADES;

// ─── Per-Mode Config ─────────────────────────────────────────────────

export interface ModeConfig {
  upgrades: readonly UpgradeDefinition[];
  /** Base passive income per second (before upgrades). 0 for clicker. */
  basePassivePerSec: number;
  /** Whether manual clicks are allowed. */
  clicksEnabled: boolean;
}

export const MODE_CONFIGS: Record<GameMode, ModeConfig> = {
  clicker: {
    upgrades: CLICKER_UPGRADES,
    basePassivePerSec: 0,
    clicksEnabled: true,
  },
  idler: {
    upgrades: IDLER_UPGRADES,
    basePassivePerSec: 1,
    clicksEnabled: false,
  },
};

// ─── Derived Helpers ─────────────────────────────────────────────────

/** Initial player state at the start of each round. */
export const INITIAL_PLAYER_STATE = {
  score: 0,
  currency: 0,
  upgrades: {
    'auto-clicker': false,
    'double-click': false,
    'multiplier': false,
    'sharpened-axes': false,
    'lumber-mill': false,
    'tavern-recruits': false,
    'liquid-courage': false,
  },
} as const satisfies PlayerState;
