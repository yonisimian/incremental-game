import { randomUUID } from 'node:crypto'
import WebSocket from 'ws'
import {
  BROADCAST_INTERVAL_MS,
  COUNTDOWN_SEC,
  TICK_INTERVAL_MS,
  getAvailableUpgrades,
  getDefaultGoal,
  getModeDefinition,
  createInitialState,
  collectModifiers,
  computePassiveRates,
  computeClickIncome,
  applyPassiveTick,
  applyPurchase,
  applyGeneratorPurchase,
  hasEnemyDataAccess,
  enemyDataKeysFor,
  ENEMY_DATA_CPS_KEY,
  ENEMY_DATA_PURCHASES_KEY,
  ENEMY_DATA_PURCHASE_KIND_KEY,
  ENEMY_DATA_PURCHASE_UPGRADE_KEY,
  ENEMY_DATA_PURCHASE_GENERATOR_KEY,
  isClickUnlocked,
  isHighlightActive,
} from '@game/shared'
import type {
  ClientMessage,
  GameMode,
  Goal,
  MatchWinner,
  ModeDefinition,
  OpponentView,
  PlayerAction,
  PurchaseEvent,
  PlayerState,
  RoundEndReason,
  ServerMessage,
  UpgradeDefinition,
} from '@game/shared'
import { isValidClick, isValidPurchase, isValidGeneratorPurchase } from './validation.js'
import type { BotStrategy } from './bot.js'

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
}

/** A purchase log entry: the wire {@link PurchaseEvent} plus its server-internal seq. */
interface LoggedPurchase extends PurchaseEvent {
  /** Monotonic per-player sequence; stable across log capping (unlike an index). */
  seq: number
}

type MatchPhase = 'countdown' | 'playing' | 'ended'

