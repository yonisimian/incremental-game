import { type ModeDefinition, type PlayerState, isHighlightActive } from '@game/shared'

/**
 * Per-round manual-clicking telemetry (data panel). Not authoritative and never
 * sent to the server — each click's income is the optimistic value credited at
 * click time. Reset at the start of every match.
 */
interface ClickStats {
  /** Total manual clicks this round. */
  totalClicks: number
  /** Total income credited by manual clicks this round (optimistic). */
  totalIncome: number
  /** Click income credited this round, keyed by resource (optimistic). */
  incomeByResource: Record<string, number>
  /** Highest clicks/sec (over the rolling window) reached this round. */
  peakCps: number
  /** Timestamps (ms) of recent clicks, for the rolling clicks/sec window. */
  recentClickTimes: number[]
}

/**
 * Per-round highlight telemetry (data panel). Dwell is measured in *game
 * seconds* (the server's `meta.gameSec` clock, which pauses when the match
 * pauses), accumulated each server tick against whichever resource was
 * highlighted. Reset at the start of every match.
 */
interface HighlightStats {
  /** Seconds each resource has been the highlighted resource this round. */
  dwellByResource: Record<string, number>
}

/** Rolling window used to derive the instantaneous clicks/sec (for peak tracking). */
const CLICK_RATE_WINDOW_MS = 3000

/**
 * Owns all client-only, per-round analytics gathering for the data panel — the
 * one place round telemetry accumulates. `game.ts` feeds it events
 * ({@link recordClick}, {@link recordTick}) and the data panel reads its
 * accessors; nothing here is authoritative or synced to the server.
 *
 * Kept as a standalone module instance (not a field on `GameState`) so the
 * whole feature stays self-contained: adding a stat touches only this class and
 * the panel, and removing the feature is deleting this file plus its few call
 * sites.
 */
class RoundStats {
  private clicks: ClickStats = emptyClickStats()
  private highlight: HighlightStats = emptyHighlightStats()
  /** The `meta.gameSec` sampled at the last dwell accumulation (game seconds). */
  private lastHighlightGameSec = 0

  /** Clear all accumulated telemetry for a new round. */
  reset(): void {
    this.clicks = emptyClickStats()
    this.highlight = emptyHighlightStats()
    this.lastHighlightGameSec = 0
  }

  /**
   * Record one manual click crediting `income` to `resource`. Must be called
   * exactly once per real click (never during optimistic reconciliation, so
   * re-applied pending actions can't double-count).
   */
  recordClick(resource: string, income: number): void {
    const now = Date.now()
    this.clicks.totalClicks += 1
    this.clicks.totalIncome += income
    this.clicks.incomeByResource[resource] = (this.clicks.incomeByResource[resource] ?? 0) + income
    this.clicks.recentClickTimes.push(now)
    this.pruneClickTimes(now)
    // Peak is sampled at click time (the rolling rate only decays between
    // clicks, so a click is exactly when a new maximum can occur).
    const cps = (this.clicks.recentClickTimes.length / CLICK_RATE_WINDOW_MS) * 1000
    if (cps > this.clicks.peakCps) this.clicks.peakCps = cps
  }

  /**
   * Advance per-tick telemetry from an authoritative server state. Credits
   * elapsed game time (since the last tick) to the currently-highlighted
   * resource, using the server's `meta.gameSec` clock so paused time isn't
   * counted; dwell only accrues while the highlight mechanic is active.
   */
  recordTick(player: Readonly<PlayerState>, modeDef: ModeDefinition): void {
    const gameSec = (player.meta.gameSec as number | undefined) ?? 0
    const delta = gameSec - this.lastHighlightGameSec
    this.lastHighlightGameSec = gameSec
    if (delta <= 0) return
    if (!isHighlightActive(player, modeDef)) return
    const highlight = (player.meta.highlight as string | undefined) ?? modeDef.scoreResource
    this.highlight.dwellByResource[highlight] =
      (this.highlight.dwellByResource[highlight] ?? 0) + delta
  }

  /** Total manual clicks this round. */
  get totalClicks(): number {
    return this.clicks.totalClicks
  }

  /** Total income credited by manual clicks this round (optimistic). */
  get totalIncome(): number {
    return this.clicks.totalIncome
  }

  /** Click income credited this round, keyed by resource (optimistic). */
  get incomeByResource(): Readonly<Record<string, number>> {
    return this.clicks.incomeByResource
  }

  /** Highest clicks/sec (over the rolling window) reached this round. */
  get peakCps(): number {
    return this.clicks.peakCps
  }

  /** Seconds each resource has been the highlighted resource this round. */
  get dwellByResource(): Readonly<Record<string, number>> {
    return this.highlight.dwellByResource
  }

  /**
   * Average manual clicks per second over the round so far — total clicks
   * divided by elapsed game time (`meta.gameSec`, advanced by the server's
   * passive tick). Returns 0 until the clock has advanced.
   */
  averageCps(player: Readonly<PlayerState>): number {
    const elapsed = (player.meta.gameSec as number | undefined) ?? 0
    if (elapsed <= 0) return 0
    return this.clicks.totalClicks / elapsed
  }

  /** Drop click timestamps older than the rolling window (relative to `now`). */
  private pruneClickTimes(now: number): void {
    const cutoff = now - CLICK_RATE_WINDOW_MS
    const times = this.clicks.recentClickTimes
    let drop = 0
    while (drop < times.length && times[drop] < cutoff) drop += 1
    if (drop > 0) times.splice(0, drop)
  }
}

/** A fresh, zeroed click-stats record for a new round. */
function emptyClickStats(): ClickStats {
  return { totalClicks: 0, totalIncome: 0, incomeByResource: {}, peakCps: 0, recentClickTimes: [] }
}

/** A fresh, zeroed highlight-stats record for a new round. */
function emptyHighlightStats(): HighlightStats {
  return { dwellByResource: {} }
}

/** The single round-analytics accumulator, shared by `game.ts` and the data panel. */
export const roundStats = new RoundStats()
