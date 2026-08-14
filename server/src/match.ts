import { randomUUID } from 'node:crypto'
import WebSocket from 'ws'
import {
  BROADCAST_INTERVAL_MS,
  COUNTDOWN_SEC,
  TICK_INTERVAL_MS,
  MAX_RESOURCE,
  getAvailableUpgrades,
  getDefaultGoal,
  getModeDefinition,
  createInitialState,
  collectModifiers,
  collectEnemyDebuffs,
  computePassiveRates,
  computeClickIncome,
  applyPassiveTick,
  advanceHighlightBattery,
  applyPurchase,
  applyGeneratorPurchase,
  creditResource,
  applyGeneratorSell,
  applyAttackActivation,
  dueAttacks,
  resolveAttackStrike,
  hasEnemyDataAccess,
  enemyDataKeysFor,
  ENEMY_DATA_CPS_KEY,
  ENEMY_DATA_PURCHASES_KEY,
  ENEMY_DATA_PURCHASE_KIND_KEY,
  ENEMY_DATA_PURCHASE_UPGRADE_KEY,
  ENEMY_DATA_PURCHASE_GENERATOR_KEY,
  isClickUnlocked,
  applyHighlightSelection,
} from '@game/shared'
import type {
  ClientMessage,
  GameMode,
  Goal,
  MatchWinner,
  Modifier,
  ModeDefinition,
  OpponentView,
  PlayerAction,
  PurchaseEvent,
  AttackEvent,
  PlayerState,
  RoundEndReason,
  ServerMessage,
  UpgradeDefinition,
} from '@game/shared'
import {
  isValidClick,
  isValidPurchase,
  isValidGeneratorPurchase,
  isValidGeneratorSell,
  isValidAttackActivation,
} from './validation.js'
import type { BotStrategy } from './bot.js'
import { elapsedGameSeconds, realTimeDelay } from './runtime-config.js'

// ─── Types ───────────────────────────────────────────────────────────

interface MatchPlayer {
  readonly id: string
  readonly name: string
  ws: WebSocket | null
  state: PlayerState
  ackSeq: number
  recentClickTimestamps: number[]
  stats: {
    totalClicks: number
    peakCps: number
    upgradesPurchased: string[]
  }
  /**
   * Recent purchase log (oldest first) for the espionage feed. Records every
   * upgrade/generator buy with round-elapsed time, kind, abstract id, and a
   * monotonic {@link LoggedPurchase.seq}; the opponent view redacts detail by
   * intel tier and forwards each event once (see {@link opponentViewFor}).
   */
  purchases: LoggedPurchase[]
  /** Next purchase sequence number to assign (monotonic, never reset). */
  purchaseSeq: number
  /**
   * As a *viewer*: the highest opponent purchase `seq` already forwarded to this
   * player's espionage feed. `null` until the feed is first unlocked — on that
   * first broadcast it's set to the opponent's current head so earlier purchases
   * are never revealed retroactively. Thereafter only `seq > purchaseFeedSeq`
   * events are sent (each exactly once); the client accumulates them.
   */
  purchaseFeedSeq: number | null
  /**
   * Attack strikes to surface to this player on the next broadcast (oldest
   * first) — a delta, cleared once sent. Holds both this player's own landed
   * strikes (`outgoing`) and strikes against them (`incoming`); unlike the
   * purchase feed there's no intel gating (a theft is directly observable), so a
   * plain drain-on-broadcast buffer suffices.
   */
  attackEvents: AttackEvent[]
}

/** A purchase log entry: the wire {@link PurchaseEvent} plus its server-internal seq. */
interface LoggedPurchase extends PurchaseEvent {
  /** Monotonic per-player sequence; stable across log capping (unlike an index). */
  seq: number
}

type MatchPhase = 'countdown' | 'playing' | 'ended'

/**
 * Target length the purchase log is trimmed back to. The trim drops only events
 * that have already been forwarded to the (sole) opponent viewer, so a burst
 * larger than the cap between two broadcasts can never silently scroll an
 * un-forwarded event off the feed — see {@link Match.capPurchaseLog}. For a
 * viewer that never unlocks the feed nothing is owed, so the log stays here; the
 * monotonic `seq` keeps the per-viewer watermark correct as entries scroll off.
 */
