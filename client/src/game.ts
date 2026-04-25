import {
  type GameMode,
  type Goal,
  type PlayerState,
  type RoundEndMessage,
  type RoundStartMessage,
  type ServerMessage,
  type StateUpdateMessage,
  type UpgradeDefinition,
  COUNTDOWN_SEC,
  MILESTONE_INTERVAL,
  createInitialState,
  getModeDefinition,
  collectModifiers,
  computeClickIncome as pipelineClickIncome,
} from '@game/shared'
import {
  getSeq,
  queueAction,
  resetSeq,
  sendModeSelect,
  sendQuit,
  sendBotRequest,
} from './network.js'
import {
  spawnClickPopup,
  spawnClickRipple,
  pulseClickButton,
  trackCombo,
  flashPurchase,
  shakeScreen,
  resetCombo,
  shockwave,
} from './ui/vfx/index.js'

// ─── Types ───────────────────────────────────────────────────────────

export type Screen =
  | 'lobby' // connected, choosing game mode
  | 'waiting' // in queue, looking for opponent
  | 'countdown' // matched, counting down 3-2-1
  | 'playing' // active round
  | 'ended' // round finished, showing results

export interface GameState {
  screen: Screen
  /** Selected game mode. */
  mode: GameMode | null
  /** Selected win condition for this round. */
  goal: Goal | null
  /** Local player state (optimistic). */
  player: PlayerState
  /** Opponent state (from server). */
  opponent: PlayerState
  /** Seconds remaining this round. */
  timeLeft: number
  /** Current match ID. */
  matchId: string | null
  /** Upgrade definitions for this round. */
  upgrades: readonly UpgradeDefinition[]
  /** Countdown value (3, 2, 1, GO). */
  countdown: number
  /** End-of-round data. */
  endData: RoundEndMessage | null
}

/** Pending actions whose seq > ackSeq (for optimistic reconciliation). */
interface PendingBatch {
  seq: number
  clicks: number
  purchases: string[]
  highlight?: string
}

export type StateChangeHandler = (state: Readonly<GameState>) => void

// ─── State ───────────────────────────────────────────────────────────

const EMPTY_PLAYER_STATE: PlayerState = {
  score: 0,
  resources: {},
  upgrades: {},
  meta: {},
}

const state: GameState = {
  screen: 'lobby',
  mode: null,
  goal: null,
  player: clonePlayerState(EMPTY_PLAYER_STATE),
  opponent: clonePlayerState(EMPTY_PLAYER_STATE),
  timeLeft: 0,
  matchId: null,
  upgrades: [],
  countdown: COUNTDOWN_SEC,
  endData: null,
}

const pendingBatches: PendingBatch[] = []
let onChange: StateChangeHandler = () => {}
let countdownTimer: ReturnType<typeof setInterval> | null = null

/** Tracks the highest milestone tier we already fired a shockwave for (0 = none). */
let lastFiredMilestoneTier = 0

// ─── Public API ──────────────────────────────────────────────────────

/** Subscribe to state changes. */
export function setStateChangeHandler(handler: StateChangeHandler): void {
  onChange = handler
}

/** Get the current game state (read-only snapshot). */
export function getState(): Readonly<GameState> {
  return state
}

/** Handle an incoming server message. Called by network.ts. */
export function handleServerMessage(msg: ServerMessage): void {
  switch (msg.type) {
    case 'ROUND_START':
      handleRoundStart(msg)
      break
    case 'STATE_UPDATE':
      handleStateUpdate(msg)
      break
    case 'ROUND_END':
      handleRoundEnd(msg)
      break
  }
}

/** Select a game mode and goal, then enter matchmaking. */
export function selectMode(mode: GameMode, goal: Goal): void {
  if (state.screen !== 'lobby') return
  if (!sendModeSelect(mode, goal)) return // not connected — stay on lobby
  state.mode = mode
  state.goal = goal
  state.screen = 'waiting'
  notify()
}

