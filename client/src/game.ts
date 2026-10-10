import {
  type GameMode,
  type Goal,
  type GoalChoice,
  type IncomingAttack,
  type ModeDefinition,
  type Modifier,
  type OpponentView,
  type ActivePact,
  type PactBonus,
  type PlayerState,
  type PurchaseEvent,
  type PurchaseBlockReason,
  type AttackEvent,
  type RoomSettings,
  type RoomErrorReason,
  type RoundEndMessage,
  type RoundStartMessage,
  type ServerMessage,
  type StateUpdateMessage,
  type UpgradeDefinition,
  COUNTDOWN_SEC,
  createInitialState,
  getDefaultGoal,
  isAvailableGoalChoice,
  getModeDefinition,
  getAvailableUpgrades,
  collectModifiers,
  resolveEnemyDebuffs,
  pactModifiers,
  computeClickIncome as pipelineClickIncome,
  creditResource,
  canAffordGenerator,
  getMaxAffordableGeneratorCount,
  applyGeneratorPurchase,
  applyGeneratorSell,
  canSellGenerator,
  isGeneratorUnlocked,
  resolveGeneratorDef,
  getUpgradeNextCost,
  upgradeCostFactors,
  applyPurchase,
  purchaseBlockReason,
  grantUpgradeLevel,
  isClickUnlocked,
  readHighlight,
  readGameSec,
  applyHighlightSelection,
  isValidAttackActivation,
  applyAttackActivation,
  applyPactActivation,
  isValidPactActivation,
  isPurchaseLocked,
  getModeFlavor,
  getAttackName,
  getAttackIcon,
  getPactIcon,
  getPactName,
  getResourceIcon,
  getGeneratorIcon,
  getGeneratorName,
} from '@game/shared'
import {
  getSeq,
  queueAction,
  resetSeq,
  sendQuickMatch,
  sendRematch,
  sendRoomCreate,
  sendRoomJoin,
  sendRoomStart,
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
  flashPurchase,
  shakeScreen,
  spawnToast,
} from './ui/vfx/index.js'
import type { ToastHandle } from './ui/vfx/index.js'
import { recorderRoundStart, recorderTick, recorderRoundEnd } from './dev-recorder.js'
import { roundStats } from './stats/round-stats.js'
import { formatCountdown, formatDecimal, formatNumber } from './ui/format-number.js'

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
  /** Redacted opponent view (from server) — only the intel the viewer unlocked. */
  opponent: OpponentView
  /**
   * Accumulated espionage purchase feed (oldest first, capped). Each
   * `STATE_UPDATE` carries only *new* opponent purchases as a delta; the client
   * appends them here so the feed persists across updates (the server never
   * re-sends an event). Reset at the start of each match.
   */
  opponentPurchaseFeed: PurchaseEvent[]
  /**
   * Offensive modifiers the opponent's unlocked passive attacks currently
   * inflict on this player (from each `STATE_UPDATE`, empty when none). Merged
   * into the header's passive-rate computation so the displayed rate matches the
   * debuffed income the server actually applies. Reset at the start of each match.
   */
  debuffs: Modifier[]
  /**
   * Enemy strikes due to land on this player within their `attackAlert` lead
   * *Replaced* from each `STATE_UPDATE` (it is state, not a delta —
   * empty when the snapshot carries none), so an entry vanishes the broadcast
   * after its strike lands. The header badge and the espionage panel count
   * down against `player.meta.gameSec`. Reset at the start of each match.
   */
  incomingAttacks: IncomingAttack[]
  /**
   * What each pact in force is worth to this player right now, resolved by the
   * server. *Replaced* from each `STATE_UPDATE` (empty when the
   * snapshot carries none), merged into the header's passive rate and the
   * predicted click income like `debuffs`, and listed per pact by the
   * relations panel. Reset at the start of each match.
   */
  pactBonuses: PactBonus[]
  /**
   * The opponent's pacts that reach this player — mutual ones, and open
   * active-pact windows that carry a gift. Replaced from each `STATE_UPDATE`'s
   * opponent view (empty when none); the relations panel lists them as shared
   * treaties, and a toast announces one each time it appears. Reset at the
   * start of each match.
   */
  opponentPacts: string[]
  /**
   * Closing times of the opponent's open windows among {@link opponentPacts},
   * for the shared-treaty countdown. Replaced like it; reset like it.
   */
  opponentPactWindows: ActivePact[]
  /**
   * Automatic clicks per second the opponent's pacts are granting this player
   * right now (0 when none). Replaced from each `STATE_UPDATE`; reset per match.
   */
  incomingAutoClicksPerSec: number
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

