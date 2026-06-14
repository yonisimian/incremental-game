// ─── Round ───────────────────────────────────────────────────────────

/** Default round duration in seconds (generic timed goal / test default). */
export const ROUND_DURATION_SEC = 30

/** Default round duration in seconds (idler timed). */
export const IDLER_ROUND_DURATION_SEC = 35

/** Default target score for idler target-score mode. */
export const IDLER_TARGET_SCORE = 364

/** Safety cap for target-score matches (seconds). */
export const TARGET_SCORE_SAFETY_CAP_SEC = 300

/** Safety cap for buy-upgrade matches (seconds). */
export const BUY_UPGRADE_SAFETY_CAP_SEC = 600

/** Countdown before round starts (seconds). */
export const COUNTDOWN_SEC = 0

// ─── Server Tick Rates ───────────────────────────────────────────────

/** How often the server computes passive income (ms). */
export const TICK_INTERVAL_MS = 250

/** How often the server broadcasts state updates (ms). */
export const BROADCAST_INTERVAL_MS = 500

// ─── Milestones ──────────────────────────────────────────────────────

/** Score interval at which milestone VFX fire (100 → 100, 200, 300…). */
export const MILESTONE_INTERVAL = 100

// ─── Anti-Cheat ──────────────────────────────────────────────────────

/** Maximum clicks per second allowed before server rejects actions. */
export const MAX_CPS = 20

// ─── Heartbeat ───────────────────────────────────────────────────────

/** Ping interval for WebSocket keepalive (ms). */
export const HEARTBEAT_INTERVAL_MS = 30_000

// ─── Rooms ───────────────────────────────────────────────────────────

/** Maximum number of active rooms the server will host simultaneously. */
export const MAX_ROOMS = 20

/** Time-to-live for non-full rooms before auto-expiry (ms). 10 minutes. */
export const ROOM_TTL_MS = 10 * 60 * 1000

/** How often the server broadcasts SERVER_STATUS to all clients (ms). */
export const SERVER_STATUS_INTERVAL_MS = 5_000
