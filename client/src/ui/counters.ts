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
 *   time. The clock never runs backwards, so a countdown never ticks up. The
 *   round timer advances the snapshot's `timeLeft` the same way.
 *
 * Elements opt in through attributes (`counterAttr`, `scoreFillAttr`,
 * `TIME_LEFT_ATTR`, `countdownAttrs`), so the painter owns no panel's ids.
 */

import { BROADCAST_INTERVAL_MS, MAX_RESOURCE, readGameSec } from '@game/shared'
import type { ModeDefinition } from '@game/shared'
import { getSnapshotCount, getState } from '../game.js'
import type { GameState } from '../game.js'
import { formatCountdown, formatNumber } from './format-number.js'
import type { Countdown } from './format-number.js'
import { escapeAttr, formatScore, formatTime } from './helpers.js'

/** How far past its snapshot a counter keeps climbing — covers one late broadcast. */
const MAX_LEAD_MS = BROADCAST_INTERVAL_MS * 2

/**
 * Time constant of the fade that absorbs a snapshot's disagreement with the
 * prediction — long enough to hide a tick of timing jitter, short enough that a
 * real change (a theft, a highlight switch the server made first) shows at once.
 */
const CORRECTION_TAU_MS = 120

// ─── Pure math ───────────────────────────────────────────────────────

/** What remains `elapsedMs` after a correction of `offset` began fading. */
export function fadeCorrection(offset: number, elapsedMs: number): number {
  return offset * Math.exp(-elapsedMs / CORRECTION_TAU_MS)
}

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
  const shown = value + leadAt(a, nowMs) + fadeCorrection(a.offset, nowMs - a.snapshotMs)
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

/** Real seconds since a snapshot received at `atMs`, frozen while paused and capped. */
export function snapshotLeadSec(atMs: number, paused: boolean, nowMs: number): number {
  if (paused) return 0
  return Math.min(Math.max(0, nowMs - atMs), MAX_LEAD_MS) / 1000
}

/** Key for the score among the resource keys (which are abstract `r0`, `r1`, …). */
const SCORE_KEY = '#score'

type Side = 'own' | 'theirs'

/** Hands an element's text to the painter: resource `key`'s amount, or the score when omitted. */
export function counterAttr(side: Side, key: string = SCORE_KEY): string {
  return ` data-counter="${side}:${key}"`
}

/** Hands a progress fill's width to the painter: `side`'s score against the target. */
export function scoreFillAttr(side: Side): string {
  return ` data-score-fill="${side}"`
}

/** Hands an element's text to the painter as the round timer. */
export const TIME_LEFT_ATTR = ' data-counter="time-left"'

/** Hands an element's text to the painter as a countdown. */
export function countdownAttrs(c: Countdown | null): string {
  if (!c) return ''
  return ` data-until="${c.untilSec}" data-countdown="${escapeAttr(c.template)}"`
}

/** A countdown the per-frame painter keeps ticking, showing its snapshot value until then. */
export function countdownSpan(c: Countdown, gameSec: number): string {
  return `<span${countdownAttrs(c)}>${formatCountdown(c, gameSec)}</span>`
}

// ─── Tracking ────────────────────────────────────────────────────────

const own = new Map<string, { value: number; anchor: Anchor }>()
const theirs = new Map<string, Tween>()
/** The last snapshot's clocks, and when it arrived. */
let snapshot = { gameSec: 0, timeLeft: 0, atMs: 0, paused: false }
/** The latest game clock painted, so a snapshot behind the prediction stalls it instead of rewinding. */
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
  const count = getSnapshotCount()
  const fresh = newMatch || count !== lastSnapshot
  lastSnapshot = count

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

  // The opponent's values and the clocks only ever change on a snapshot.
  if (fresh) {
    snapshot = {
      gameSec: readGameSec(state.player),
      timeLeft: state.timeLeft,
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

function shownOwn(key: string, nowMs: number): number | null {
  const t = own.get(key)
  return t ? extrapolate(t.value, t.anchor, nowMs) : null
}

function shownTheirs(key: string, nowMs: number): number | null {
  const t = theirs.get(key)
  return t ? tweenAt(t, nowMs) : null
}

/** A `data-counter` element's text, or `null` for a counter not tracked yet. */
function counterText(counter: string, state: Readonly<GameState>, nowMs: number): string | null {
  if (counter === 'time-left') {
    const lead = snapshotLeadSec(snapshot.atMs, snapshot.paused, nowMs)
    return formatTime(snapshot.timeLeft - lead)
  }
  const [side, key] = counter.split(':')
  const value = side === 'own' ? shownOwn(key, nowMs) : shownTheirs(key, nowMs)
  if (value === null) return null
  return key === SCORE_KEY ? formatScore(value, state) : formatNumber(value)
}

/** Write every element that opted in through one of the markup helpers above. */
export function paintCounters(): void {
  const state = getState()
  const now = performance.now()

  const lead = snapshotLeadSec(snapshot.atMs, snapshot.paused, now)
  shownClock = Math.max(shownClock, snapshot.gameSec + lead)
  for (const el of document.querySelectorAll<HTMLElement>('[data-until][data-countdown]')) {
    const c = { template: el.dataset.countdown ?? '', untilSec: Number(el.dataset.until) }
    const text = formatCountdown(c, shownClock)
    if (el.textContent !== text) el.textContent = text
  }

  for (const el of document.querySelectorAll<HTMLElement>('[data-counter]')) {
    const text = counterText(el.dataset.counter ?? '', state, now)
    if (text !== null && el.textContent !== text) el.textContent = text
  }

  if (state.goal?.type === 'target-score') {
    for (const el of document.querySelectorAll<HTMLElement>('[data-score-fill]')) {
      const score =
        el.dataset.scoreFill === 'own' ? shownOwn(SCORE_KEY, now) : shownTheirs(SCORE_KEY, now)
      if (score !== null) el.style.width = `${Math.min(100, (score / state.goal.target) * 100)}%`
    }
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