/** Record a click action (optimistic). Clicker mode only. */
export function doClick(): void {
  if (state.screen !== 'playing') return
  if (!state.mode) return
  const modeDef = getModeDefinition(state.mode)
  if (!modeDef.clicksEnabled) return

  // Optimistic local update
  const income = computeClickIncome(state.player)
  state.player.score += income
  state.player.resources[modeDef.scoreResource] =
    (state.player.resources[modeDef.scoreResource] ?? 0) + income

  // Visual effects
  spawnClickPopup(income)
  spawnClickRipple()
  pulseClickButton()
  trackCombo()

  checkMilestone()

  // Queue for server
  queueAction({ type: 'click', timestamp: Date.now() })
  trackPendingClick()
  notify()
}

/** Set the highlighted currency (idler mode, optimistic). */
export function setHighlight(target: string): void {
  if (state.screen !== 'playing') return
  if (!state.mode) return
  const modeDef = getModeDefinition(state.mode)
  if (!('highlight' in modeDef.initialMeta)) return
  if (!modeDef.resources.includes(target)) return
  if (state.player.meta.highlight === target) return

  state.player.meta.highlight = target
  queueAction({ type: 'set_highlight', timestamp: Date.now(), highlight: target })
  trackPendingHighlight(target)
  notify()
}

/** Attempt to purchase an upgrade (optimistic). */
export function doBuy(upgradeId: string): void {
  if (state.screen !== 'playing') return
  if (!state.mode) return

  const def = state.upgrades.find((u) => u.id === upgradeId)
  if (!def) return

  // One-shot upgrades can only be purchased once
  if (!def.repeatable && (state.player.upgrades[upgradeId] ?? 0) > 0) return

  // Check correct resource balance
  const modeDef = getModeDefinition(state.mode)
  const costResource = def.costCurrency ?? modeDef.scoreResource
  const balance = state.player.resources[costResource] ?? 0
  if (balance < def.cost) return
  state.player.resources[costResource] = balance - def.cost

  grantUpgrade(state.player, upgradeId)

  // Visual effects
  flashPurchase(upgradeId)
  shakeScreen('heavy')

  // Queue for server
  queueAction({ type: 'buy', timestamp: Date.now(), upgradeId })
  trackPendingPurchase(upgradeId)
  notify()
}

/** Cancel matchmaking queue and return to lobby. */
export function cancelQueue(): void {
  if (state.screen !== 'waiting') return
  sendQuit()
  resetForMatch()
}

/** Request a bot opponent while waiting in queue. */
export function requestBot(): void {
  if (state.screen !== 'waiting') return
  sendBotRequest()
}

/** Voluntarily quit the current match and return to lobby. */
export function quitMatch(): void {
  if (state.screen !== 'playing' && state.screen !== 'countdown') return
  sendQuit()
  resetForMatch()
}

/** Reset for a fresh match (e.g., rematch). */
export function resetForMatch(): void {
  resetCombo()
  lastFiredMilestoneTier = 0
  state.screen = 'lobby'
  state.mode = null
  state.goal = null
  state.player = clonePlayerState(EMPTY_PLAYER_STATE)
  state.opponent = clonePlayerState(EMPTY_PLAYER_STATE)
  state.timeLeft = 0
  state.matchId = null
  state.upgrades = []
  state.countdown = COUNTDOWN_SEC
  state.endData = null
  pendingBatches.length = 0
  resetSeq()
  stopCountdown()
  notify()
}

/** Fire milestone shockwave if current score has crossed a new milestone tier. */
function checkMilestone(): void {
  const tier = Math.floor(state.player.score / MILESTONE_INTERVAL)
  if (tier > lastFiredMilestoneTier) {
    lastFiredMilestoneTier = tier
    shockwave(`${tier * MILESTONE_INTERVAL}!`)
  }
}

// ─── Private: message handlers ───────────────────────────────────────

function handleRoundStart(msg: RoundStartMessage): void {
  state.screen = 'countdown'
  state.matchId = msg.matchId
  state.mode = msg.config.mode
  state.goal = msg.config.goal
  state.upgrades = msg.config.upgrades
  const modeDef = getModeDefinition(msg.config.mode)
  state.player = createInitialState(modeDef)
  state.opponent = createInitialState(modeDef)
  state.timeLeft =
    msg.config.goal.type === 'timed' ? msg.config.goal.durationSec : msg.config.goal.safetyCapSec
  state.countdown = COUNTDOWN_SEC
  state.endData = null
  pendingBatches.length = 0
  lastFiredMilestoneTier = 0
  resetSeq()
  notify()

  startCountdown()
}

