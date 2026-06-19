import {
  type GameMode,
  type Goal,
  type PlayerState,
  type RoomSettings,
  type RoomErrorReason,
  type RoundEndMessage,
  type RoundStartMessage,
  type ServerMessage,
  type StateUpdateMessage,
  type UpgradeDefinition,
  COUNTDOWN_SEC,
  MILESTONE_INTERVAL,
  createInitialState,
  getDefaultGoal,
  getModeDefinition,
  collectModifiers,
  computeClickIncome as pipelineClickIncome,
  canAffordGenerator,
  getMaxAffordableGeneratorCount,
  applyGeneratorPurchase,
  isMaxed,
  isPrerequisiteSatisfied,
  isChoiceGroupAvailable,
  isCostAffordable,
  getUpgradeNextCost,
  applyPurchase,
  isClickUnlocked,
  isHighlightActive,
} from '@game/shared'
import {
  getSeq,
  queueAction,
  resetSeq,
  sendQuickMatch,
  sendRematch,
  sendRoomCreate,
  sendRoomJoin,
  sendRoomUpdate,
  sendQuit,
  sendPause,
  sendUnpause,
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
import { recorderRoundStart, recorderTick, recorderRoundEnd } from './dev-recorder.js'

// ─── Types ───────────────────────────────────────────────────────────

export type Screen =
  | 'lobby' // connected, choosing game mode
  | 'room' // in a room, waiting for opponent / adjusting settings
  | 'waiting' // in quick-match queue, looking for opponent
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
  /** Whether the server has paused the current match. */
  paused: boolean
  /** Whether the current match is against a bot. */
  vsBot: boolean
  /** Current match ID. */
  matchId: string | null
  /** Upgrade definitions for this round. */
  upgrades: readonly UpgradeDefinition[]
  /** Countdown value (3, 2, 1, GO). */
  countdown: number
  /** End-of-round data. */
  endData: RoundEndMessage | null
  /** Local player's display name. */
  playerName: string
  /** Opponent's display name. */
  opponentName: string
  /** Room code (when in a room). */
  roomCode: string | null
  /** Room settings (when in a room). */
  roomSettings: RoomSettings | null
  /** Display names of players in the room. */
  roomPlayers: string[]
  /** Whether the local player is the room creator. */
  isRoomCreator: boolean
  /** Latest server-reported active room count. */
  serverActiveRooms: number
  /** Last room error reason (shown as toast, cleared on next action). */
  roomError: RoomErrorReason | null
}

/** Pending actions whose seq > ackSeq (for optimistic reconciliation). */
interface PendingBatch {
  seq: number
  clicks: number
  purchases: string[]
  generatorPurchases: string[]
  highlight?: string
}

export type StateChangeHandler = (state: Readonly<GameState>) => void

// ─── State ───────────────────────────────────────────────────────────

const EMPTY_PLAYER_STATE: PlayerState = {
  score: 0,
  resources: {},
  upgrades: {},
  generators: {},
  meta: {},
}

const state: GameState = {
  screen: 'lobby',
  mode: null,
  goal: null,
  player: clonePlayerState(EMPTY_PLAYER_STATE),
  opponent: clonePlayerState(EMPTY_PLAYER_STATE),
  timeLeft: 0,
  paused: false,
  vsBot: false,
  matchId: null,
  upgrades: [],
  countdown: COUNTDOWN_SEC,
  endData: null,
  playerName: '',
  opponentName: '',
  roomCode: null,
  roomSettings: null,
  roomPlayers: [],
  isRoomCreator: false,
  serverActiveRooms: 0,
  roomError: null,
}

const pendingBatches: PendingBatch[] = []
let onChange: StateChangeHandler = () => {}
let onRoomJoined: (() => void) | null = null
let countdownTimer: ReturnType<typeof setInterval> | null = null

/** Tracks the highest milestone tier we already fired a shockwave for (0 = none). */
let lastFiredMilestoneTier = 0

// ─── Public API ──────────────────────────────────────────────────────

/** Subscribe to state changes. */
export function setStateChangeHandler(handler: StateChangeHandler): void {
  onChange = handler
}

