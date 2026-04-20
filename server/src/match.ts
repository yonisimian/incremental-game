import { randomUUID } from 'node:crypto'
import WebSocket from 'ws'
import {
  BROADCAST_INTERVAL_MS,
  COUNTDOWN_SEC,
  INITIAL_PLAYER_STATE,
  MODE_CONFIGS,
  TICK_INTERVAL_MS,
  applyIdlerPassiveIncome,
  applyIdlerPurchase,
  getDefaultGoal,
} from '@game/shared'
import type {
  ClientMessage,
  GameMode,
  Goal,
  MatchWinner,
  ModeConfig,
  PlayerAction,
  PlayerState,
  RoundEndReason,
  ServerMessage,
  UpgradeDefinition,
  UpgradeId,
} from '@game/shared'
import { isValidClick, isValidPurchase } from './validation.js'

// ─── Types ───────────────────────────────────────────────────────────

interface MatchPlayer {
  readonly id: string
  ws: WebSocket | null
  state: PlayerState
  ackSeq: number
  recentClickTimestamps: number[]
  stats: {
    totalClicks: number
    peakCps: number
    upgradesPurchased: UpgradeId[]
  }
}

type MatchPhase = 'countdown' | 'playing' | 'ended'

// ─── Match ───────────────────────────────────────────────────────────

export class Match {
  readonly id: string
  readonly mode: GameMode
  readonly goal: Goal
  private readonly modeConfig: ModeConfig
  private readonly upgradeMap: ReadonlyMap<UpgradeId, UpgradeDefinition>
  private readonly players: [MatchPlayer, MatchPlayer]
  private phase: MatchPhase = 'countdown'
  private tick = 0
  private timeLeftSec: number

  private tickTimer: ReturnType<typeof setInterval> | null = null
  private broadcastTimer: ReturnType<typeof setInterval> | null = null
  private roundTimer: ReturnType<typeof setTimeout> | null = null
  private onEndCallback: (() => void) | null = null

