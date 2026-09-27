/**
 * Resource and score counters that move smoothly between server snapshots.
 *
 * `STATE_UPDATE` lands every `BROADCAST_INTERVAL_MS`, so a counter redrawn only
 * on snapshots visibly steps twice a second. Display-only, like the battery bar:
 * nothing reads these values back, and every snapshot re-anchors them.
 *
 * - The player's own counters **extrapolate**: the live (optimistic) value plus
 *   what its passive rate has earned since the last snapshot, so a click or a
 *   purchase still lands on the frame it happens. When a snapshot disagrees
 *   with the prediction, the difference fades out instead of snapping.
 * - The opponent's counters **interpolate** from what was shown to the latest
 *   snapshot over one broadcast interval. Their rates are mostly hidden, and a
 *   score guessed ahead would have to run backwards when the guess was wrong.
 * - Countdowns (attack prep and windows, purchase locks, incoming strikes) run
 *   off a predicted game clock: the snapshot's `meta.gameSec` advanced by real
 *   time. The clock never runs backwards, so a countdown never ticks up.
 */

import { BROADCAST_INTERVAL_MS, MAX_RESOURCE, getModeDefinition } from '@game/shared'
import type { ModeDefinition } from '@game/shared'
import { getSnapshotCount, getState } from '../game.js'
import type { GameState } from '../game.js'
import { formatCountdown, formatNumber } from './format-number.js'
import type { Countdown } from './format-number.js'
import { escapeAttr, formatScore, setText, updateProgressBar } from './helpers.js'

/** How far past its snapshot a counter keeps climbing — covers one late broadcast. */
const MAX_LEAD_MS = BROADCAST_INTERVAL_MS * 2

/** Time constant of the fade that absorbs a snapshot's disagreement with the prediction. */
const CORRECTION_TAU_MS = 120

// ─── Pure math ───────────────────────────────────────────────────────

/** How one of the player's counters advances past the value in state. */
export interface Anchor {
  /** When the last snapshot landed: the lead is capped and the offset faded from here. */
  snapshotMs: number
  /** Lead accrued up to `atMs`. */
  lead: number
  atMs: number
  /** Passive income per second since `atMs`. */
  rate: number
  /** Shown minus true value when the snapshot landed. */
  offset: number
  paused: boolean
}

function leadAt(a: Anchor, nowMs: number): number {
  const stop = a.snapshotMs + MAX_LEAD_MS
  const ms = Math.max(0, Math.min(nowMs, stop) - Math.min(a.atMs, stop))
  // A negative rate credits nothing server-side (`creditResource`), so it never drains.
  return a.lead + (Math.max(0, a.rate) * ms) / 1000
}

/** The value to show for `value` (the live state) under anchor `a`. */
export function extrapolate(value: number, a: Anchor, nowMs: number): number {
  if (a.paused) return value
  const fade = Math.exp(-(nowMs - a.snapshotMs) / CORRECTION_TAU_MS)
  const shown = value + leadAt(a, nowMs) + a.offset * fade
  return Math.min(MAX_RESOURCE, Math.max(0, shown))
}

/**
 * Anchor on a fresh snapshot: the lead restarts from zero, and whatever the
 * previous anchor was showing beyond the new value carries over as the offset.
 */
export function anchorSnapshot(
  prev: { value: number; anchor: Anchor } | undefined,
  value: number,
  rate: number,
  paused: boolean,
  nowMs: number,
): Anchor {
  const offset = prev ? extrapolate(prev.value, prev.anchor, nowMs) - value : 0
  return { snapshotMs: nowMs, lead: 0, atMs: nowMs, rate, offset, paused }
}

/** A rate change between snapshots (a local buy or highlight switch) keeps the lead so far. */
export function bendRate(a: Anchor, rate: number, nowMs: number): Anchor {
  if (rate === a.rate) return a
  return { ...a, lead: leadAt(a, nowMs), atMs: nowMs, rate }
}

/** A linear move from `from` to `to`, starting at `atMs` and lasting one broadcast interval. */
export interface Tween {
  from: number
  to: number
  atMs: number
}

export function tweenAt(t: Tween, nowMs: number): number {
  const k = Math.min(1, Math.max(0, (nowMs - t.atMs) / BROADCAST_INTERVAL_MS))
  return t.from + (t.to - t.from) * k
}

/** Head for `to` from wherever `prev` currently is; a first value starts settled. */
export function retarget(prev: Tween | undefined, to: number, nowMs: number): Tween {
  if (!prev) return { from: to, to, atMs: nowMs }
  if (prev.to === to) return prev
  return { from: tweenAt(prev, nowMs), to, atMs: nowMs }
}

/** The snapshot's game clock `sec`, received at `atMs`, advanced to `nowMs`. */
export function predictClock(sec: number, atMs: number, paused: boolean, nowMs: number): number {
  if (paused) return sec
  return sec + Math.min(Math.max(0, nowMs - atMs), MAX_LEAD_MS) / 1000
}