/**
 * Most recent purchases retained per player. Events are forwarded to a viewer's
 * feed once (delta), so this only needs to outlive one broadcast interval; the
 * cap bounds memory for a viewer that never unlocks the feed. Older events
 * scroll off, but the monotonic `seq` keeps the per-viewer watermark correct.
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
      player.state.resources[res] = (player.state.resources[res] ?? 0) + amount
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
    }
  }

  // ─── Private: game loop ────────────────────────────────────────────

  private beginGameLoop(): void {
    // Anchor the round end to a monotonic timestamp so the displayed timer can
    // never drift away from the authoritative round-end check, and so a system
    // wall-clock step can't make it jump.
    this.endAtMs = performance.now() + this.timeLeftSec * 1000

    // Tick: compute passive income, run bot, update timer, and end the round when
    // its time expires. Deriving the round end from the same `endAtMs` anchor that
    // drives the displayed timer (rather than a separate one-shot `setTimeout`)
    // keeps them from drifting apart — a lagging timeout used to fire up to a
    // second after the displayed clock already showed 0:00, dwelling on 0:00.
    this.tickTimer = setInterval(() => {
      if (this.paused) return
      this.tick++
      this.timeLeftSec = Math.max(0, (this.endAtMs - performance.now()) / 1000)

      if (this.timeLeftSec <= 0) {
        this.endRound(this.timeExpiredReason)
        return
      }

      for (const player of this.players) {
        this.applyPassiveIncome(player)
      }

      // Bot decision (always player index 1)
      if (this.bot) {
        this.processBotActions()
      }

      this.checkTargetScoreReached()
    }, TICK_INTERVAL_MS)

    // Broadcast authoritative state to both clients
    this.broadcastTimer = setInterval(() => {
      this.broadcastState()
    }, BROADCAST_INTERVAL_MS)
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
      } else if (action.type === 'set_highlight' && action.highlight) {
        if (
          isHighlightActive(player.state, this.modeDef) &&
          this.modeDef.resources.includes(action.highlight)
        ) {
          player.state.meta.highlight = action.highlight
        }
      } else if (action.type === 'buy_generator' && action.generatorId) {
        if (!isValidGeneratorPurchase(player.state, action.generatorId, this.modeDef)) continue
        applyGeneratorPurchase(player.state, action.generatorId, this.modeDef)
        this.recordPurchase(player, 'generator', action.generatorId)
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
        const cutoff = now - 1000
        while (
          botPlayer.recentClickTimestamps.length > 0 &&
          botPlayer.recentClickTimestamps[0] < cutoff
        ) {
          botPlayer.recentClickTimestamps.shift()
        }
        botPlayer.recentClickTimestamps.push(now)
        this.applyClick(botPlayer)
      } else if (action.type === 'buy') {
        if (!isValidPurchase(botPlayer.state, action.upgradeId, this.upgradeMap)) continue
        this.applyPurchase(botPlayer, action.upgradeId)
        if (this.checkBuyUpgradeWin(action.upgradeId, botPlayer)) break
      } else {
        // set_highlight — validate identically to processActions
        if (
          isHighlightActive(botPlayer.state, this.modeDef) &&
          this.modeDef.resources.includes(action.highlight)
        ) {
          botPlayer.state.meta.highlight = action.highlight
        }
      }
    }
  }

  private applyPassiveIncome(player: MatchPlayer): void {
    const tickSec = TICK_INTERVAL_MS / 1000
    const modifiers = collectModifiers(player.state, this.modeDef)
    applyPassiveTick(
      player.state,
      this.modeDef.resources,
      this.modeDef.scoreResource,
      modifiers,
      tickSec,
    )
  }

  private pause(): void {
    if (this.phase !== 'playing' || this.paused) return
    this.paused = true
    // Freeze the remaining time from the monotonic anchor. The tick stops
    // advancing the clock (and ending the round) while paused.
    this.timeLeftSec = Math.max(0, (this.endAtMs - performance.now()) / 1000)
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
    this.endAtMs = performance.now() + this.timeLeftSec * 1000
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
    player.state.resources[res] = (player.state.resources[res] ?? 0) + income
    if (res === this.modeDef.scoreResource) player.state.score += income
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
   * viewer's intel tier and forwards it once. Capped to the most recent
   * {@link PURCHASE_LOG_CAP} entries; the `seq` is never reset so a viewer's
   * watermark stays correct even after old entries scroll off.
   */
  private recordPurchase(player: MatchPlayer, kind: 'upgrade' | 'generator', id: string): void {
    const t = (player.state.meta.gameSec as number | undefined) ?? 0
    player.purchases.push({ t, kind, id, seq: player.purchaseSeq++ })
    if (player.purchases.length > PURCHASE_LOG_CAP) {
      player.purchases.splice(0, player.purchases.length - PURCHASE_LOG_CAP)
    }
  }

  // ─── Private: broadcasting ─────────────────────────────────────────

  private broadcastState(): void {
    const [p1, p2] = this.players

    this.send(p1, {
      type: 'STATE_UPDATE',
      tick: this.tick,
      ackSeq: p1.ackSeq,
      player: p1.state,
      opponent: this.opponentViewFor(p1, p2),
      timeLeft: this.timeLeftSec,
      paused: this.paused,
    })

    this.send(p2, {
      type: 'STATE_UPDATE',
      tick: this.tick,
      ackSeq: p2.ackSeq,
      player: p2.state,
      opponent: this.opponentViewFor(p2, p1),
      timeLeft: this.timeLeftSec,
      paused: this.paused,
    })
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
   */
  private opponentViewFor(viewer: MatchPlayer, opponent: MatchPlayer): OpponentView {
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
        rates ??= computePassiveRates(collectModifiers(opponent.state, mode), mode.resources)
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
   * only `seq > watermark` events are sent, redacted per the viewer's intel tier
   * (see {@link redactPurchase}), and the watermark advances to the head.
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
    view.purchases = opponent.purchases
      .filter((p) => p.seq >= watermark)
      .map((p) => redactPurchase(p, showKind, showUpgradeId, showGeneratorId))
    viewer.purchaseFeedSeq = head
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