export type StateChangeHandler = (state: Readonly<GameState>) => void

// ─── Pending optimistic actions ─────────────────────────────────────────

type PredictedAction =
  | { kind: 'click'; resource: string }
  | { kind: 'buy'; upgradeId: string }
  | { kind: 'buy_generator'; generatorId: string }
  | { kind: 'sell_generator'; generatorId: string }
  | { kind: 'set_highlight'; highlight: string | null }
  | { kind: 'activate_attack'; attackId: string }
  | { kind: 'activate_pact'; pactId: string }

/** Pending actions whose seq > ackSeq (for optimistic reconciliation). */
interface PendingBatch {
  seq: number
  actions: PredictedAction[]
}

// ─── State ───────────────────────────────────────────────────────────

const EMPTY_PLAYER_STATE: PlayerState = {
  score: 0,
  resources: {},
  upgrades: {},
  generators: {},
  pendingAttacks: [],
  meta: {},
}

/** A fresh, empty opponent view (no intel unlocked yet). */
function emptyOpponentView(): OpponentView {
  return { score: 0, resources: {}, rates: {} }
}

/**
 * Max espionage purchase events retained client-side. The server forwards each
 * event once, so the client owns the log length; older events scroll off.
 */
const OPPONENT_PURCHASE_FEED_CAP = 25