const PURCHASE_LOG_CAP = 25

/**
 * Redact a logged purchase down to the fields the viewer's intel tier permits.
 * The base feed reveals only `t`. `showKind` adds the kind (upgrade vs generator)
 * for every event; `showUpgradeId`/`showGeneratorId` additionally reveal the
 * abstract `id` for that kind (and imply its kind, since knowing *which* item
 * names the kind too). Unrevealed ids stay omitted so the opponent's tree can't
 * be read in devtools.
 */
function redactPurchase(
  p: LoggedPurchase,
  showKind: boolean,
  showUpgradeId: boolean,
  showGeneratorId: boolean,
): PurchaseEvent {
  const revealId = p.kind === 'upgrade' ? showUpgradeId : showGeneratorId
  const event: PurchaseEvent = { t: p.t }
  if (showKind || revealId) event.kind = p.kind
  if (revealId) event.id = p.id
  return event
}

// ─── Match ───────────────────────────────────────────────────────────

export class Match {
  readonly id: string
  readonly mode: GameMode
  readonly goal: Goal
  private readonly modeDef: ModeDefinition
  private readonly availableUpgrades: readonly UpgradeDefinition[]
  private readonly upgradeMap: ReadonlyMap<string, UpgradeDefinition>
  private readonly players: [MatchPlayer, MatchPlayer]
  private readonly bot: BotStrategy | null
  private phase: MatchPhase = 'countdown'
  private tick = 0
  private timeLeftSec: number
  /**
   * Monotonic timestamp (ms, from `performance.now()`) at which the current
   * round ends; source of truth for the timer. Uses the monotonic clock rather
   * than `Date.now()` so the countdown can't jump when the system wall clock
   * steps (NTP corrections, VM/host time-sync) — a wall-clock step of a few
   * seconds would otherwise make the timer leap by the same amount.
   */
  private endAtMs = 0

  private tickTimer: ReturnType<typeof setInterval> | null = null
  private broadcastTimer: ReturnType<typeof setInterval> | null = null
  private paused = false
  private onEndCallback: (() => void) | null = null

  constructor(
    p1: { id: string; ws: WebSocket; name?: string },
    p2: { id: string; ws: WebSocket | null; name?: string },
    mode: GameMode,
    goal?: Goal,
    bot?: BotStrategy,
  ) {
    this.id = randomUUID()
    this.mode = mode
    this.goal = goal ?? getDefaultGoal(mode)
    this.modeDef = getModeDefinition(mode)
    this.timeLeftSec = this.goal.type === 'timed' ? this.goal.durationSec : this.goal.safetyCapSec
    this.availableUpgrades = getAvailableUpgrades(this.modeDef, this.goal)
    this.upgradeMap = new Map(this.availableUpgrades.map((u) => [u.id, u]))
    this.bot = bot ?? null
    this.players = [this.initPlayer(p1), this.initPlayer(p2)]
  }

  /** Register a callback invoked when the match ends. */
  onEnd(cb: () => void): void {
    this.onEndCallback = cb
  }

  /** Get both player IDs. */
  getPlayerIds(): [string, string] {
    return [this.players[0].id, this.players[1].id]
  }

  /**
   * Test-only seam: add to a player's resource balances. Used by tests to set up
   * scenarios that are impractical to reach through passive income alone (e.g.
   * affording the high-cost buy-upgrade trophy). Not used by production paths.
   */
  grantResourcesForTest(playerId: string, resources: Record<string, number>): void {
    const player = this.players.find((p) => p.id === playerId)
    if (!player) return
    for (const [res, amount] of Object.entries(resources)) {
      // Resource-only: unlike production credits this must not touch score, or a
      // test grant of the score resource would silently inflate score.
      player.state.resources[res] = Math.min(
        MAX_RESOURCE,
        (player.state.resources[res] ?? 0) + amount,
      )
    }
  }

  /** Send ROUND_START to both, then begin the game loop after countdown. */
  start(): void {
    const config = {
      mode: this.mode,
      goal: this.goal,
    }

    for (let i = 0; i < this.players.length; i++) {
      const player = this.players[i]
      const opponent = this.players[1 - i]
      this.send(player, {
        type: 'ROUND_START',
        matchId: this.id,
        config,
        opponentName: opponent.name,
        vsBot: this.bot !== null,
        serverTime: Date.now(),
      })
    }

    setTimeout(() => {
      if (this.phase === 'ended') return // disconnected during countdown
      this.phase = 'playing'
      this.beginGameLoop()
    }, COUNTDOWN_SEC * 1000)
  }

