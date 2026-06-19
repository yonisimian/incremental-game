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
  computeClickIncome,
  applyPassiveTick,
  applyPurchase,
  applyGeneratorPurchase,
  isClickUnlocked,
  isHighlightActive,
} from '@game/shared'
import type {
  ClientMessage,
  GameMode,
  Goal,
  MatchWinner,
  ModeDefinition,
  PlayerAction,
  PlayerState,
  RoundEndReason,
  ServerMessage,
  UpgradeDefinition,
  GeneratorDefinition,
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
}

type MatchPhase = 'countdown' | 'playing' | 'ended'

// ─── Match ───────────────────────────────────────────────────────────

export class Match {
  readonly id: string
  readonly mode: GameMode
  readonly goal: Goal
  private readonly modeDef: ModeDefinition
  private readonly availableUpgrades: readonly UpgradeDefinition[]
  private readonly upgradeMap: ReadonlyMap<string, UpgradeDefinition>
  private readonly generatorMap: ReadonlyMap<string, GeneratorDefinition>
  private readonly players: [MatchPlayer, MatchPlayer]
  private readonly bot: BotStrategy | null
  private phase: MatchPhase = 'countdown'
  private tick = 0
  private timeLeftSec: number
  /** Wall-clock timestamp (ms) at which the current round ends; source of truth for the timer. */
  private endAtMs = 0

  private tickTimer: ReturnType<typeof setInterval> | null = null
  private broadcastTimer: ReturnType<typeof setInterval> | null = null
  private roundTimer: ReturnType<typeof setTimeout> | null = null
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
    this.generatorMap = new Map(this.modeDef.generators.map((g) => [g.id, g]))
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
      finalScores: { player: quitter.state.score, opponent: opponent.state.score },
      stats: quitter.stats,
    })

    this.send(opponent, {
      type: 'ROUND_END',
      winner: 'player',
      reason: 'quit',
      finalScores: { player: opponent.state.score, opponent: quitter.state.score },
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
    }
  }

  // ─── Private: game loop ────────────────────────────────────────────

  private beginGameLoop(): void {
    // Anchor the round end to a wall-clock timestamp so the displayed timer can
    // never drift away from the authoritative round-end timeout.
    this.endAtMs = Date.now() + this.timeLeftSec * 1000

    // Tick: compute passive income, run bot, update timer
    this.tickTimer = setInterval(() => {
      if (this.paused) return
      this.tick++
      this.timeLeftSec = Math.max(0, (this.endAtMs - Date.now()) / 1000)

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

    // End the round after the full duration (timed) or safety cap (target-score / buy-upgrade)
    this.scheduleRoundEnd(this.timeLeftSec * 1000)
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

  /** (Re)arm the round-end timeout to fire after the given delay. */
  private scheduleRoundEnd(delayMs: number): void {
    this.roundTimer = setTimeout(() => {
      this.endRound(this.timeExpiredReason)
    }, delayMs)
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
        if (!isValidGeneratorPurchase(player.state, action.generatorId, this.generatorMap)) continue
        applyGeneratorPurchase(player.state, action.generatorId, this.modeDef)
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
    // Freeze the remaining time from the wall-clock anchor before stopping the timer.
    this.timeLeftSec = Math.max(0, (this.endAtMs - Date.now()) / 1000)
    if (this.roundTimer) {
      clearTimeout(this.roundTimer)
      this.roundTimer = null
    }
    this.broadcastState()
  }

  private resume(): void {
    if (this.phase !== 'playing' || !this.paused) return
    this.paused = false
    if (this.timeLeftSec <= 0) {
      this.endRound(this.timeExpiredReason)
      return
    }
    // Re-anchor the round end to the remaining time and re-arm the timeout.
    this.endAtMs = Date.now() + this.timeLeftSec * 1000
    this.scheduleRoundEnd(this.timeLeftSec * 1000)
    this.broadcastState()
  }

  private applyClick(player: MatchPlayer, resource?: string): void {
    const modifiers = collectModifiers(player.state, this.modeDef)
    const income = computeClickIncome(modifiers)

    // Credit the requested resource (defaults to score); only the score resource
    // contributes to score, matching passive income.
    const res =
      resource && this.modeDef.resources.includes(resource) ? resource : this.modeDef.scoreResource
    player.state.resources[res] = (player.state.resources[res] ?? 0) + income
    if (res === this.modeDef.scoreResource) player.state.score += income
    player.stats.totalClicks++

    // Update peak CPS (recentClickTimestamps already pruned by validation)
    player.stats.peakCps = Math.max(player.stats.peakCps, player.recentClickTimestamps.length)
  }

  private applyPurchase(player: MatchPlayer, upgradeId: string): void {
    applyPurchase(player.state, upgradeId, this.modeDef)
    player.stats.upgradesPurchased.push(upgradeId)
  }

  // ─── Private: broadcasting ─────────────────────────────────────────

  private broadcastState(): void {
    const [p1, p2] = this.players

    this.send(p1, {
      type: 'STATE_UPDATE',
      tick: this.tick,
      ackSeq: p1.ackSeq,
      player: p1.state,
      opponent: p2.state,
      timeLeft: this.timeLeftSec,
      paused: this.paused,
    })

    this.send(p2, {
      type: 'STATE_UPDATE',
      tick: this.tick,
      ackSeq: p2.ackSeq,
      player: p2.state,
      opponent: p1.state,
      timeLeft: this.timeLeftSec,
      paused: this.paused,
    })
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
      finalScores: { player: p1.state.score, opponent: p2.state.score },
      stats: p1.stats,
    })

    this.send(p2, {
      type: 'ROUND_END',
      winner: winnerForP2,
      reason,
      finalScores: { player: p2.state.score, opponent: p1.state.score },
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
      finalScores: { player: winner.state.score, opponent: loser.state.score },
      stats: winner.stats,
    })

    this.onEndCallback?.()
  }

  private clearTimers(): void {
    if (this.tickTimer) clearInterval(this.tickTimer)
    if (this.broadcastTimer) clearInterval(this.broadcastTimer)
    if (this.roundTimer) clearTimeout(this.roundTimer)
    this.tickTimer = null
    this.broadcastTimer = null
    this.roundTimer = null
  }

  // ─── Private: send ─────────────────────────────────────────────────

  private send(player: MatchPlayer, msg: ServerMessage): void {
    if (player.ws?.readyState === WebSocket.OPEN) {
      player.ws.send(JSON.stringify(msg))
    }
  }
}
