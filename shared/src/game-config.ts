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

// ─── Milestones ──────────────────────────────────────────────────────

/** Score interval at which milestone VFX fire (100 → 100, 200, 300…). */
export const MILESTONE_INTERVAL = 100

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