  /** Route an incoming WebSocket message to the correct handler. */
  handleMessage(playerId: string, raw: string): void {
    const player = this.players.find((p) => p.id === playerId)
    if (!player) return

    let msg: ClientMessage
    try {
      msg = JSON.parse(raw) as ClientMessage
    } catch {
      return // malformed JSON
    }

    if (msg.type === 'QUIT') {
      this.handleQuit(playerId)
      return
    }

    if (this.phase !== 'playing') return

    if (msg.type === 'PAUSE') {
      if (!this.bot) return // pause is only allowed in bot matches
      this.pause()
      return
    }

    if (msg.type === 'UNPAUSE') {
      if (!this.bot) return // pause is only allowed in bot matches
      this.resume()
      return
    }

    if (msg.type === 'ACTION_BATCH') {
      if (this.paused) return
      this.processActions(player, msg.actions, msg.seq)
      this.checkTargetScoreReached()
    }
  }

  /** Handle a player voluntarily quitting the match. */
  private handleQuit(playerId: string): void {
    if (this.phase === 'ended') return
    this.phase = 'ended'
    this.clearTimers()

    const quitterIdx = this.players[0].id === playerId ? 0 : 1
    const quitter = this.players[quitterIdx]
    const opponent = this.players[1 - quitterIdx]

    this.send(quitter, {
      type: 'ROUND_END',
      winner: 'opponent',
      reason: 'quit',
      finalScores: this.finalScoresFor(quitter.state.score, opponent.state.score),
      stats: quitter.stats,
    })

    this.send(opponent, {
      type: 'ROUND_END',
      winner: 'player',
      reason: 'quit',
      finalScores: this.finalScoresFor(opponent.state.score, quitter.state.score),
      stats: opponent.stats,
    })

    this.onEndCallback?.()
  }

  /** Handle player disconnect.
   * TODO: implement 10s grace period per docs/DESIGN.md — currently forfeits immediately.
   */
  handleDisconnect(playerId: string): void {
    if (this.phase === 'ended') return

    const player = this.players.find((p) => p.id === playerId)
    if (player) player.ws = null

    this.forfeit(playerId)
  }

  // ─── Private: setup ────────────────────────────────────────────────

  private initPlayer(p: { id: string; ws: WebSocket | null; name?: string }): MatchPlayer {
    return {
      id: p.id,
      name: p.name ?? '',
      ws: p.ws,
      state: createInitialState(this.modeDef),
      ackSeq: 0,
      recentClickTimestamps: [],
      stats: { totalClicks: 0, peakCps: 0, upgradesPurchased: [] },
      purchases: [],
      purchaseSeq: 0,
      purchaseFeedSeq: null,
      attackEvents: [],
    }
  }

  // ─── Private: game loop ────────────────────────────────────────────

  private beginGameLoop(): void {
    // Anchor the round end to a monotonic timestamp so the displayed timer can
    // never drift away from the authoritative round-end check, and so a system
    // wall-clock step can't make it jump.
    this.endAtMs = performance.now() + realTimeDelay(this.timeLeftSec * 1000)

    // Tick: compute passive income, run bot, update timer, and end the round when
    // its time expires. Deriving the round end from the same `endAtMs` anchor that
    // drives the displayed timer (rather than a separate one-shot `setTimeout`)
    // keeps them from drifting apart — a lagging timeout used to fire up to a
    // second after the displayed clock already showed 0:00, dwelling on 0:00.
    this.tickTimer = setInterval(() => {
      if (this.paused) return
      this.tick++
      this.timeLeftSec = Math.max(0, elapsedGameSeconds(this.endAtMs - performance.now()))

      if (this.timeLeftSec <= 0) {
        this.endRound(this.timeExpiredReason)
        return
      }

      for (let i = 0; i < this.players.length; i++) {
        this.applyPassiveIncome(this.players[i], this.players[1 - i])
      }

      // Land any active attacks whose preparation has elapsed. Runs after passive
      // income advances `meta.gameSec` (so a strike due this tick fires) and before
      // the win check (so a stolen resource is reflected in the same tick).
      this.resolveDueAttacks()

      // Bot decision (always player index 1)
      if (this.bot) {
        this.processBotActions()
      }

      this.checkTargetScoreReached()
    }, realTimeDelay(TICK_INTERVAL_MS))

    // Broadcast authoritative state to both clients
    this.broadcastTimer = setInterval(() => {
      this.broadcastState()
    }, realTimeDelay(BROADCAST_INTERVAL_MS))
  }