/**
 * Register a callback fired when a room join resolves (success or error).
 * Used by main.ts to clear the ?room= URL param after the server responds.
 */
export function setRoomJoinedCallback(cb: () => void): void {
  onRoomJoined = cb
}

/** Get the current game state (read-only snapshot). */
export function getState(): Readonly<GameState> {
  return state
}

const STORAGE_KEY_NAME = 'player-name'

/** Set the player's display name (persisted to localStorage). */
export function setPlayerName(name: string): void {
  state.playerName = name
  try {
    localStorage.setItem(STORAGE_KEY_NAME, name)
  } catch {
    /* localStorage unavailable — ignore */
  }
}

// Restore name from localStorage on load
try {
  state.playerName = localStorage.getItem(STORAGE_KEY_NAME) ?? ''
} catch {
  /* localStorage unavailable */
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
    case 'ROOM_CREATED':
      state.screen = 'room'
      state.roomCode = msg.code
      state.roomSettings = msg.settings
      state.roomPlayers = msg.players
      state.isRoomCreator = true
      state.roomError = null
      notify()
      break
    case 'ROOM_JOINED':
      state.screen = 'room'
      state.roomCode = msg.code
      state.roomSettings = msg.settings
      state.roomPlayers = msg.players
      state.isRoomCreator = false
      state.roomError = null
      onRoomJoined?.()
      notify()
      break
    case 'ROOM_UPDATED':
      state.roomSettings = msg.settings
      notify()
      break
    case 'ROOM_PLAYER_JOINED':
      state.roomPlayers.push(msg.name)
      notify()
      break
    case 'ROOM_PLAYER_LEFT': {
      // Remove the player who left by name (correct for any room size).
      const idx = state.roomPlayers.indexOf(msg.name)
      if (idx !== -1) state.roomPlayers.splice(idx, 1)
      if (msg.promoted) {
        state.isRoomCreator = true
      }
      notify()
      break
    }
    case 'ROOM_CLOSED':
      resetRoom()
      state.screen = 'lobby'
      notify()
      break
    case 'ROOM_ERROR':
      state.roomError = msg.reason
      // If the player was trying to join/create, stay on lobby
      if (state.screen !== 'room') {
        state.screen = 'lobby'
      }
      onRoomJoined?.()
      notify()
      break
    case 'SERVER_STATUS':
      state.serverActiveRooms = msg.activeRooms
      // Don't trigger a full render for diagnostics — the perf overlay
      // reads state.serverActiveRooms directly.
      break
  }
}

/** Enter the quick-match queue. */
export function quickMatch(): void {
  if (state.screen !== 'lobby') return
  if (!sendQuickMatch(state.playerName)) return // not connected
  state.roomError = null
  state.screen = 'waiting'
  notify()
}

/** Request a rematch with the same opponent from the end screen. */
export function rematch(): void {
  if (state.screen !== 'ended') return
  const { mode, goal, matchId } = state
  if (!mode || !goal || !matchId) return
  if (!sendRematch(state.playerName, matchId, mode, goal)) return // not connected
  resetForMatch()
  state.screen = 'waiting'
  notify()
}

/** Create a new room. */
export function createRoom(): void {
  if (state.screen !== 'lobby') return
  if (!sendRoomCreate(state.playerName)) return // not connected
  state.roomError = null
  // Screen will change to 'room' when ROOM_CREATED arrives
}

/** Join an existing room by code. */
export function joinRoom(code: string): void {
  if (state.screen !== 'lobby') return
  if (!sendRoomJoin(code, state.playerName)) return // not connected
  state.roomError = null
  // Screen will change to 'room' when ROOM_JOINED arrives
}

/** Update room settings (creator only). Optimistically updates local state. */
export function updateRoomSettings(update: { mode?: GameMode; goal?: Goal }): void {
  if (state.screen !== 'room') return
  if (!state.isRoomCreator) return
  if (!state.roomSettings) return
  sendRoomUpdate(update)

  // Optimistic local update — mirrors server-side updateRoomSettings logic
  if (update.mode !== undefined) {
    state.roomSettings = { ...state.roomSettings, mode: update.mode }
    // If the current goal is no longer valid for the new mode, reset it
    const modeDef = getModeDefinition(update.mode)
    const goalStillValid = modeDef.goals.some((g) => g.type === state.roomSettings!.goal.type)
    if (!goalStillValid) {
      state.roomSettings.goal = getDefaultGoal(update.mode)
    }
  }
  if (update.goal !== undefined) {
    state.roomSettings = { ...state.roomSettings, goal: update.goal }
  }
  notify()
}