  constructor(
    p1: { id: string; ws: WebSocket },
    p2: { id: string; ws: WebSocket },
    mode: GameMode,
    goal?: Goal,
  ) {
    this.id = randomUUID()
    this.mode = mode
    this.goal = goal ?? getDefaultGoal(mode)
    this.modeConfig = MODE_CONFIGS[mode]
    this.timeLeftSec = this.goal.type === 'timed' ? this.goal.durationSec : this.goal.safetyCapSec
    this.upgradeMap = new Map(this.modeConfig.upgrades.map((u) => [u.id, u]))
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

  /** Send ROUND_START to both, then begin the game loop after countdown. */
  start(): void {
    const config = {
      mode: this.mode,
      goal: this.goal,
      upgrades: [...this.modeConfig.upgrades],
    }

    for (const player of this.players) {
      this.send(player, {
        type: 'ROUND_START',
        matchId: this.id,
        config,
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

    if (msg.type === 'ACTION_BATCH') {
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
   * TODO: implement 10s grace period per DESIGN.md — currently forfeits immediately.
   */
  handleDisconnect(playerId: string): void {
    if (this.phase === 'ended') return

    const player = this.players.find((p) => p.id === playerId)
    if (player) player.ws = null

    this.forfeit(playerId)
  }

  // ─── Private: setup ────────────────────────────────────────────────

  private initPlayer(p: { id: string; ws: WebSocket }): MatchPlayer {
    const base: MatchPlayer = {
      id: p.id,
      ws: p.ws,
      state: {
        score: INITIAL_PLAYER_STATE.score,
        currency: INITIAL_PLAYER_STATE.currency,
        upgrades: { ...INITIAL_PLAYER_STATE.upgrades },
      },
      ackSeq: 0,
      recentClickTimestamps: [],
      stats: { totalClicks: 0, peakCps: 0, upgradesPurchased: [] },
    }

    if (this.mode === 'idler') {
      base.state.wood = 0
      base.state.ale = 0
      base.state.highlight = 'wood'
    }

    return base
  }

  // ─── Private: game loop ────────────────────────────────────────────

  private beginGameLoop(): void {
    const startTime = Date.now()
    const durationSec = this.goal.type === 'timed' ? this.goal.durationSec : this.goal.safetyCapSec

    // Tick: compute passive income + update timer
    this.tickTimer = setInterval(() => {
      this.tick++
      const elapsedSec = (Date.now() - startTime) / 1000
      this.timeLeftSec = Math.max(0, durationSec - elapsedSec)

      for (const player of this.players) {
        this.applyPassiveIncome(player)
      }

      this.checkTargetScoreReached()
    }, TICK_INTERVAL_MS)

    // Broadcast authoritative state to both clients
    this.broadcastTimer = setInterval(() => {
      this.broadcastState()
    }, BROADCAST_INTERVAL_MS)

    // End the round after the full duration (timed) or safety cap (target-score)
    this.roundTimer = setTimeout(() => {
      if (this.goal.type === 'target-score') {
        this.endRound('safety-cap')
      } else {
        this.endRound('complete')
      }
    }, durationSec * 1000)
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
        if (!this.modeConfig.clicksEnabled) continue
        if (!isValidClick(player.recentClickTimestamps)) {
          continue
        }
        this.applyClick(player)
      } else if (action.type === 'buy' && action.upgradeId) {
        if (!isValidPurchase(player.state, action.upgradeId, this.upgradeMap)) continue
        this.applyPurchase(player, action.upgradeId)
      } else if (action.type === 'set_highlight' && action.highlight) {
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (this.mode === 'idler' && (action.highlight === 'wood' || action.highlight === 'ale')) {
          player.state.highlight = action.highlight
        }
      }
    }
    player.ackSeq = seq
  }

  private applyPassiveIncome(player: MatchPlayer): void {
    const tickSec = TICK_INTERVAL_MS / 1000

    if (this.mode === 'idler') {
      applyIdlerPassiveIncome(player.state, tickSec)
      return
    }

    // ── Clicker passive income ───────────────────────────────────
    let income = this.modeConfig.basePassivePerSec * tickSec

    if (player.state.upgrades['auto-clicker']) {
      income += tickSec
    }

    if (player.state.upgrades.multiplier) income *= 2

    if (income <= 0) return

    player.state.currency += income
    player.state.score += income
  }

  private applyClick(player: MatchPlayer): void {
    let income = player.state.upgrades['double-click'] ? 2 : 1
    if (player.state.upgrades.multiplier) income *= 2

    player.state.currency += income
    player.state.score += income
    player.stats.totalClicks++

    // Update peak CPS (recentClickTimestamps already pruned by validation)
    player.stats.peakCps = Math.max(player.stats.peakCps, player.recentClickTimestamps.length)
  }

  private applyPurchase(player: MatchPlayer, upgradeId: UpgradeId): void {
    if (this.mode === 'idler') {
      applyIdlerPurchase(player.state, upgradeId)
    } else {
      // Clicker: deduct from generic currency
      const def = this.upgradeMap.get(upgradeId)! // already validated
      player.state.currency -= def.cost
      player.state.upgrades[upgradeId] = true
    }

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
    })

    this.send(p2, {
      type: 'STATE_UPDATE',
      tick: this.tick,
      ackSeq: p2.ackSeq,
      player: p2.state,
      opponent: p1.state,
      timeLeft: this.timeLeftSec,
    })
  }

  // ─── Private: ending ───────────────────────────────────────────────

  private endRound(reason: RoundEndReason = 'complete'): void {
    if (this.phase === 'ended') return
    this.phase = 'ended'
    this.clearTimers()

    const [p1, p2] = this.players
    const tie = p1.state.score === p2.state.score
    const p1Wins = p1.state.score > p2.state.score
    const winnerForP1: MatchWinner = tie ? 'draw' : p1Wins ? 'player' : 'opponent'
    const winnerForP2: MatchWinner = tie ? 'draw' : p1Wins ? 'opponent' : 'player'

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