  /**
   * Reason reported when the round ends because its time expired.
   * Timed goals complete normally; capped goals (target-score / buy-upgrade)
   * hit their safety cap.
   */
  private get timeExpiredReason(): RoundEndReason {
    return this.goal.type === 'target-score' || this.goal.type === 'buy-upgrade'
      ? 'safety-cap'
      : 'complete'
  }

  /** Check if any player reached the target score (target-score goal only). */
  private checkTargetScoreReached(): void {
    if (this.goal.type !== 'target-score') return
    if (this.phase !== 'playing') return

    const target = this.goal.target
    const [p1, p2] = this.players
    const p1Hit = p1.state.score >= target
    const p2Hit = p2.state.score >= target

    if (p1Hit || p2Hit) {
      this.endRound('complete')
    }
  }

  // ─── Private: action processing ────────────────────────────────────

  private processActions(player: MatchPlayer, actions: PlayerAction[], seq: number): void {
    for (const action of actions) {
      if (action.type === 'click') {
        if (!isClickUnlocked(player.state, this.modeDef)) continue
        if (!isValidClick(player.recentClickTimestamps)) {
          continue
        }
        this.applyClick(player, action.resource)
      } else if (action.type === 'buy' && action.upgradeId) {
        if (!isValidPurchase(player.state, action.upgradeId, this.upgradeMap)) continue
        this.applyPurchase(player, action.upgradeId)
        if (this.checkBuyUpgradeWin(action.upgradeId, player)) break
      } else if (action.type === 'set_highlight' && action.highlight !== undefined) {
        // `null` is a real selection (release the highlight); only `undefined`
        // means the action carries none.
        applyHighlightSelection(player.state, this.modeDef, action.highlight)
      } else if (action.type === 'buy_generator' && action.generatorId) {
        if (!isValidGeneratorPurchase(player.state, action.generatorId, this.modeDef)) continue
        applyGeneratorPurchase(player.state, action.generatorId, this.modeDef)
        this.recordPurchase(player, 'generator', action.generatorId)
      } else if (action.type === 'sell_generator' && action.generatorId) {
        if (!isValidGeneratorSell(player.state, action.generatorId, this.modeDef)) continue
        applyGeneratorSell(player.state, action.generatorId, this.modeDef)
      } else if (action.type === 'activate_attack' && action.attackId) {
        if (!isValidAttackActivation(player.state, action.attackId, this.modeDef)) continue
        applyAttackActivation(player.state, action.attackId, this.modeDef)
      }
    }
    player.ackSeq = seq
  }

  /** Returns true if this purchase ended the match via trophy — caller should stop processing further actions. */
  private checkBuyUpgradeWin(upgradeId: string, buyer: MatchPlayer): boolean {
    if (this.goal.type !== 'buy-upgrade') return false
    const def = this.upgradeMap.get(upgradeId)
    if (def?.goalType !== 'buy-upgrade') return false
    const winnerIdx = this.players[0] === buyer ? 0 : 1
    this.endRound('complete', winnerIdx)
    return true
  }