/** Record a click action (optimistic). Only active when the mode enables clicks. */
export function doClick(): void {
  if (state.screen !== 'playing' || state.paused) return
  if (!state.mode) return
  const modeDef = getModeDefinition(state.mode)
  if (!isClickUnlocked(state.player, modeDef)) return

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
  if (state.screen !== 'playing' || state.paused) return
  if (!state.mode) return
  const modeDef = getModeDefinition(state.mode)
  if (!isHighlightActive(state.player, modeDef)) return
  if (!modeDef.resources.includes(target)) return
  if (state.player.meta.highlight === target) return

  state.player.meta.highlight = target
  queueAction({ type: 'set_highlight', timestamp: Date.now(), highlight: target })
  trackPendingHighlight(target)
  notify()
}

/** Attempt to purchase an upgrade (optimistic). */
export function doBuy(upgradeId: string): void {
  if (state.screen !== 'playing' || state.paused) return
  if (!state.mode) return

  const def = state.upgrades.find((u) => u.id === upgradeId)
  if (!def) return

  const modeDef = getModeDefinition(state.mode)
  const owned = state.player.upgrades[upgradeId] ?? 0
  if (isMaxed(def, owned)) return

  if (!isPrerequisiteSatisfied(def.prerequisites, state.player)) return

  if (!isChoiceGroupAvailable(def, state.player, modeDef.upgrades)) return

  // Every currency in the cost map must be affordable
  if (!isCostAffordable(state.player.resources, getUpgradeNextCost(def, owned))) return

  applyPurchase(state.player, upgradeId, modeDef)

  // Visual effects
  flashPurchase(upgradeId)
  shakeScreen('heavy')

  // Queue for server
  queueAction({ type: 'buy', timestamp: Date.now(), upgradeId })
  trackPendingPurchase(upgradeId)
  notify()
}

/** Attempt to purchase a generator (optimistic). */
export function doBuyGenerator(generatorId: string): void {
  if (state.screen !== 'playing' || state.paused || !state.mode) return
  const modeDef = getModeDefinition(state.mode)
  const def = modeDef.generators.find((g) => g.id === generatorId)
  if (!def) return
  if (!canAffordGenerator(state.player, def)) return
  applyGeneratorPurchase(state.player, generatorId, modeDef)
  queueAction({ type: 'buy_generator', timestamp: Date.now(), generatorId })
  trackPendingGeneratorPurchase(generatorId)
  notify()
}

/** Attempt to purchase the maximum affordable copies of a generator. */
export function doBuyGeneratorMax(generatorId: string): void {
  if (state.screen !== 'playing' || state.paused || !state.mode) return
  const modeDef = getModeDefinition(state.mode)
  const def = modeDef.generators.find((g) => g.id === generatorId)
  if (!def) return

  const quantity = getMaxAffordableGeneratorCount(state.player, def)
  if (quantity <= 0) return

  for (let i = 0; i < quantity; i += 1) {
    if (!canAffordGenerator(state.player, def)) break
    applyGeneratorPurchase(state.player, generatorId, modeDef)
    queueAction({ type: 'buy_generator', timestamp: Date.now(), generatorId })
    trackPendingGeneratorPurchase(generatorId)
  }

  notify()
}

/** Cancel matchmaking queue or leave the room and return to lobby. */
export function cancelQueue(): void {
  if (state.screen !== 'waiting' && state.screen !== 'room') return
  sendQuit()
  resetRoom()
  resetForMatch()
}

/** Request a bot opponent while waiting in queue or in a room. */
export function requestBot(): void {
  if (state.screen !== 'waiting' && state.screen !== 'room') return
  sendBotRequest()
}

