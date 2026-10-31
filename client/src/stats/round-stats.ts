import {
  type AttackEvent,
  type ModeDefinition,
  type PlayerState,
  isHighlightActive,
  pactWindowOpenedAtSec,
  readGameSec,
  readHighlight,
} from '@game/shared'

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
  /** Seconds spent with the highlight released this round. */
  releasedSec: number
}

/** A span of game seconds — a debuff window, a pact window. */
interface TimeWindow {
  readonly startSec: number
  readonly endSec: number
}

/**
 * What one side's strikes moved this round: stockpile per resource, generator
 * copies per generator, and the debuff windows opened — kept as spans, so the
 * time debuffed is read against the clock (see {@link coveredSec}).
 */
interface StrikeHaul {
  resources: Record<string, number>
  generators: Record<string, number>
  debuffWindows: TimeWindow[]
}

/**
 * One of this player's attacks, as the server reported its strikes this round.
 * A strike can arrive as several events (a theft plus a debuff window), so
 * strikes are counted per landing time, not per event.
 */
interface OutgoingAttackStats extends StrikeHaul {
  /** Strikes that landed, whatever they moved. */
  strikes: number
  /** Strikes that moved nothing (`kind: 'none'`). */
  misses: number
  /** Landing time of the last strike counted, to fold its other events in. */
  lastStrikeT: number
}

/**
 * Per-round attack telemetry (data panel), fed from the server's `attackEvents`
 * — each sent exactly once per landed strike, so unlike an optimistic
 * activation it can never be rolled back. Reset at the start of every match.
 */
interface AttackStats {
  /** This player's strikes, keyed by attack id. */
  outgoing: Record<string, OutgoingAttackStats>
  /** What the opponent's strikes took from this player, all attacks together. */
  incoming: StrikeHaul
}

/** Rolling window used to derive the instantaneous clicks/sec (for peak tracking). */
const CLICK_RATE_WINDOW_MS = 3000