  /** Run the bot strategy for player index 1 and apply its actions. */
  private processBotActions(): void {
    const botPlayer = this.players[1]
    const tickSec = TICK_INTERVAL_MS / 1000
    const actions = this.bot!.decide(botPlayer.state, tickSec)

    for (const action of actions) {
      if (action.type === 'click') {
        if (!this.modeDef.clicksEnabled) continue
        // Track timestamp for accurate peakCps stat (bot skips isValidClick rate-limiting)
        const now = Date.now()
        const cutoff = now - realTimeDelay(1000)
        while (
          botPlayer.recentClickTimestamps.length > 0 &&
          botPlayer.recentClickTimestamps[0] < cutoff
        ) {
          botPlayer.recentClickTimestamps.shift()
        }
        botPlayer.recentClickTimestamps.push(now)
        this.applyClick(botPlayer, action.resource)
      } else if (action.type === 'buy') {
        if (!isValidPurchase(botPlayer.state, action.upgradeId, this.upgradeMap)) continue
        this.applyPurchase(botPlayer, action.upgradeId)
        if (this.checkBuyUpgradeWin(action.upgradeId, botPlayer)) break
      } else if (action.type === 'buy_generator') {
        if (!isValidGeneratorPurchase(botPlayer.state, action.generatorId, this.modeDef)) continue
        applyGeneratorPurchase(botPlayer.state, action.generatorId, this.modeDef)
        this.recordPurchase(botPlayer, 'generator', action.generatorId)
      } else {
        // set_highlight — same validator as processActions, by construction now.
        applyHighlightSelection(botPlayer.state, this.modeDef, action.highlight)
      }
    }
  }

  private applyPassiveIncome(player: MatchPlayer, opponent: MatchPlayer): void {
    const tickSec = TICK_INTERVAL_MS / 1000
    // Advance the highlight battery first: its charge feeds the modifiers
    // collected below, so this tick's income must be priced off this tick's
    // charge (see `advanceHighlightBattery`).
    advanceHighlightBattery(player.state, this.modeDef, tickSec)
    // The defender's own modifiers plus the offensive debuffs the opponent's
    // unlocked passive attacks inflict (e.g. a -10% wood-production attack).
    const modifiers = [
      ...collectModifiers(player.state, this.modeDef),
      ...collectEnemyDebuffs(opponent.state, this.modeDef),
    ]
    applyPassiveTick(
      player.state,
      this.modeDef.resources,
      this.modeDef.scoreResource,
      modifiers,
      tickSec,
    )
  }

  /**
   * Land every active attack whose preparation has elapsed this tick. For each
   * player, drain the pending strikes due at their current `meta.gameSec`,
   * resolve them against the opponent (moving the stolen resources / generator
   * copies), and buffer an `outgoing`/`incoming` event pair per theft for the
   * next broadcast.
   */
  private resolveDueAttacks(): void {
    for (let i = 0; i < this.players.length; i++) {
      const attacker = this.players[i]
      const victim = this.players[1 - i]
      const gameSec = (attacker.state.meta.gameSec as number | undefined) ?? 0
      const due = dueAttacks(attacker.state, gameSec)
      if (due.length === 0) continue

      for (const pending of due) {
        const def = this.modeDef.attacks.find((a) => a.id === pending.attack)
        if (!def) continue
        const moved = resolveAttackStrike(attacker.state, victim.state, def, this.modeDef)
        for (const result of moved) {
          // The same theft, described once per side: `direction` is the only
          // field that differs between the attacker's and the victim's copy.
          const what =
            result.kind === 'resource'
              ? { kind: result.kind, resource: result.resource, amount: result.amount }
              : { kind: result.kind, generator: result.generator, count: result.count }
          attacker.attackEvents.push({
            attack: pending.attack,
            direction: 'outgoing',
            ...what,
            t: gameSec,
          })
          victim.attackEvents.push({
            attack: pending.attack,
            direction: 'incoming',
            ...what,
            t: gameSec,
          })
        }
      }

      // Drop the resolved entries (identity-matched against the drained subset).
      attacker.state.pendingAttacks = attacker.state.pendingAttacks.filter((p) => !due.includes(p))
    }
  }

  private pause(): void {
    if (this.phase !== 'playing' || this.paused) return
    this.paused = true
    // Freeze the remaining time from the monotonic anchor. The tick stops
    // advancing the clock (and ending the round) while paused.
    this.timeLeftSec = Math.max(0, elapsedGameSeconds(this.endAtMs - performance.now()))
    this.broadcastState()
  }

  private resume(): void {
    if (this.phase !== 'playing' || !this.paused) return
    this.paused = false
    if (this.timeLeftSec <= 0) {
      this.endRound(this.timeExpiredReason)
      return
    }
    // Re-anchor the round end to the remaining time; the tick resumes ending it.
    this.endAtMs = performance.now() + realTimeDelay(this.timeLeftSec * 1000)
    this.broadcastState()
  }