/** The attributes that hand an element's text to the per-frame countdown painter. */
export function countdownAttrs(c: Countdown | null): string {
  if (!c) return ''
  return ` data-until="${c.untilSec}" data-countdown="${escapeAttr(c.template)}"`
}

/** A countdown the per-frame painter keeps ticking, showing its snapshot value until then. */
export function countdownSpan(c: Countdown, gameSec: number): string {
  return `<span${countdownAttrs(c)}>${formatCountdown(c, gameSec)}</span>`
}

// ─── Tracking ────────────────────────────────────────────────────────

/** Key for the score among the resource keys (which are abstract `r0`, `r1`, …). */
const SCORE_KEY = '#score'

const own = new Map<string, { value: number; anchor: Anchor }>()
const theirs = new Map<string, Tween>()
let clock = { sec: 0, atMs: 0, paused: false }
/** The latest clock painted, so a snapshot behind the prediction stalls it instead of rewinding. */
let shownClock = 0
let trackedMatch: string | null = null
let lastSnapshot = -1
let rafId: number | null = null

/**
 * Pick up the latest state. Called on every state change while playing — a
 * snapshot re-anchors, a local action only moves the value (and maybe the rate).
 * `rates` are the header's passive rates, so the counters climb at the pace shown.
 */
export function syncCounters(
  state: Readonly<GameState>,
  modeDef: ModeDefinition,
  rates: Readonly<Record<string, number>>,
): void {
  const newMatch = state.matchId !== trackedMatch
  if (newMatch) {
    own.clear()
    theirs.clear()
    shownClock = 0
    trackedMatch = state.matchId
  }
  const now = performance.now()
  const snapshot = getSnapshotCount()
  const fresh = newMatch || snapshot !== lastSnapshot
  lastSnapshot = snapshot

  const track = (key: string, value: number, rate: number): void => {
    const prev = own.get(key)
    const anchor =
      !prev || fresh
        ? anchorSnapshot(prev, value, rate, state.paused, now)
        : bendRate(prev.anchor, rate, now)
    own.set(key, { value, anchor })
  }
  for (const key of modeDef.resources) {
    track(key, state.player.resources[key] ?? 0, rates[key] ?? 0)
  }
  track(SCORE_KEY, state.player.score, rates[modeDef.scoreResource] ?? 0)

  // The opponent's values and the game clock only ever change on a snapshot.
  if (fresh) {
    clock = {
      sec: (state.player.meta.gameSec as number | undefined) ?? 0,
      atMs: now,
      paused: state.paused,
    }
    theirs.set(SCORE_KEY, retarget(theirs.get(SCORE_KEY), state.opponent.score ?? 0, now))
    for (const [key, value] of Object.entries(state.opponent.resources)) {
      theirs.set(key, retarget(theirs.get(key), value, now))
    }
  }

  rafId ??= requestAnimationFrame(loop)
}

function shownOwn(key: string, nowMs: number): number {
  const t = own.get(key)
  return t ? extrapolate(t.value, t.anchor, nowMs) : 0
}

function shownTheirs(key: string, nowMs: number): number {
  const t = theirs.get(key)
  return t ? tweenAt(t, nowMs) : 0
}

/**
 * Write every counter on screen: header resources, highlight-card balances,
 * scoreboard / target bars, the espionage stockpiles, and every countdown.
 * Elements that aren't mounted are skipped, so this is safe from any tab.
 */
export function paintCounters(): void {
  const state = getState()
  if (!state.mode) return
  const modeDef = getModeDefinition(state.mode)
  const now = performance.now()

  shownClock = Math.max(shownClock, predictClock(clock.sec, clock.atMs, clock.paused, now))
  for (const el of document.querySelectorAll<HTMLElement>('[data-until][data-countdown]')) {
    const c = { template: el.dataset.countdown ?? '', untilSec: Number(el.dataset.until) }
    const text = formatCountdown(c, shownClock)
    if (el.textContent !== text) el.textContent = text
  }

  for (const key of modeDef.resources) {
    const text = formatNumber(shownOwn(key, now))
    setText(`header-${key}`, text)
    setText(`${key}-balance`, text)
    if (theirs.has(key)) setText(`esp-amount-${key}`, formatNumber(shownTheirs(key, now)))
  }

  const score = shownOwn(SCORE_KEY, now)
  const opponentScore = shownTheirs(SCORE_KEY, now)
  setText('player-score', formatScore(score, state))
  setText('opponent-score', formatScore(opponentScore, state))
  setText('player-bar-score', formatScore(score, state))
  setText('opponent-bar-score', formatScore(opponentScore, state))
  if (state.goal?.type === 'target-score') {
    updateProgressBar('player-progress', score, state.goal.target)
    updateProgressBar('opponent-progress', opponentScore, state.goal.target)
  }
}

function loop(): void {
  if (getState().screen !== 'playing') {
    rafId = null
    return
  }
  paintCounters()
  rafId = requestAnimationFrame(loop)
}