/**
 * Owns all client-only, per-round analytics gathering for the data panel — the
 * one place round telemetry accumulates. `game.ts` feeds it events
 * ({@link recordClick}, {@link recordTick}, {@link recordAttackEvents},
 * {@link recordPactWindows}) and the data panel reads its
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
  private attacks: AttackStats = emptyAttackStats()
  /** Every active-pact window seen this round, keyed by pact id. */
  private pactWindows = new Map<string, TimeWindow[]>()

  /** Clear all accumulated telemetry for a new round. */
  reset(): void {
    this.clicks = emptyClickStats()
    this.highlight = emptyHighlightStats()
    this.lastHighlightGameSec = 0
    this.attacks = emptyAttackStats()
    this.pactWindows.clear()
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
   * resource — or to {@link releasedSec} while the highlight is released, so the
   * buckets account for the whole round rather than silently crediting a
   * resource the player wasn't holding. Uses the server's `meta.gameSec` clock so
   * paused time isn't counted; dwell only accrues while the highlight mechanic is
   * active.
   */
  recordTick(player: Readonly<PlayerState>, modeDef: ModeDefinition): void {
    const gameSec = readGameSec(player)
    const delta = gameSec - this.lastHighlightGameSec
    this.lastHighlightGameSec = gameSec
    if (delta <= 0) return
    if (!isHighlightActive(player, modeDef)) return
    const highlight = readHighlight(player)
    if (highlight === null) {
      this.highlight.releasedSec += delta
      return
    }
    this.highlight.dwellByResource[highlight] =
      (this.highlight.dwellByResource[highlight] ?? 0) + delta
  }

  /**
   * Tally the strikes one `STATE_UPDATE` reports, both directions. Outgoing
   * events are counted per attack; incoming ones are pooled, since the victim
   * already learns each strike's name from its toast and the totals are what
   * the panel reports.
   */
  recordAttackEvents(events: readonly AttackEvent[]): void {
    for (const ev of events) {
      let haul: StrikeHaul
      if (ev.direction === 'outgoing') {
        const stats = (this.attacks.outgoing[ev.attack] ??= {
          ...emptyHaul(),
          strikes: 0,
          misses: 0,
          lastStrikeT: -1,
        })
        // A strike's events are sent together, so a new landing time is a new strike.
        if (ev.t !== stats.lastStrikeT) {
          stats.strikes += 1
          stats.lastStrikeT = ev.t
        }
        if (ev.kind === 'none') stats.misses += 1
        haul = stats
      } else {
        haul = this.attacks.incoming
      }
      if (ev.kind === 'resource') {
        haul.resources[ev.resource] = (haul.resources[ev.resource] ?? 0) + ev.amount
      } else if (ev.kind === 'generator') {
        haul.generators[ev.generator] = (haul.generators[ev.generator] ?? 0) + ev.count
      } else if (ev.kind === 'debuff') {
        haul.debuffWindows.push({ startSec: ev.t, endSec: ev.t + ev.durationSec })
      }
    }
  }

  /**
   * Note the active-pact windows open in an **authoritative** snapshot (never
   * the reconciled state: a replayed optimistic activation carries a window the
   * client timed, not the server). A window is identified by its pact and
   * closing time, so a repeated snapshot never counts it twice. Its opening
   * comes from `pactWindowOpenedAtSec`, so time active is exact without
   * sampling every tick.
   */
  recordPactWindows(player: Readonly<PlayerState>, modeDef: ModeDefinition): void {
    for (const w of player.activePacts ?? []) {
      const seen = this.pactWindows.get(w.pact) ?? []
      if (seen.some((s) => s.endSec === w.expiresAtSec)) continue
      seen.push({ startSec: pactWindowOpenedAtSec(w, modeDef), endSec: w.expiresAtSec })
      this.pactWindows.set(w.pact, seen)
    }
  }

  /** Strike telemetry for one of this player's attacks, or `null` before its first strike. */
  outgoingAttack(attackId: string): Readonly<OutgoingAttackStats> | null {
    return this.attacks.outgoing[attackId] ?? null
  }

  /**
   * Game seconds attack `attackId`'s debuff windows have held the opponent this
   * round, as of `gameSec` (the player's `meta.gameSec`).
   */
  outgoingDebuffSec(attackId: string, gameSec: number): number {
    return coveredSec(this.outgoingAttack(attackId)?.debuffWindows ?? [], gameSec)
  }

  /** What the opponent's strikes have taken from this player this round. */
  get incomingAttacks(): Readonly<StrikeHaul> {
    return this.attacks.incoming
  }

  /**
   * Game seconds this player has spent under at least one enemy debuff window
   * this round, as of `gameSec` — overlapping windows count once.
   */
  incomingDebuffSec(gameSec: number): number {
    return coveredSec(this.attacks.incoming.debuffWindows, gameSec)
  }

  /**
   * How many times this player has activated pact `pactId` this round.
   * `predicted` is the reconciled state's open window, if any: counted until
   * the server's own window for that activation arrives (they overlap), so the
   * row agrees with the card's "Active" the moment the player clicks.
   */
  pactActivations(pactId: string, predicted: TimeWindow | null = null): number {
    return this.pactWindowsWith(pactId, predicted).length
  }

  /**
   * Game seconds pact `pactId` has been in force this round, as of `gameSec`
   * (the player's `meta.gameSec`, so time paused is never counted).
   * `predicted` as for {@link pactActivations}.
   */
  pactActiveSec(pactId: string, gameSec: number, predicted: TimeWindow | null = null): number {
    return coveredSec(this.pactWindowsWith(pactId, predicted), gameSec)
  }

  /** The server's windows of `pactId`, plus `predicted` when none of them is its activation. */
  private pactWindowsWith(pactId: string, predicted: TimeWindow | null): readonly TimeWindow[] {
    const seen = this.pactWindows.get(pactId) ?? []
    // A pact's windows never overlap (`already-active`), so overlap means the same activation.
    if (
      !predicted ||
      seen.some((w) => w.startSec < predicted.endSec && predicted.startSec < w.endSec)
    )
      return seen
    return [...seen, predicted]
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

  /** Seconds spent with the highlight released this round. */
  get releasedSec(): number {
    return this.highlight.releasedSec
  }

  /**
   * Average manual clicks per second over the round so far — total clicks
   * divided by elapsed game time (`meta.gameSec`, advanced by the server's
   * passive tick). Returns 0 until the clock has advanced.
   */
  averageCps(player: Readonly<PlayerState>): number {
    const elapsed = readGameSec(player)
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
  return { dwellByResource: {}, releasedSec: 0 }
}

/** A fresh, empty strike haul. */
function emptyHaul(): StrikeHaul {
  return { resources: {}, generators: {}, debuffWindows: [] }
}

/**
 * Game seconds covered by at least one of `windows` up to `gameSec`: a window
 * still open counts only what has elapsed, and overlapping ones count once.
 */
function coveredSec(windows: readonly TimeWindow[], gameSec: number): number {
  let total = 0
  let reached = -Infinity
  for (const w of [...windows].sort((a, b) => a.startSec - b.startSec)) {
    const start = Math.max(w.startSec, reached)
    const end = Math.min(w.endSec, gameSec)
    if (end > start) total += end - start
    reached = Math.max(reached, w.endSec)
  }
  return total
}

/** A fresh, zeroed attack-stats record for a new round. */
function emptyAttackStats(): AttackStats {
  return { outgoing: {}, incoming: emptyHaul() }
}

/** The single round-analytics accumulator, shared by `game.ts` and the data panel. */
export const roundStats = new RoundStats()
