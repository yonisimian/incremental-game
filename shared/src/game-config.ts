import type { PlayerState, UpgradeDefinition } from './types.js';

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

export const UPGRADES: readonly UpgradeDefinition[] = [
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

// ─── Derived Helpers ─────────────────────────────────────────────────

/** Map from UpgradeId to its definition for O(1) lookup. */
export const UPGRADE_MAP = new Map(
  UPGRADES.map((u) => [u.id, u]),
);

/** Initial player state at the start of each round. */
export const INITIAL_PLAYER_STATE = {
  score: 0,
  currency: 0,
  upgrades: {
    'auto-clicker': false,
    'double-click': false,
    'multiplier': false,
  },
} as const satisfies PlayerState;
