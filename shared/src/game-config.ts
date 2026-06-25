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

/** Bounds for a creator-customized target score (target-score goal). */
export const MIN_TARGET_SCORE = 10
export const MAX_TARGET_SCORE = 100_000

/** Bounds for a creator-customized round duration (timed goal, seconds). */
export const MIN_ROUND_DURATION_SEC = 10
export const MAX_ROUND_DURATION_SEC = 600

/**
 * Countdown before round starts (seconds).
 *
 * TODO: Temporarily 0 to skip the countdown during development. Restore to 3
 * before publishing the game. When restoring, also remove the block in game.ts
 * function startCountdown:
 * ```
 *   // With no countdown configured (COUNTDOWN_SEC === 0) start playing right away.
 *   // The server begins its round clock the instant the countdown elapses, so
 *   // waiting a full 1000ms interval here would silently swallow the match's first
 *   // second — the player would see the timer "start" already ~1s in.
 *   if (state.countdown <= 0) {
 *     state.screen = 'playing'
 *     notify()
 *     return
 *   }
 * ```
 */
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