  private applyClick(player: MatchPlayer, resource?: string): void {
    // Update peak CPS first (recentClickTimestamps already pruned/pushed by
    // validation) and mirror it into player state so the modifier pipeline can
    // read it — e.g. a `relativeModifier` with `source: meta:peakCps` adds peak
    // CPS to click income.
    player.stats.peakCps = Math.max(player.stats.peakCps, player.recentClickTimestamps.length)
    player.state.meta.peakCps = player.stats.peakCps

    const modifiers = collectModifiers(player.state, this.modeDef)
    const income = computeClickIncome(modifiers)

    // Credit the requested resource (defaults to score); only the score resource
    // contributes to score, matching passive income.
    const res =
      resource && this.modeDef.resources.includes(resource) ? resource : this.modeDef.scoreResource
    creditResource(player.state, res, income, this.modeDef.scoreResource)
    player.stats.totalClicks++
  }

  private applyPurchase(player: MatchPlayer, upgradeId: string): void {
    applyPurchase(player.state, upgradeId, this.modeDef)
    player.stats.upgradesPurchased.push(upgradeId)
    this.recordPurchase(player, 'upgrade', upgradeId)
  }

  /**
   * Append a purchase to the player's espionage log, stamped with round-elapsed
   * game seconds (`meta.gameSec`) and a monotonic per-player `seq`. The full
   * event (kind + abstract id) is kept; `opponentViewFor` redacts it per the
   * viewer's intel tier and forwards it once. The log is then trimmed by
   * {@link Match.capPurchaseLog} (which only drops already-forwarded entries); the
   * `seq` is never reset so a viewer's watermark stays correct as entries scroll off.
   */
  private recordPurchase(player: MatchPlayer, kind: 'upgrade' | 'generator', id: string): void {
    const t = (player.state.meta.gameSec as number | undefined) ?? 0
    player.purchases.push({ t, kind, id, seq: player.purchaseSeq++ })
    this.capPurchaseLog(player)
  }

  /**
   * Trim a player's purchase log back toward {@link PURCHASE_LOG_CAP}, but never
   * drop an event the opponent viewer hasn't been shown yet. The opponent is the
   * sole viewer of this log; everything with `seq >= viewer.purchaseFeedSeq` is
   * still owed (un-forwarded), so only forwarded entries below the watermark are
   * eligible to scroll off. A `null` watermark means the viewer never unlocked
   * the feed — on unlock it seeds to the current head, so nothing here is owed
   * and the log trims freely. This lets a burst larger than the cap between two
   * broadcasts grow the log transiently rather than silently lose events; the
   * next broadcast forwards them and the following trim reclaims the slack.
   */
  private capPurchaseLog(player: MatchPlayer): void {
    const log = player.purchases
    if (log.length <= PURCHASE_LOG_CAP) return
    let dropCount = log.length - PURCHASE_LOG_CAP
    const watermark = this.opponentOf(player).purchaseFeedSeq
    if (watermark !== null) {
      // Don't trim into the un-forwarded tail (seq >= watermark).
      const firstUnforwarded = log.findIndex((p) => p.seq >= watermark)
      const droppable = firstUnforwarded === -1 ? log.length : firstUnforwarded
      dropCount = Math.min(dropCount, droppable)
    }
    if (dropCount > 0) log.splice(0, dropCount)
  }

  /** The other player — the sole viewer of `player`'s purchase log. */
  private opponentOf(player: MatchPlayer): MatchPlayer {
    return this.players[0] === player ? this.players[1] : this.players[0]
  }

  // ─── Private: broadcasting ─────────────────────────────────────────