/** Voluntarily quit the current match and return to lobby. */
export function quitMatch(): void {
  if (state.screen !== 'playing' && state.screen !== 'countdown') return
  sendQuit()
  recorderRoundEnd(state.player.score)
  resetForMatch()
}

/** Toggle the paused state for the current match. */
export function togglePause(): void {
  if (state.screen !== 'playing') return
  if (!state.vsBot) return // pause is only allowed in bot matches
  if (state.paused) {
    sendUnpause()
  } else {
    sendPause()
  }
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
  state.opponentName = ''
  resetRoom()
  pendingBatches.length = 0
  resetSeq()
  stopCountdown()
  notify()
}

/** Clear room-related state. */
function resetRoom(): void {
  state.roomCode = null
  state.roomSettings = null
  state.roomPlayers = []
  state.isRoomCreator = false
  state.roomError = null
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
  state.opponentName = msg.opponentName
  const modeDef = getModeDefinition(msg.config.mode)
  state.player = createInitialState(modeDef)
  state.opponent = createInitialState(modeDef)
  state.timeLeft =
    msg.config.goal.type === 'timed' ? msg.config.goal.durationSec : msg.config.goal.safetyCapSec
  state.paused = false
  state.vsBot = msg.vsBot
  state.countdown = COUNTDOWN_SEC
  state.endData = null
  pendingBatches.length = 0
  lastFiredMilestoneTier = 0
  resetSeq()
  notify()

  recorderRoundStart(msg.config.mode, state.timeLeft)
  startCountdown()
}

function handleStateUpdate(msg: StateUpdateMessage): void {
  // Server state is authoritative — reconcile with pending optimistic actions
  state.opponent = msg.opponent
  state.timeLeft = msg.timeLeft
  state.paused = msg.paused

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

      const owned = reconciled.upgrades[uid] ?? 0
      if (isMaxed(def, owned)) continue

      // Skip if this purchase is not unlocked in the reconciled state
      if (!isPrerequisiteSatisfied(def.prerequisites, reconciled)) continue

      // Check correct resource and apply
      if (!modeDef) continue
      const cost = getUpgradeNextCost(def, owned)
      if (isCostAffordable(reconciled.resources, cost)) {
        for (const [currency, amount] of Object.entries(cost)) {
          reconciled.resources[currency] = (reconciled.resources[currency] ?? 0) - amount
        }
        grantUpgrade(reconciled, uid)
      }
    }
    // Re-apply pending highlight
    if (batch.highlight) {
      reconciled.meta.highlight = batch.highlight
    }
    // Re-apply pending generator purchases
    for (const gid of batch.generatorPurchases) {
      if (!modeDef) continue
      const gdef = modeDef.generators.find((g) => g.id === gid)
      if (!gdef) continue
      if (!canAffordGenerator(reconciled, gdef)) continue
      applyGeneratorPurchase(reconciled, gid, modeDef)
    }
  }

  state.player = reconciled
  recorderTick(reconciled, state.timeLeft)
  notify()
}

function handleRoundEnd(msg: RoundEndMessage): void {
  // If WE are the quitter (reason=quit, winner=opponent), we already
  // transitioned to lobby in quitMatch(). Just ignore this message.
  if (msg.reason === 'quit' && msg.winner === 'opponent') return

  state.screen = 'ended'
  state.endData = msg
  state.paused = false
  state.player.score = msg.finalScores.player
  state.opponent.score = msg.finalScores.opponent
  pendingBatches.length = 0
  stopCountdown()
  recorderRoundEnd(msg.finalScores.player)
  notify()
}

// ─── Private: optimistic tracking ────────────────────────────────────

function getOrCreateBatch(): PendingBatch {
  const targetSeq = getSeq() + 1
  let batch = pendingBatches.find((b) => b.seq === targetSeq)
  if (!batch) {
    batch = { seq: targetSeq, clicks: 0, purchases: [], generatorPurchases: [] }
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

function trackPendingGeneratorPurchase(generatorId: string): void {
  getOrCreateBatch().generatorPurchases.push(generatorId)
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

/** Increment the owned count of an upgrade. */
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
    generators: { ...s.generators },
    meta: structuredClone(s.meta),
  }
}

function notify(): void {
  onChange(state)
}