function handleStateUpdate(msg: StateUpdateMessage): void {
  // Server state is authoritative — reconcile with pending optimistic actions
  state.opponent = msg.opponent
  state.timeLeft = msg.timeLeft

  // Prune acknowledged batches
  while (pendingBatches.length > 0 && pendingBatches[0].seq <= msg.ackSeq) {
    pendingBatches.shift()
  }

  // Start from server state, then re-apply pending optimistic actions
  const reconciled = clonePlayerState(msg.player)
  const modeDef = state.mode ? getModeDefinition(state.mode) : undefined
  for (const batch of pendingBatches) {
    for (let i = 0; i < batch.clicks; i++) {
      const income = computeClickIncome(reconciled)
      reconciled.score += income
      if (modeDef) {
        reconciled.resources[modeDef.scoreResource] =
          (reconciled.resources[modeDef.scoreResource] ?? 0) + income
      }
    }
    for (const uid of batch.purchases) {
      const def = state.upgrades.find((u) => u.id === uid)
      if (!def) continue

      // One-shot upgrades can only be applied once
      if (!def.repeatable && (reconciled.upgrades[uid] ?? 0) > 0) continue

      // Check correct resource and apply
      if (!modeDef) continue
      const costResource = def.costCurrency ?? modeDef.scoreResource
      const balance = reconciled.resources[costResource] ?? 0
      if (balance >= def.cost) {
        reconciled.resources[costResource] = balance - def.cost
        grantUpgrade(reconciled, uid)
      }
    }
    // Re-apply pending highlight
    if (batch.highlight) {
      reconciled.meta.highlight = batch.highlight
    }
  }

  state.player = reconciled
  notify()
}

function handleRoundEnd(msg: RoundEndMessage): void {
  // If WE are the quitter (reason=quit, winner=opponent), we already
  // transitioned to lobby in quitMatch(). Just ignore this message.
  if (msg.reason === 'quit' && msg.winner === 'opponent') return

  state.screen = 'ended'
  state.endData = msg
  state.player.score = msg.finalScores.player
  state.opponent.score = msg.finalScores.opponent
  pendingBatches.length = 0
  stopCountdown()
  notify()
}

// ─── Private: optimistic tracking ────────────────────────────────────

function getOrCreateBatch(): PendingBatch {
  const targetSeq = getSeq() + 1
  let batch = pendingBatches.find((b) => b.seq === targetSeq)
  if (!batch) {
    batch = { seq: targetSeq, clicks: 0, purchases: [] }
    pendingBatches.push(batch)
  }
  return batch
}

function trackPendingClick(): void {
  getOrCreateBatch().clicks++
}

function trackPendingPurchase(upgradeId: string): void {
  getOrCreateBatch().purchases.push(upgradeId)
}

function trackPendingHighlight(target: string): void {
  getOrCreateBatch().highlight = target
}

// ─── Private: countdown ──────────────────────────────────────────────

function startCountdown(): void {
  stopCountdown()
  countdownTimer = setInterval(() => {
    state.countdown--
    if (state.countdown <= 0) {
      state.screen = 'playing'
      stopCountdown()
    }
    notify()
  }, 1000)
}

function stopCountdown(): void {
  if (countdownTimer) {
    clearInterval(countdownTimer)
    countdownTimer = null
  }
}

// ─── Private: helpers ────────────────────────────────────────────────

/** Mark an upgrade as owned. Repeatable upgrades increment count; one-shot set to 1. */
function grantUpgrade(player: PlayerState, uid: string): void {
  player.upgrades[uid] = (player.upgrades[uid] ?? 0) + 1
}

function computeClickIncome(player: PlayerState): number {
  const mode = state.mode
  if (!mode) return 1
  const modeDef = getModeDefinition(mode)
  const modifiers = collectModifiers(player, modeDef)
  return pipelineClickIncome(modifiers)
}

function clonePlayerState(s: Readonly<PlayerState>): PlayerState {
  return {
    score: s.score,
    resources: { ...s.resources },
    upgrades: { ...s.upgrades },
    meta: structuredClone(s.meta),
  }
}

function notify(): void {
  onChange(state)
}