  private broadcastState(): void {
    const [p1, p2] = this.players

    // Offensive debuffs each player's unlocked passive attacks inflict on the
    // other, sent so the victim's client can render its true (debuffed) rate —
    // matching the same debuffs `applyPassiveIncome` applies to real income.
    const p1Debuffs = collectEnemyDebuffs(p1.state, this.modeDef)
    const p2Debuffs = collectEnemyDebuffs(p2.state, this.modeDef)

    // Drain each player's pending attack events into this broadcast (delta, sent
    // once). Absent when empty so a quiet round carries no extra payload.
    const p1Attacks = p1.attackEvents.length ? p1.attackEvents : undefined
    const p2Attacks = p2.attackEvents.length ? p2.attackEvents : undefined

    this.send(p1, {
      type: 'STATE_UPDATE',
      tick: this.tick,
      ackSeq: p1.ackSeq,
      player: p1.state,
      opponent: this.opponentViewFor(p1, p2, p1Debuffs),
      debuffs: p2Debuffs,
      attackEvents: p1Attacks,
      timeLeft: this.timeLeftSec,
      paused: this.paused,
    })

    this.send(p2, {
      type: 'STATE_UPDATE',
      tick: this.tick,
      ackSeq: p2.ackSeq,
      player: p2.state,
      opponent: this.opponentViewFor(p2, p1, p2Debuffs),
      debuffs: p1Debuffs,
      attackEvents: p2Attacks,
      timeLeft: this.timeLeftSec,
      paused: this.paused,
    })

    p1.attackEvents = []
    p2.attackEvents = []
  }

  /**
   * Build the redacted opponent view for `viewer`: only the intel `viewer` has
   * unlocked via `accessEnemyData`. The opponent's upgrades/generators/meta are
   * never included, so a client can't read hidden data in devtools. Per-second
   * rates are computed here (the client can no longer derive them without the
   * opponent's full state) and included only for unlocked keys.
   *
   * Score is public for timed / target-score goals (it's the win condition and
   * shown live), and omitted for `buy-upgrade`, where it isn't shown.
   *
   * `viewerDebuffs` are the offensive modifiers `viewer` inflicts on `opponent`
   * (already computed by the caller for the `debuffs` field); folding them into
   * the spied rate makes it match the opponent's real, debuffed production.
   */
  private opponentViewFor(
    viewer: MatchPlayer,
    opponent: MatchPlayer,
    viewerDebuffs: Modifier[],
  ): OpponentView {
    const mode = this.modeDef
    const view: OpponentView = { resources: {}, rates: {} }

    if (this.goal.type !== 'buy-upgrade') view.score = opponent.state.score

    let rates: Record<string, number> | null = null
    for (const key of mode.resources) {
      const [amountKey, rateKey] = enemyDataKeysFor(key)
      if (hasEnemyDataAccess(viewer.state, mode, amountKey)) {
        view.resources[key] = opponent.state.resources[key] ?? 0
      }
      if (hasEnemyDataAccess(viewer.state, mode, rateKey)) {
        // Include the debuffs the *viewer* inflicts on the opponent so the spied
        // rate matches the opponent's real production, not an undebuffed figure.
        rates ??= computePassiveRates(
          [...collectModifiers(opponent.state, mode), ...viewerDebuffs],
          mode.resources,
        )
        view.rates[key] = rates[key] ?? 0
      }
    }

    if (hasEnemyDataAccess(viewer.state, mode, ENEMY_DATA_CPS_KEY)) {
      const cps = opponent.state.meta.peakCps
      view.peakCps = typeof cps === 'number' ? cps : 0
    }

    if (hasEnemyDataAccess(viewer.state, mode, ENEMY_DATA_PURCHASES_KEY)) {
      this.projectPurchaseFeed(viewer, opponent, view)
    }

    return view
  }