const state: GameState = {
  screen: 'lobby',
  mode: null,
  goal: null,
  player: clonePlayerState(EMPTY_PLAYER_STATE),
  opponent: emptyOpponentView(),
  opponentPurchaseFeed: [],
  debuffs: [],
  incomingAttacks: [],
  pactBonuses: [],
  opponentPacts: [],
  opponentPactWindows: [],
  incomingAutoClicksPerSec: 0,
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
let onRoomJoinResolved: (() => void) | null = null
let countdownTimer: ReturnType<typeof setInterval> | null = null

/**
 * Client-only: which resource the Space hotkey clicks. `null` falls back to the
 * mode's score resource. Cycled with the `z` hotkey; not synced to the server
 * (each click action already carries its own resource).
 */
let clickTarget: string | null = null
/**
 * The pick behind `state.goal` for the current match — `random` when the goal
 * was rolled. A rematch re-sends it so a random room rolls again.
 */
let goalChoice: GoalChoice | null = null

/** The highlight as of the last `STATE_UPDATE`, before unacked actions are replayed. */
let confirmedHighlight: string | null = null

/** The server-confirmed highlight (see {@link confirmedHighlight}). */
export function getConfirmedHighlight(): string | null {
  return confirmedHighlight
}

/** Bumped on every `STATE_UPDATE`, so display code can tell a snapshot from a local action. */
let snapshotCount = 0
/** `performance.now()` when the last `STATE_UPDATE` arrived: the predicted game clock's anchor. */
let snapshotAtMs = 0

/**
 * How long before a pact window closes a click stops being predicted at its
 * rate. A click reaches the server up to a batch plus a round trip after it is
 * predicted, so without a margin the last ones are paid less than shown.
 */
const PACT_CLOSE_MARGIN_SEC = 0.5

export function getSnapshotCount(): number {
  return snapshotCount
}

// ─── Public API ──────────────────────────────────────────────────────

/** Subscribe to state changes. */
export function setStateChangeHandler(handler: StateChangeHandler): void {
  onChange = handler
}

/**
 * Register a callback fired once a join attempt resolves, by any path: a
 * `ROOM_JOINED`, a room error, or the `ROUND_START` of a direct quick match
 * that never emits a room message. Used by main.ts to clear the ?room= URL
 * param after the server responds.
 */
export function setRoomJoinResolvedCallback(cb: () => void): void {
  onRoomJoinResolved = cb
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
      onRoomJoinResolved?.()
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
      onRoomJoinResolved?.()
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
      onRoomJoinResolved?.()
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
  const { mode, matchId } = state
  if (!mode || !goalChoice || !matchId) return
  if (!sendRematch(state.playerName, matchId, mode, goalChoice)) return // not connected
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
export function updateRoomSettings(update: { mode?: GameMode; goal?: GoalChoice }): void {
  if (state.screen !== 'room') return
  if (!state.isRoomCreator) return
  if (!state.roomSettings) return
  sendRoomUpdate(update)

  // Optimistic local update — mirrors server-side updateRoomSettings logic
  if (update.mode !== undefined) {
    state.roomSettings = { ...state.roomSettings, mode: update.mode }
    // If the current goal pick is no longer valid for the new mode, reset it
    if (!isAvailableGoalChoice(update.mode, state.roomSettings.goal)) {
      state.roomSettings.goal = getDefaultGoal(update.mode)
    }
  }
  if (update.goal !== undefined) {
    state.roomSettings = { ...state.roomSettings, goal: update.goal }
  }
  notify()
}

/** Start the room's match (creator only, once the second player is in). */
export function startRoomMatch(): void {
  if (state.screen !== 'room' || !state.isRoomCreator) return
  if (state.roomPlayers.length < 2) return
  sendRoomStart()
  // The screen changes when ROUND_START arrives.
}

/** Record a click action (optimistic). Only active when the mode enables clicks. */
export function doClick(target?: string): void {
  if (state.screen !== 'playing' || state.paused) return
  if (!state.mode) return
  const modeDef = getModeDefinition(state.mode)
  if (!isClickUnlocked(state.player, modeDef)) return

  // Resolve which resource the click credits. An explicit target (a click card)
  // wins; otherwise (the Space hotkey) use the cycled click target.
  const resource = target && modeDef.resources.includes(target) ? target : getClickTarget(modeDef)

  // Optimistic local update
  const income = computeClickIncome(state.player)
  creditResource(state.player, resource, income, modeDef.scoreResource)

  // Local click telemetry (data panel) — counted once per real click, never in
  // reconciliation, so optimistic re-application can't double-count.
  roundStats.recordClick(resource, income)

  // Visual effects (anchored to the clicked button)
  const anchorId = `click-btn-${resource}`
  spawnClickPopup(income, anchorId)
  spawnClickRipple(anchorId)
  pulseClickButton(anchorId)

  // Queue for server
  queueAction({ type: 'click', timestamp: Date.now(), resource })
  trackPredicted({ kind: 'click', resource })
  notify()
}

/**
 * The resource the Space hotkey currently clicks. Falls back to the score
 * resource when nothing has been cycled or the stored target isn't valid for
 * this mode (e.g. left over from a previous match).
 */
export function getClickTarget(modeDef: ModeDefinition): string {
  return clickTarget && modeDef.resources.includes(clickTarget)
    ? clickTarget
    : modeDef.scoreResource
}

/** Cycle the Space hotkey's click target to the next clickable resource. */
export function cycleClickTarget(): void {
  if (state.screen !== 'playing' || state.paused || !state.mode) return
  const modeDef = getModeDefinition(state.mode)
  if (!isClickUnlocked(state.player, modeDef)) return
  const { resources } = modeDef
  if (resources.length < 2) return

  const current = getClickTarget(modeDef)
  const idx = resources.indexOf(current)
  clickTarget = resources[(idx + 1) % resources.length]
  notify()
}

/**
 * Set the highlighted currency, or release the highlight with `null` (idler
 * mode, optimistic).
 */
export function setHighlight(target: string | null): void {
  if (state.screen !== 'playing' || state.paused) return
  if (!state.mode) return
  const modeDef = getModeDefinition(state.mode)
  if (readHighlight(state.player) === target) return
  if (!applyHighlightSelection(state.player, modeDef, target)) return

  queueAction({ type: 'set_highlight', timestamp: Date.now(), highlight: target })
  trackPredicted({ kind: 'set_highlight', highlight: target })
  notify()
}

/** Toggle the highlight on `target` — selecting it, or releasing it if already held. */
export function toggleHighlight(target: string): void {
  setHighlight(readHighlight(state.player) === target ? null : target)
}

const upgradeMaps = new WeakMap<
  readonly UpgradeDefinition[],
  ReadonlyMap<string, UpgradeDefinition>
>()

/**
 * Why `player` can't buy `upgradeId` right now — the server's `purchaseBlockReason`
 * over this round's upgrades — or `null` if it can.
 */
export function upgradeBlockReason(
  s: Readonly<GameState>,
  upgradeId: string,
  player: PlayerState = s.player,
): PurchaseBlockReason | null {
  if (!s.mode) return 'unknown'
  let map = upgradeMaps.get(s.upgrades)
  if (!map) {
    map = new Map(s.upgrades.map((u) => [u.id, u]))
    upgradeMaps.set(s.upgrades, map)
  }
  return purchaseBlockReason(player, upgradeId, map, getModeDefinition(s.mode))
}

/** Attempt to purchase an upgrade (optimistic). */
export function doBuy(upgradeId: string): void {
  if (state.screen !== 'playing' || state.paused) return
  if (!state.mode) return
  // The server's own rule, so a predicted buy it would drop never happens here.
  if (upgradeBlockReason(state, upgradeId) !== null) return

  applyPurchase(state.player, upgradeId, getModeDefinition(state.mode))

  // Visual effects
  flashPurchase(upgradeId)

  // Queue for server
  queueAction({ type: 'buy', timestamp: Date.now(), upgradeId })
  trackPredicted({ kind: 'buy', upgradeId })
  notify()
}

/** Attempt to purchase a generator (optimistic). */
export function doBuyGenerator(generatorId: string): void {
  if (state.screen !== 'playing' || state.paused || !state.mode) return
  const modeDef = getModeDefinition(state.mode)
  const def = modeDef.generators.find((g) => g.id === generatorId)
  if (!def) return
  if (!isGeneratorUnlocked(state.player, def, modeDef)) return
  if (isPurchaseLocked(state.player, 'generator', generatorId)) return
  const effectiveDef = resolveGeneratorDef(def, state.player, modeDef, 'buy')
  if (!canAffordGenerator(state.player, effectiveDef)) return
  applyGeneratorPurchase(state.player, generatorId, modeDef)
  queueAction({ type: 'buy_generator', timestamp: Date.now(), generatorId })
  trackPredicted({ kind: 'buy_generator', generatorId })
  notify()
}

/** Attempt to purchase the maximum affordable copies of a generator. */
export function doBuyGeneratorMax(generatorId: string): void {
  if (state.screen !== 'playing' || state.paused || !state.mode) return
  const modeDef = getModeDefinition(state.mode)
  const def = modeDef.generators.find((g) => g.id === generatorId)
  if (!def) return
  if (!isGeneratorUnlocked(state.player, def, modeDef)) return
  if (isPurchaseLocked(state.player, 'generator', generatorId)) return
  const effectiveDef = resolveGeneratorDef(def, state.player, modeDef, 'buy')

  const quantity = getMaxAffordableGeneratorCount(state.player, effectiveDef)
  if (quantity <= 0) return

  for (let i = 0; i < quantity; i += 1) {
    if (!canAffordGenerator(state.player, effectiveDef)) break
    applyGeneratorPurchase(state.player, generatorId, modeDef)
    queueAction({ type: 'buy_generator', timestamp: Date.now(), generatorId })
    trackPredicted({ kind: 'buy_generator', generatorId })
  }

  notify()
}

/** Attempt to sell one copy of a generator (optimistic). */
export function doSellGenerator(generatorId: string): void {
  if (state.screen !== 'playing' || state.paused || !state.mode) return
  const modeDef = getModeDefinition(state.mode)
  const def = modeDef.generators.find((g) => g.id === generatorId)
  if (!def) return
  if (!canSellGenerator(state.player, def)) return
  applyGeneratorSell(state.player, generatorId, modeDef)
  queueAction({ type: 'sell_generator', timestamp: Date.now(), generatorId })
  trackPredicted({ kind: 'sell_generator', generatorId })
  notify()
}

/** Activate an active attack (optimistic) — pays the prepare cost and queues the strike. */
export function doActivateAttack(attackId: string): void {
  if (state.screen !== 'playing' || state.paused || !state.mode) return
  const modeDef = getModeDefinition(state.mode)
  if (!isValidAttackActivation(state.player, attackId, modeDef)) return
  applyAttackActivation(state.player, attackId, modeDef)
  shakeScreen('light')
  queueAction({ type: 'activate_attack', timestamp: Date.now(), attackId })
  trackPredicted({ kind: 'activate_attack', attackId })
  notify()
}

/**
 * Activate an active pact (optimistic) — pays the activation cost and opens its
 * window on the spot. Unlike an attack there is no strike to wait for, so the
 * window (and the cooldown behind it) is predicted exactly as the server will
 * apply it.
 */
export function doActivatePact(pactId: string): void {
  if (state.screen !== 'playing' || state.paused || !state.mode) return
  const modeDef = getModeDefinition(state.mode)
  if (!isValidPactActivation(state.player, pactId, modeDef)) return
  applyPactActivation(state.player, pactId, modeDef)
  const def = modeDef.pacts.find((p) => p.id === pactId)
  const flavor = getModeFlavor(modeDef)
  spawnToast(`${getPactName(flavor, pactId)} signed — ${def?.durationSec ?? 0}s`, 'success', {
    icon: getPactIcon(flavor, pactId),
  })
  queueAction({ type: 'activate_pact', timestamp: Date.now(), pactId })
  trackPredicted({ kind: 'activate_pact', pactId })
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
  clickTarget = null
  state.screen = 'lobby'
  state.mode = null
  state.goal = null
  goalChoice = null
  state.player = clonePlayerState(EMPTY_PLAYER_STATE)
  state.opponent = emptyOpponentView()
  state.opponentPurchaseFeed = []
  state.debuffs = []
  state.incomingAttacks = []
  state.pactBonuses = []
  state.opponentPacts = []
  state.opponentPactWindows = []
  state.incomingAutoClicksPerSec = 0
  clearIncomingAttackToasts()
  state.timeLeft = 0
  state.matchId = null
  state.upgrades = []
  state.countdown = COUNTDOWN_SEC
  state.endData = null
  state.opponentName = ''
  roundStats.reset()
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

// ─── Private: message handlers ───────────────────────────────────────

function handleRoundStart(msg: RoundStartMessage): void {
  state.screen = 'countdown'
  state.matchId = msg.matchId
  state.mode = msg.config.mode
  state.goal = msg.config.goal
  goalChoice = msg.config.goalChoice ?? msg.config.goal
  const modeDef = getModeDefinition(msg.config.mode)
  state.upgrades = getAvailableUpgrades(modeDef, msg.config.goal)
  state.opponentName = msg.opponentName
  state.player = createInitialState(modeDef)
  state.opponent = emptyOpponentView()
  state.opponentPurchaseFeed = []
  state.debuffs = []
  state.incomingAttacks = []
  state.pactBonuses = []
  state.opponentPacts = []
  state.opponentPactWindows = []
  state.incomingAutoClicksPerSec = 0
  clearIncomingAttackToasts()
  state.timeLeft =
    msg.config.goal.type === 'timed' ? msg.config.goal.durationSec : msg.config.goal.safetyCapSec
  state.paused = false
  state.vsBot = msg.vsBot
  state.countdown = COUNTDOWN_SEC
  state.endData = null
  roundStats.reset()
  pendingBatches.length = 0
  clickTarget = null
  resetSeq()
  notify()

  recorderRoundStart(msg.config.mode, state.timeLeft)
  startCountdown()
}

function handleStateUpdate(msg: StateUpdateMessage): void {
  // Server state is authoritative — reconcile with pending optimistic actions
  state.opponent = msg.opponent
  // `opponent.purchases` is a delta (new events only, sent once) — accumulate
  // it into the persistent feed rather than replacing, then cap.
  if (msg.opponent.purchases && msg.opponent.purchases.length > 0) {
    state.opponentPurchaseFeed.push(...msg.opponent.purchases)
    if (state.opponentPurchaseFeed.length > OPPONENT_PURCHASE_FEED_CAP) {
      state.opponentPurchaseFeed.splice(
        0,
        state.opponentPurchaseFeed.length - OPPONENT_PURCHASE_FEED_CAP,
      )
    }
  }
  state.timeLeft = msg.timeLeft
  state.paused = msg.paused
  snapshotAtMs = performance.now()
  state.debuffs = msg.debuffs ?? []
  // The alert list is state, not a delta: replace it, and keep one toast per
  // strike in view — counting down, gone once the strike lands.
  const incoming = msg.opponent.incomingAttacks ?? []
  const modeDefForAlerts = state.mode ? getModeDefinition(state.mode) : undefined
  syncIncomingAttackToasts(incoming, msg.player, modeDefForAlerts)
  state.incomingAttacks = incoming
  // Pact worth is state too — the server re-resolves it every tick — as is the
  // list of the opponent's shared treaties, announced on first appearance.
  state.pactBonuses = msg.pactBonuses ?? []
  const shared = msg.opponent.pacts ?? []
  showSharedPactsSigned(state.opponentPacts, shared, modeDefForAlerts)
  state.opponentPacts = shared
  state.opponentPactWindows = msg.opponent.pactWindows ?? []
  state.incomingAutoClicksPerSec = msg.incomingAutoClicksPerSec ?? 0

  // Prune acknowledged batches
  while (pendingBatches.length > 0 && pendingBatches[0].seq <= msg.ackSeq) {
    pendingBatches.shift()
  }

  // Start from server state, then re-apply pending optimistic actions
  confirmedHighlight = readHighlight(msg.player)
  const reconciled = clonePlayerState(msg.player)
  const modeDef = state.mode ? getModeDefinition(state.mode) : undefined
  for (const batch of pendingBatches) {
    for (const action of batch.actions) {
      switch (action.kind) {
        case 'click': {
          if (!modeDef) break
          const income = computeClickIncome(reconciled)
          const target = modeDef.resources.includes(action.resource) ? action.resource : undefined
          if (!target) break
          creditResource(reconciled, target, income, modeDef.scoreResource)
          break
        }
        case 'buy': {
          if (!modeDef) break
          // Replayed against the *server's* state, so a buy the server will
          // refuse is dropped here rather than flickering back until the next
          // snapshot.
          if (upgradeBlockReason(state, action.upgradeId, reconciled) !== null) break
          const def = state.upgrades.find((u) => u.id === action.upgradeId)!
          const owned = reconciled.upgrades[action.upgradeId] ?? 0
          const cost = getUpgradeNextCost(
            def,
            owned,
            upgradeCostFactors(reconciled, action.upgradeId),
          )
          for (const [currency, amount] of Object.entries(cost)) {
            reconciled.resources[currency] = (reconciled.resources[currency] ?? 0) - amount
          }
          grantUpgradeLevel(reconciled, action.upgradeId, modeDef)
          break
        }
        case 'sell_generator': {
          if (!modeDef) break
          const gdef = modeDef.generators.find((g) => g.id === action.generatorId)
          if (!gdef) break
          if (!canSellGenerator(reconciled, gdef)) break
          applyGeneratorSell(reconciled, action.generatorId, modeDef)
          break
        }
        case 'set_highlight': {
          if (!modeDef) break
          applyHighlightSelection(reconciled, modeDef, action.highlight)
          break
        }
        case 'buy_generator': {
          if (!modeDef) break
          const gdef = modeDef.generators.find((g) => g.id === action.generatorId)
          if (!gdef) break
          if (isPurchaseLocked(reconciled, 'generator', action.generatorId)) break
          const effectiveGdef = resolveGeneratorDef(gdef, reconciled, modeDef, 'buy')
          if (!canAffordGenerator(reconciled, effectiveGdef)) break
          applyGeneratorPurchase(reconciled, action.generatorId, modeDef)
          break
        }
        case 'activate_attack': {
          if (!modeDef) break
          if (!isValidAttackActivation(reconciled, action.attackId, modeDef)) break
          applyAttackActivation(reconciled, action.attackId, modeDef)
          break
        }
        case 'activate_pact': {
          if (!modeDef) break
          if (!isValidPactActivation(reconciled, action.pactId, modeDef)) break
          applyPactActivation(reconciled, action.pactId, modeDef)
          break
        }
      }
    }
  }

  state.player = reconciled
  snapshotCount++
  if (msg.attackEvents) showAttackEvents(msg.attackEvents, modeDef)
  if (modeDef) roundStats.recordTick(reconciled, modeDef)
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
  state.incomingAttacks = []
  clearIncomingAttackToasts()
  state.player.score = msg.finalScores.player
  // Omitted for buy-upgrade (opponent score is never revealed in race-to-buy).
  if (msg.finalScores.opponent !== undefined) state.opponent.score = msg.finalScores.opponent
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
    batch = { seq: targetSeq, actions: [] }
    pendingBatches.push(batch)
  }
  return batch
}

function trackPredicted(action: PredictedAction): void {
  getOrCreateBatch().actions.push(action)
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

/**
 * Surface landed attack strikes as transient toasts. `outgoing` = one of our
 * attacks hit the opponent; `incoming` = we were hit (also shakes the screen).
 * Display strings are resolved from the mode flavor here — the server sends only
 * abstract ids.
 */
function showAttackEvents(
  events: readonly AttackEvent[],
  modeDef: ModeDefinition | undefined,
): void {
  if (!modeDef) return
  const flavor = getModeFlavor(modeDef)
  for (const ev of events) {
    const name = getAttackName(flavor, ev.attack)
    const icon = getAttackIcon(flavor, ev.attack)
    if (ev.kind === 'none') {
      // A strike that moved nothing. Outgoing: your attack found nothing to
      // take (info). Incoming: the opponent tried to raid you but you had
      // nothing — valuable intel about their intentions (warning), no shake
      // since you lost nothing.
      if (ev.direction === 'outgoing') {
        spawnToast(`${name}: nothing to steal`, 'info', { icon })
      } else {
        spawnToast(`${name}: attack repelled`, 'warning', { icon })
      }
      continue
    }
    if (ev.kind === 'debuff') {
      // A window opened. Outgoing: your debuff is in force (success). Incoming:
      // your numbers are worse for a while (danger, with the shake) — the
      // duration is stated here because the victim's debuff rows show *what*
      // is hitting them but not for how much longer.
      const span = `${formatDecimal(ev.durationSec, 1)}s`
      if (ev.direction === 'outgoing') {
        spawnToast(`${name}: enemy debuffed for ${span}`, 'success', { icon })
      } else {
        spawnToast(`${name}: debuffed for ${span}`, 'danger', { icon })
        shakeScreen('medium')
      }
      continue
    }
    // A resource theft reads as a quantity ("50 🪵"); a generator theft as a
    // count of copies ("×2 🪚 Sawmill"), since the loss is production, not stock.
    const what =
      ev.kind === 'resource'
        ? `${formatNumber(ev.amount)} ${getResourceIcon(flavor, ev.resource)}`
        : `×${ev.count} ${getGeneratorIcon(flavor, ev.generator)} ${getGeneratorName(flavor, ev.generator)}`
    if (ev.direction === 'outgoing') {
      spawnToast(`${name}: stole ${what}`, 'success', { icon })
    } else {
      spawnToast(`${name}: lost ${what}`, 'danger', { icon })
      shakeScreen('medium')
    }
  }
}

/** A warning's identity across broadcasts: the strike's landing time plus what it names. */
function incomingAttackKey(a: IncomingAttack): string {
  return `${a.readyAtSec}:${a.attack ?? ''}`
}

/** The live warning toast for each strike in view, by {@link incomingAttackKey}. */
const incomingAttackToasts = new Map<string, ToastHandle>()

/**
 * Keep one sticky `warning` toast per enemy strike in view: spawned when the
 * strike first appears (its countdown then ticked by the counters painter), and
 * dismissed once the strike leaves the list (it landed) — so the warning never
 * vanishes before the attack does, however long the lead. Named when the
 * viewer's alert reveals the attack, otherwise a generic "Enemy attack" — the
 * espionage panel's wording.
 */
function syncIncomingAttackToasts(
  next: readonly IncomingAttack[],
  player: Readonly<PlayerState>,
  modeDef: ModeDefinition | undefined,
): void {
  const inView = new Set<string>()
  if (modeDef) {
    const flavor = getModeFlavor(modeDef)
    for (const a of next) {
      const key = incomingAttackKey(a)
      inView.add(key)
      // The key includes `readyAtSec`, so a toast's countdown never changes.
      if (incomingAttackToasts.has(key)) continue
      const countdown = {
        template: `${a.attack ? getAttackName(flavor, a.attack) : 'Enemy attack'} lands in {}s`,
        untilSec: a.readyAtSec,
      }
      const icon = a.attack ? getAttackIcon(flavor, a.attack) : '⚠️'
      const text = formatCountdown(countdown, readGameSec(player))
      incomingAttackToasts.set(key, spawnToast(text, 'warning', { icon, sticky: true, countdown }))
    }
  }
  for (const [key, toast] of incomingAttackToasts) {
    if (inView.has(key)) continue
    toast.dismiss()
    incomingAttackToasts.delete(key)
  }
}

/** Dismiss every warning toast — the round is starting, over, or left. */
function clearIncomingAttackToasts(): void {
  for (const toast of incomingAttackToasts.values()) toast.dismiss()
  incomingAttackToasts.clear()
}

/**
 * Announce a mutual pact the opponent has just signed — present in `next` but
 * not in `prev` — once, the way an incoming strike is announced: the treaty
 * pays this player from now on, and nothing else on the screen says so until
 * they open the relations panel.
 */
function showSharedPactsSigned(
  prev: readonly string[],
  next: readonly string[],
  modeDef: ModeDefinition | undefined,
): void {
  if (!modeDef || next.length === 0) return
  const seen = new Set(prev)
  const flavor = getModeFlavor(modeDef)
  for (const id of next) {
    if (seen.has(id)) continue
    spawnToast(`${getPactName(flavor, id)} signed by the enemy`, 'info', {
      icon: getPactIcon(flavor, id),
    })
  }
}

/**
 * The modifiers the server has resolved for this player beyond their own:
 * the opponent's debuffs and the pacts' bonuses, both arriving unresolved and
 * translated against `player` here (a highlight-factor entry lands on what
 * they hold right now). Appended after `collectModifiers` on every client
 * income path, so the header, the data panel and a predicted click agree with
 * the income the server actually credits.
 */
export function externalModifiers(
  player: Readonly<PlayerState>,
  modeDef: ModeDefinition,
): Modifier[] {
  const bonuses = state.pactBonuses.filter((b) => !isPactWindowClosing(b.pact, player))
  return resolveEnemyDebuffs([...state.debuffs, ...pactModifiers(bonuses)], player, modeDef)
}

/**
 * Whether every open window of pact `pactId` (the player's own, or the
 * opponent's that reaches them) closes before a click predicted now would reach
 * the server. `false` for a pact with no window — a passive one.
 */
function isPactWindowClosing(pactId: string, player: Readonly<PlayerState>): boolean {
  const windows = [...(player.activePacts ?? []), ...state.opponentPactWindows].filter(
    (w) => w.pact === pactId,
  )
  if (windows.length === 0) return false
  const leadSec = state.paused ? 0 : Math.max(0, performance.now() - snapshotAtMs) / 1000
  const cutoffSec = readGameSec(player) + leadSec + PACT_CLOSE_MARGIN_SEC
  return windows.every((w) => w.expiresAtSec <= cutoffSec)
}

function computeClickIncome(player: PlayerState): number {
  const mode = state.mode
  if (!mode) return 1
  const modeDef = getModeDefinition(mode)
  // Merge in the debuffs the opponent's passive attacks inflict and the pact
  // bonuses in force (both sent by the server) so a predicted click pays what
  // the server will credit — the same reason the header folds them into the
  // passive rate. Resolved against the clicking player, since they arrive
  // unresolved.
  const modifiers = [...collectModifiers(player, modeDef), ...externalModifiers(player, modeDef)]
  return pipelineClickIncome(modifiers)
}

function clonePlayerState(s: Readonly<PlayerState>): PlayerState {
  return {
    score: s.score,
    resources: { ...s.resources },
    upgrades: { ...s.upgrades },
    generators: { ...s.generators },
    // A replayed generator buy must be priced from the server's anchored curve.
    ...(s.generatorCostBases ? { generatorCostBases: { ...s.generatorCostBases } } : {}),
    pendingAttacks: [...s.pendingAttacks],
    // Carried through reconciliation: a re-applied optimistic purchase must be
    // priced with the same inflation the server charged (entries are readonly,
    // so the shallow copy is enough).
    ...(s.incomingCostFactors ? { incomingCostFactors: [...s.incomingCostFactors] } : {}),
    // Same reasoning: a replayed buy must be refused under the same lock the
    // server refused it under.
    ...(s.incomingPurchaseLocks ? { incomingPurchaseLocks: [...s.incomingPurchaseLocks] } : {}),
    // And priced with the same pact discount the server granted.
    ...(s.pactCostFactors ? { pactCostFactors: [...s.pactCostFactors] } : {}),
    // Never predicted, only carried: the strike that opens a window lands
    // server-side, so this arrives like any other reconciled field.
    ...(s.activeDebuffs ? { activeDebuffs: [...s.activeDebuffs] } : {}),
    // Same for cooldowns, which the strike stamps — and a replayed activation
    // must be refused under the cooldown the server refused it under.
    ...(s.cooldowns ? { cooldowns: [...s.cooldowns] } : {}),
    // Predicted (the activation opens the window) and replayed, so it must be
    // copied for the replay to push onto its own list.
    ...(s.activePacts ? { activePacts: [...s.activePacts] } : {}),
    meta: structuredClone(s.meta),
  }
}

function notify(): void {
  onChange(state)
}