  /**
   * Forward the opponent's *new* purchases to `viewer`'s espionage feed — each
   * event exactly once. The viewer accumulates the feed client-side, so we send
   * only events past their watermark rather than re-sending the whole log.
   *
   * The first time the feed is accessed (`purchaseFeedSeq === null`), the
   * watermark is seeded to the opponent's current head and nothing is emitted —
   * this is what makes the feed non-retroactive: purchases made before the
   * viewer unlocked are never revealed, with no clock comparison. Thereafter
   * only `seq >= watermark` events are sent, redacted per the viewer's intel tier
   * (see {@link redactPurchase}), and the watermark advances to the head. The
   * delta is attached only when non-empty, so a steady state with no new
   * purchases carries no `purchases` field at all.
   */
  private projectPurchaseFeed(
    viewer: MatchPlayer,
    opponent: MatchPlayer,
    view: OpponentView,
  ): void {
    const head = opponent.purchaseSeq // next seq to be assigned == one past the latest
    if (viewer.purchaseFeedSeq === null) {
      viewer.purchaseFeedSeq = head
      return
    }
    const watermark = viewer.purchaseFeedSeq
    if (head === watermark) return
    const mode = this.modeDef
    const showKind = hasEnemyDataAccess(viewer.state, mode, ENEMY_DATA_PURCHASE_KIND_KEY)
    const showUpgradeId = hasEnemyDataAccess(viewer.state, mode, ENEMY_DATA_PURCHASE_UPGRADE_KEY)
    const showGeneratorId = hasEnemyDataAccess(
      viewer.state,
      mode,
      ENEMY_DATA_PURCHASE_GENERATOR_KEY,
    )
    const delta = opponent.purchases
      .filter((p) => p.seq >= watermark)
      .map((p) => redactPurchase(p, showKind, showUpgradeId, showGeneratorId))
    viewer.purchaseFeedSeq = head
    if (delta.length > 0) view.purchases = delta
  }

  /**
   * Final scores for a ROUND_END message addressed to the player whose score is
   * `playerScore`. The opponent's score is omitted for `buy-upgrade` goals, where
   * it's irrelevant to the result and never revealed.
   */
  private finalScoresFor(
    playerScore: number,
    opponentScore: number,
  ): { player: number; opponent?: number } {
    return this.goal.type === 'buy-upgrade'
      ? { player: playerScore }
      : { player: playerScore, opponent: opponentScore }
  }

  // ─── Private: ending ───────────────────────────────────────────────

  private endRound(reason: RoundEndReason = 'complete', winnerPlayerIdx?: 0 | 1): void {
    if (this.phase === 'ended') return
    this.phase = 'ended'
    this.clearTimers()

    const [p1, p2] = this.players
    // Discard any attacks still preparing — the round is over, so they never land.
    p1.state.pendingAttacks = []
    p2.state.pendingAttacks = []
    let winnerForP1: MatchWinner
    let winnerForP2: MatchWinner
    if (winnerPlayerIdx !== undefined) {
      // Explicit winner override (e.g., buy-upgrade trophy purchase).
      winnerForP1 = winnerPlayerIdx === 0 ? 'player' : 'opponent'
      winnerForP2 = winnerPlayerIdx === 1 ? 'player' : 'opponent'
    } else {
      // Score-based derivation (timed, target-score, buy-upgrade safety-cap).
      const tie = p1.state.score === p2.state.score
      const p1Wins = p1.state.score > p2.state.score
      winnerForP1 = tie ? 'draw' : p1Wins ? 'player' : 'opponent'
      winnerForP2 = tie ? 'draw' : p1Wins ? 'opponent' : 'player'
    }

    this.send(p1, {
      type: 'ROUND_END',
      winner: winnerForP1,
      reason,
      finalScores: this.finalScoresFor(p1.state.score, p2.state.score),
      stats: p1.stats,
    })

    this.send(p2, {
      type: 'ROUND_END',
      winner: winnerForP2,
      reason,
      finalScores: this.finalScoresFor(p2.state.score, p1.state.score),
      stats: p2.stats,
    })

    this.onEndCallback?.()
  }

  private forfeit(playerId: string): void {
    if (this.phase === 'ended') return
    this.phase = 'ended'
    this.clearTimers()

    const winnerIdx = this.players[0].id === playerId ? 1 : 0
    const winner = this.players[winnerIdx]
    const loser = this.players[1 - winnerIdx]

    this.send(winner, {
      type: 'ROUND_END',
      winner: 'player',
      reason: 'forfeit',
      finalScores: this.finalScoresFor(winner.state.score, loser.state.score),
      stats: winner.stats,
    })

    this.onEndCallback?.()
  }

  private clearTimers(): void {
    if (this.tickTimer) clearInterval(this.tickTimer)
    if (this.broadcastTimer) clearInterval(this.broadcastTimer)
    this.tickTimer = null
    this.broadcastTimer = null
  }

  // ─── Private: send ─────────────────────────────────────────────────

  private send(player: MatchPlayer, msg: ServerMessage): void {
    if (player.ws?.readyState === WebSocket.OPEN) {
      player.ws.send(JSON.stringify(msg))
    }
  }
}
