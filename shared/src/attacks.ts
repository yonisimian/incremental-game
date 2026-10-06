// @game/shared — pure active-attack rules: activation validation, preparation
// bookkeeping, and strike resolution.
//
// Mirrors `purchase-validation.ts`'s "reason or null" pattern: `attackBlockReason`
// returns *why* an activation is disallowed (or `null` when allowed) and
// `isValidAttackActivation` is `reason === null`, so the two can never drift.
// The server tick uses `dueAttacks` + `resolveAttackStrike` to land strikes;
// the client re-uses `applyAttackActivation` for optimistic prediction.

import { scaledCost } from './cost.js'
import { readGameSec } from './game-clock.js'
import { cooldownUntilSec, startCooldown } from './cooldowns.js'
import { isCostAffordable } from './upgrade-costs.js'
import { creditResource } from './modifiers/pipeline.js'
import { isAttackUnlocked, unlockedAttacks } from './modes/index.js'
import { applyEffect, forEachHeldEffectOutput, normalizeEffectOutputs } from './effects/registry.js'
import { ATTACK_STATS } from './effects/seed/attack-stat.js'
import type { AttackStat } from './effects/seed/attack-stat.js'
import type { AttackAlertOutput, AttackStatOutput, EffectOutput } from './effects/types.js'
import { makeSlotBudget } from './slots.js'
import type { ModeDefinition } from './modes/types.js'
import type {
  ActiveDebuff,
  AttackDefinition,
  AttackKind,
  PendingAttack,
  PlayerState,
  UpgradeDefinition,
} from './types.js'

// Re-exported from the seed (the schema owns its canonical enum, so the list and
// the load-time validation can't drift) — mirroring how `highlight-battery`
// re-exports `BATTERY_STATS`. This module is the sole re-exporter, so the shared
// barrel has exactly one path to each.
export {
  ATTACK_STATS,
  ATTACK_STAT_DIRECTION,
  ATTACK_STAT_OPS,
  attackStatOpsFor,
} from './effects/seed/attack-stat.js'
export type { AttackStat, AttackStatOp } from './effects/seed/attack-stat.js'

// ─── Stat parameters ─────────────────────────────────────────────────

/**
 * One attack's numbers as **multipliers on its authored values** — `1` meaning
 * "exactly as authored". Collected from the attacker's owned `attackStat`
 * upgrades by {@link collectAttackParams}.
 */
export interface AttackParams {
  /** Scales the attack's magnitude (steal sizes, debuff strength). */
  readonly power: number
  /** Scales every currency of the prepare cost. */
  readonly prepareCost: number
  /** Scales `prepareTimeSec`, the delay before the strike lands. */
  readonly prepareTime: number
  /**
   * Seconds shifted onto the *scaled* prepare delay — the absolute counterpart
   * of `prepareTime`, collected from `offset` ops. Negative brings the strike
   * forward; {@link getAttackPrepareTimeSec} owns the floor at zero, since only
   * it knows the attack's authored delay.
   */
  readonly prepareTimeOffsetSec: number
  /** Scales `durationSec`, how long the strike's debuff window stays open. */
  readonly duration: number
  /**
   * Seconds shifted onto the *scaled* window — `duration`'s absolute
   * counterpart, as `prepareTimeOffsetSec` is to `prepareTime`.
   * {@link getAttackDurationSec} owns the floor at zero.
   */
  readonly durationOffsetSec: number
  /** Scales `cooldownSec`, the rest after the attack finishes. */
  readonly cooldown: number
  /**
   * Seconds shifted onto the *scaled* cooldown — `cooldown`'s absolute
   * counterpart. {@link getAttackCooldownSec} owns the floor at zero.
   */
  readonly cooldownOffsetSec: number
}

/**
 * The params an attack has with no `attackStat` upgrade behind it — every value
 * as authored. For callers with no player state in hand (the dev simulator,
 * balance metrics, a test asserting the authored figure), mirroring
 * `NEUTRAL_COST_FACTORS`.
 */
export const NEUTRAL_ATTACK_PARAMS: AttackParams = {
  power: 1,
  prepareCost: 1,
  prepareTime: 1,
  prepareTimeOffsetSec: 0,
  duration: 1,
  durationOffsetSec: 0,
  cooldown: 1,
  cooldownOffsetSec: 0,
}

/**
 * The stats only an *active* attack can use. A passive attack is always-on and
 * never activated — `validateModeDefinition` forbids it from declaring a
 * `prepareCost`, `prepareTimeSec`, `durationSec` or `cooldownSec` at all — so a
 * stat moving any of them would be authored dead weight.
 */
const ACTIVE_ONLY_ATTACK_STATS: readonly AttackStat[] = [
  'prepareCost',
  'prepareTime',
  'duration',
  'cooldown',
]

/**
 * The `attackStat` stats that mean something on an attack of `kind`.
 *
 * The single source of truth for that question, shared by the boot-time
 * validator and the `/dev.html` form — which narrows its `stat` picker with it,
 * so the illegal combination can't be authored in the first place rather than
 * being caught only at load.
 */
export function attackStatsFor(kind: AttackKind): readonly AttackStat[] {
  if (kind === 'active') return ATTACK_STATS
  return ATTACK_STATS.filter((stat) => !ACTIVE_ONLY_ATTACK_STATS.includes(stat))
}

/**
 * Floors each stat is clamped to after collection, so a mis-authored `value` is
 * merely useless rather than an inversion of the mechanic:
 *
 * - `power` — a negative magnitude would make a steal a *gift*.
 * - `prepareCost` — free is the floor; negative would credit the attacker.
 * - `prepareTime` — `0` already means "strike on the next tick".
 * - `duration` — a window of no length is gathered by no tick; negative would
 *   stamp an `expiresAtSec` in the past, which reads the same.
 * - `cooldown` — `0` is no rest at all; negative would lift it in the past.
 */
const ATTACK_PARAM_FLOORS: Record<AttackStat, number> = {
  power: 0,
  prepareCost: 0,
  prepareTime: 0,
  duration: 0,
  cooldown: 0,
}

/**
 * Ceiling each stat is clamped to, the floors' counterpart.
 *
 * A backstop, not the main defence — the schema's `MAX_SCALED_STAT_VALUE` stops
 * a single slipped exponent, and the direction guard bounds `prepareCost` and
 * `prepareTime` to at most their authored values. What neither can see is the
 * *product* of several refs, each individually plausible, and an `Infinity`
 * there is not merely a big number: `Infinity × 0` is `NaN`, and a `NaN`
 * `readyAtSec` never satisfies `dueAttacks`, so the pending entry would outlive
 * the round and `already-preparing` would block the attack for good.
 *
 * `1e9` because every consumer has long saturated by then (a steal at
 * {@link MAX_STEAL_FRACTION}, a debuff at `MIN_DEBUFF_FACTOR`, a cost at
 * unaffordable), while `1e9 ×` any authored number stays comfortably finite.
 */
export const MAX_ATTACK_PARAM = 1e9

/**
 * Clamp a resolved stat into `[floor, MAX_ATTACK_PARAM]`, totally — `Math.min`
 * and `Math.max` propagate `NaN` rather than bounding it, so it needs its own
 * branch.
 *
 * A `NaN` resolves to `1`, the neutral multiplier, rather than to either bound:
 * these are multipliers on authored values, so "as authored" is the one reading
 * of a corrupted computation that neither gifts the attacker a free strike (the
 * floor, on `prepareCost`) nor silently deletes the attack (the ceiling).
 */
function clampAttackParam(stat: AttackStat, value: number): number {
  if (Number.isNaN(value)) return 1
  return Math.min(MAX_ATTACK_PARAM, Math.max(ATTACK_PARAM_FLOORS[stat], value))
}

/**
 * The largest share of a stockpile (or of a generator's copies) a `power`-scaled
 * steal may ask for. Taking *everything* is the ceiling, so a buffed fraction
 * saturates here rather than overshooting and relying on the victim-holdings cap
 * — which would make the upgrade silently worthless past saturation, with no way
 * for the panel to say so.
 */
const MAX_STEAL_FRACTION = 1

/** Whether an effect output is an attack-stat adjustment. */
function isAttackStatOutput(out: EffectOutput): out is AttackStatOutput {
  return 'kind' in out && out.kind === 'attackStat'
}

/**
 * Collect every owned upgrade's `attackStat` effects into one attack's resolved
 * {@link AttackParams}.
 *
 * The battery's collector, transplanted: each output compounds with the owning
 * upgrade's owned count the same way the production pipeline does — `add` scales
 * linearly (`× owned`), `mult` compounds (`** owned`) — and **all adds are
 * applied before any mult**, per stat, so the result doesn't depend on the order
 * the tree happens to be authored in. Mode-level refs are collected too (with
 * `owned = 1`), so a mode can buff attacks without an upgrade. An output naming
 * a different attack is skipped.
 */
export function collectAttackParams(
  state: Readonly<PlayerState>,
  mode: ModeDefinition,
  attackId: string,
): AttackParams {
  // Keyed off ATTACK_STATS so adding a stat means adding a floor, not
  // remembering to seed three more tables.
  const adds = {} as Record<AttackStat, number>
  const mults = {} as Record<AttackStat, number>
  const offsets = {} as Record<AttackStat, number>
  for (const stat of ATTACK_STATS) {
    adds[stat] = 0
    mults[stat] = 1
    offsets[stat] = 0
  }

  const accumulate = (out: EffectOutput, owned: number): void => {
    if (!isAttackStatOutput(out) || out.attack !== attackId) return
    // `offset` is absolute (the stat's own unit) and so never touches the
    // multiplier; like `add` it scales linearly with the owned count.
    if (out.op === 'offset') offsets[out.stat] += out.value * owned
    else if (out.op === 'add') adds[out.stat] += out.value * owned
    else mults[out.stat] *= out.value ** owned
  }
  forEachHeldEffectOutput(state, mode, 'attackStat', accumulate)

  const resolved = {} as Record<AttackStat, number>
  for (const stat of ATTACK_STATS) {
    // Neutral base of 1: these are multipliers on the authored values.
    resolved[stat] = clampAttackParam(stat, (1 + adds[stat]) * mults[stat])
  }
  return {
    ...resolved,
    prepareTimeOffsetSec: clampOffsetSec(offsets.prepareTime),
    durationOffsetSec: clampOffsetSec(offsets.duration),
    cooldownOffsetSec: clampOffsetSec(offsets.cooldown),
  }
}

/**
 * Bound a collected `offset` total. It is in seconds, not a multiplier, so it is
 * bounded on both sides and its corrupted reading is `0` (shift nothing) rather
 * than `1`.
 */
function clampOffsetSec(offsetSec: number): number {
  if (Number.isNaN(offsetSec)) return 0
  return Math.min(MAX_ATTACK_PARAM, Math.max(-MAX_ATTACK_PARAM, offsetSec))
}

/**
 * The delay before an activated attack strikes, in game seconds, with the
 * attacker's stats applied: the authored delay **scaled** by `prepareTime`, then
 * **shifted** by `prepareTimeOffsetSec`.
 *
 * Floored at `0`, which already means "strike on the next tick" — so an offset
 * deeper than the authored delay makes the strike immediate rather than
 * scheduling it in the past. The two ops compose in that order so a relative buff
 * can't quietly undo an absolute one (a ×2 on a 10s attack with a -1s offset is
 * 19s, not 18s).
 */
export function getAttackPrepareTimeSec(def: AttackDefinition, params: AttackParams): number {
  const scaled = (def.prepareTimeSec ?? 0) * params.prepareTime
  return Math.max(0, scaled + params.prepareTimeOffsetSec)
}

/**
 * How long the strike's debuff window stays open, in game seconds, with the
 * attacker's stats applied — {@link getAttackPrepareTimeSec}'s twin: the
 * authored `durationSec` **scaled** by `duration`, then **shifted** by
 * `durationOffsetSec`, floored at `0`. An attack with no `durationSec` opens no
 * window, whatever its stats say — `0` here, and `resolveAttackStrike` never
 * pushes a zero-length window.
 */
export function getAttackDurationSec(def: AttackDefinition, params: AttackParams): number {
  if (def.durationSec === undefined) return 0
  const scaled = def.durationSec * params.duration
  return Math.max(0, scaled + params.durationOffsetSec)
}

/**
 * The rest after the attack finishes before it can be activated again, in game
 * seconds, with the attacker's stats applied — {@link getAttackDurationSec}'s
 * twin: the authored `cooldownSec` **scaled** by `cooldown`, then **shifted** by
 * `cooldownOffsetSec`, floored at `0`. An attack with no `cooldownSec` has no
 * rest, whatever its stats say.
 */
export function getAttackCooldownSec(def: AttackDefinition, params: AttackParams): number {
  if (def.cooldownSec === undefined) return 0
  const scaled = def.cooldownSec * params.cooldown
  return Math.max(0, scaled + params.cooldownOffsetSec)
}

/**
 * Game-clock time the debuff window `attackId` is currently inflicting closes,
 * or `null` when none is open — the window twin of a pending strike's
 * `readyAtSec`. Reads `meta.gameSec` off `state` as every other attack-timing
 * path does.
 *
 * Expired entries the server has not swept yet read as `null`, so a caller
 * never needs to know about the sweep.
 */
export function activeDebuffExpiresAtSec(
  state: Readonly<PlayerState>,
  attackId: string,
): number | null {
  const gameSec = readGameSec(state)
  let expiresAt: number | null = null
  for (const window of state.activeDebuffs ?? []) {
    if (window.attack !== attackId || window.expiresAtSec <= gameSec) continue
    if (expiresAt === null || window.expiresAtSec > expiresAt) expiresAt = window.expiresAtSec
  }
  return expiresAt
}

/**
 * Why an active attack cannot be activated right now. `unaffordable` is the only
 * transient reason (wait for income); every other reason is permanent for the
 * current state.
 */
export type AttackBlockReason =
  | 'unknown' // no such attack
  | 'not-active' // a passive attack (always-on, never activated)
  | 'locked' // not yet unlocked (no gating upgrade owned)
  | 'no-effects' // an effect-less placeholder — nothing to activate
  | 'already-preparing' // an activation of this attack is already pending
  | 'already-active' // this attack's debuff window is still open
  | 'cooling-down' // the attack finished; its cooldown has not elapsed
  | 'unaffordable' // valid target, cannot pay the prepare cost yet

/**
 * An attack's prepare cost resolved to concrete per-currency amounts. Attacks
 * have no cost curve, so each currency is evaluated at level 0 (`scaledCost`
 * returns `baseCost` for a flat entry). An attack with no `prepareCost` yields
 * an empty map (trivially affordable).
 *
 * `params.prepareCost` scales every currency. It is required rather than
 * defaulted for the same reason `getUpgradeNextCost`'s factors are: a price
 * quoted without the discount in force would disagree with what the server
 * charges, and requiring it makes the compiler — not a rejected activation —
 * find the call site that forgot. Pass `collectAttackParams(state, mode, id)`
 * where a player state is in hand, {@link NEUTRAL_ATTACK_PARAMS} where the
 * authored figure is what's wanted.
 *
 * Kept a pure `(def, params)` function rather than `(def, state, mode)` so a
 * render loop collects the params once instead of per cost read.
 */
export function getAttackPrepareCost(
  def: AttackDefinition,
  params: AttackParams,
): Record<string, number> {
  const cost: Record<string, number> = {}
  for (const [currency, entry] of Object.entries(def.prepareCost ?? {})) {
    cost[currency] = scaledCost(entry, 0) * params.prepareCost
  }
  return cost
}

/**
 * The reason an attack cannot be activated right now, or `null` if it can.
 * Checked in cheapest-permanent-first order so the returned reason is the most
 * fundamental one. A caller that has already collected the attack's `params`
 * (the card render does, for the cost line) can pass them to skip the
 * held-effects walk behind the affordability check.
 */
export function attackBlockReason(
  state: Readonly<PlayerState>,
  attackId: string,
  mode: ModeDefinition,
  params?: AttackParams,
): AttackBlockReason | null {
  const def = mode.attacks.find((a) => a.id === attackId)
  if (!def) return 'unknown'
  if (def.kind !== 'active') return 'not-active'
  if (!isAttackUnlocked(state, mode, attackId)) return 'locked'
  if ((def.effects?.length ?? 0) === 0) return 'no-effects'
  if (state.pendingAttacks.some((p) => p.attack === attackId)) return 'already-preparing'
  // Blocking (rather than stacking or refreshing) a window that is still open
  // is the cheap, legible option: no stacking arithmetic, no refresh-vs-extend
  // decision, and the card shows a countdown instead of a price. *Different*
  // attacks stack freely — they are separate modifiers in the pipeline.
  if (activeDebuffExpiresAtSec(state, attackId) !== null) return 'already-active'
  // After `already-active`, so a rest stamped at the strike but still queued
  // behind the open window reads as the window; before `unaffordable`, so a
  // player who can pay is still refused.
  if (cooldownUntilSec(state, 'attack', attackId) !== null) return 'cooling-down'
  const resolved = params ?? collectAttackParams(state, mode, attackId)
  if (!isCostAffordable(state.resources, getAttackPrepareCost(def, resolved))) return 'unaffordable'
  return null
}

/**
 * Validate an activation. True if the attack exists, is an unlocked active attack
 * carrying effects, isn't already preparing, inflicting a window or cooling
 * down, and the player can pay its prepare cost.
 */
export function isValidAttackActivation(
  state: Readonly<PlayerState>,
  attackId: string,
  mode: ModeDefinition,
): boolean {
  return attackBlockReason(state, attackId, mode) === null
}

/**
 * Apply an attack activation to `state`: deduct the prepare cost and push a
 * pending entry that strikes at `meta.gameSec + prepareTimeSec`. Mutates `state`
 * in place. Callers validate legality first (see `isValidAttackActivation`).
 * Never touches `score` — the prepare cost is spent from stockpile only.
 *
 * Both the cost and the delay are scaled by the attacker's `attackStat` upgrades
 * ({@link collectAttackParams}). The delay is **frozen at activation**: buying a
 * prepare-time upgrade while a strike is in flight does not pull that strike
 * forward, since the client predicted a `readyAtSec` the server must agree with.
 */
export function applyAttackActivation(
  state: PlayerState,
  attackId: string,
  mode: ModeDefinition,
): void {
  const def = mode.attacks.find((a) => a.id === attackId)
  if (!def) return
  const params = collectAttackParams(state, mode, attackId)
  for (const [currency, amount] of Object.entries(getAttackPrepareCost(def, params))) {
    state.resources[currency] = (state.resources[currency] ?? 0) - amount
  }
  const gameSec = (state.meta.gameSec as number | undefined) ?? 0
  state.pendingAttacks.push({
    attack: attackId,
    readyAtSec: gameSec + getAttackPrepareTimeSec(def, params),
  })
}

/**
 * The pending attacks that have reached their strike time (`readyAtSec <= gameSec`,
 * inclusive), in activation order. Pure — does not mutate `state`.
 */
export function dueAttacks(state: Readonly<PlayerState>, gameSec: number): PendingAttack[] {
  return state.pendingAttacks.filter((p) => p.readyAtSec <= gameSec)
}

/**
 * What a single strike did to the victim: moved `amount` of a resource, moved
 * `count` copies of a generator, or opened a debuff window of `durationSec`. A
 * union on `kind` rather than one shape with optional fields, so consumers (the
 * event feed, VFX) must branch instead of reading an absent field as
 * `undefined`.
 */
export type AttackStrikeResult = ResourceStrikeResult | GeneratorStrikeResult | DebuffStrikeResult

/** A resource theft: `amount` of `resource` moved. */
export interface ResourceStrikeResult {
  readonly kind: 'resource'
  readonly resource: string
  readonly amount: number
}

/** A generator theft: `count` copies of `generator` moved. */
export interface GeneratorStrikeResult {
  readonly kind: 'generator'
  readonly generator: string
  readonly count: number
}

/** A debuff window opened: the attack's effects apply for `durationSec`. */
export interface DebuffStrikeResult {
  readonly kind: 'debuff'
  readonly durationSec: number
}

/**
 * The output kinds the enemy-debuff collectors gather — the outputs that
 * consume an active attack's `durationSec`. The runtime twin of the validator's
 * `DEBUFF_EFFECT_TYPES` (which judges refs by *type*); an effect must join
 * both lists, or its attack would be authorable with no window, land, and
 * silently do nothing.
 */
const DEBUFF_OUTPUT_KINDS: ReadonlySet<string> = new Set([
  'enemyModifier',
  'enemyCost',
  'enemyPurchaseLock',
])

/**
 * Whether an effect output is one the enemy-debuff collectors gather — the
 * outputs that consume an active attack's `durationSec`.
 */
export function isDebuffOutput(out: EffectOutput): boolean {
  return 'kind' in out && DEBUFF_OUTPUT_KINDS.has(out.kind)
}

/**
 * Resolve an active attack's strike: move whatever its steal effects name from
 * `victim` to `attacker`, and open a debuff window if it carries any debuff
 * effect. Mutates both states in place and returns what happened (for event
 * feeds / VFX).
 *
 * Every steal magnitude is scaled by the attacker's `power`
 * ({@link collectAttackParams}) before it is capped against what the victim
 * actually has; a scaled share saturates at {@link MAX_STEAL_FRACTION}.
 *
 * - `enemyModifier` / `enemyCost` — push **one** {@link ActiveDebuff} onto
 *   `attacker.activeDebuffs` for the whole attack, however many debuff effects
 *   it carries, expiring at `meta.gameSec + getAttackDurationSec(...)`. The
 *   effects themselves are not evaluated here — `collectEnemyDebuffs` and
 *   `collectEnemyCostFactors` gather them from the window every tick, reading
 *   `power` live, exactly as they do for a passive attack. Nothing is pushed
 *   when the resolved duration is `0`, since no tick could ever gather it.
 *   Re-activation while the window is open is refused by `attackBlockReason`,
 *   so an attack has at most one open window at a time.
 *
 * - `cooldownSec` — once the strike resolves, the attack's rest is stamped into
 *   `attacker.cooldowns`: {@link getAttackCooldownSec} seconds after the window
 *   just opened closes, or after the strike itself when it opened none. Both
 *   ends are known here, so no "window closed" event is needed. Stamped even
 *   when the strike moved nothing — the activation was paid and resolved. Frozen
 *   like the window: a cooldown upgrade bought mid-rest shortens the next rest.
 *
 * - `resourceSteal` — either `fraction × (victim's held amount)` or a flat
 *   `amount`, whichever the effect authored. Capped at what the victim holds, so
 *   a flat steal against an emptier stockpile takes the stockpile rather than
 *   overdrawing it (a share can't overshoot on its own, `fraction` being at most
 *   1). The attacker is credited via `creditResource` with an *empty* score
 *   resource, so stolen resources never count toward score.
 * - `generatorSteal` — either `fraction × (victim's owned copies)`, floored to a
 *   whole copy, or a flat `count`; capped at what the victim owns. Copies simply
 *   change hands, so *both* cost curves move with them: the victim's next copy
 *   gets cheaper and the attacker's dearer, since price is a function of owned
 *   count. No unlock check on either side — the attacker keeps and produces from
 *   a generator they never unlocked (`collectModifiers` reads owned counts, not
 *   gates), though buying more still requires the unlock.
 */
export function resolveAttackStrike(
  attacker: PlayerState,
  victim: PlayerState,
  def: AttackDefinition,
  mode: ModeDefinition,
): AttackStrikeResult[] {
  const results: AttackStrikeResult[] = []
  const params = collectAttackParams(attacker, mode, def.id)
  const { power } = params
  let opensWindow = false
  for (const ref of def.effects ?? []) {
    for (const out of normalizeEffectOutputs(applyEffect(ref, attacker, mode))) {
      if (!('kind' in out)) continue
      if (isDebuffOutput(out)) {
        opensWindow = true
      } else if (out.kind === 'resourceSteal') {
        const held = victim.resources[out.resource] ?? 0
        const requested =
          'amount' in out
            ? out.amount * power
            : held * Math.min(MAX_STEAL_FRACTION, out.fraction * power)
        const amount = Math.min(held, Math.max(0, requested))
        if (amount <= 0) continue
        victim.resources[out.resource] = held - amount
        creditResource(attacker, out.resource, amount, '')
        results.push({ kind: 'resource', resource: out.resource, amount })
      } else if (out.kind === 'generatorSteal') {
        const owned = victim.generators[out.generator] ?? 0
        // Floor a share to a whole copy: half of three sawmills is one, and half
        // of one is none (which drops out below rather than moving a fraction).
        // A `power`-scaled flat count floors for the same reason.
        const requested =
          'count' in out
            ? Math.floor(out.count * power)
            : Math.floor(owned * Math.min(MAX_STEAL_FRACTION, out.fraction * power))
        const count = Math.min(owned, Math.max(0, requested))
        if (count <= 0) continue
        victim.generators[out.generator] = owned - count
        attacker.generators[out.generator] = (attacker.generators[out.generator] ?? 0) + count
        results.push({ kind: 'generator', generator: out.generator, count })
      }
    }
  }
  const gameSec = readGameSec(attacker)
  let finishesAtSec = gameSec
  if (opensWindow) {
    const durationSec = getAttackDurationSec(def, params)
    if (durationSec > 0) {
      const window: ActiveDebuff = { attack: def.id, expiresAtSec: gameSec + durationSec }
      attacker.activeDebuffs = [...(attacker.activeDebuffs ?? []), window]
      results.push({ kind: 'debuff', durationSec })
      finishesAtSec = window.expiresAtSec
    }
  }
  const cooldownSec = getAttackCooldownSec(def, params)
  if (cooldownSec > 0) startCooldown(attacker, 'attack', def.id, finishesAtSec + cooldownSec)
  return results
}

/**
 * The debuff windows in `state` that are still open at `gameSec` (strictly
 * before `expiresAtSec`). Pure — does not mutate `state`. The server's tick uses
 * it to sweep expired windows; the collectors apply the same test at read time,
 * which is what makes the sweep hygiene rather than correctness.
 */
export function openDebuffWindows(state: Readonly<PlayerState>, gameSec: number): ActiveDebuff[] {
  return (state.activeDebuffs ?? []).filter((w) => w.expiresAtSec > gameSec)
}

/**
 * Drop the debuff windows that have closed by `gameSec`; delete the field once
 * empty — absent rather than `[]`, the same convention as `incomingCostFactors`
 * and `cooldowns`, so a quiet round carries nothing. The twin of
 * `sweepCooldowns`: the server's tick runs both; the collectors already ignore
 * a closed window at read time, so this only bounds the array.
 */
export function sweepDebuffWindows(state: PlayerState, gameSec: number): void {
  if (!state.activeDebuffs) return
  const open = openDebuffWindows(state, gameSec)
  if (open.length === 0) delete state.activeDebuffs
  else if (open.length !== state.activeDebuffs.length) state.activeDebuffs = open
}

// ─── Attack slots ────────────────────────────────────────────────────
//
// A budget on how many attacks of each kind a player can *hold*. Unlocking stays
// derived and monotonic (`isAttackUnlocked`); the cap turns each unlock into an
// irreversible commitment by refusing the *purchase* that would exceed it. The
// algorithm lives in `slots.ts`, shared with the pact budget; this is the
// attack system's description of itself, and the rules under their own names.

const attackSlots = makeSlotBudget<AttackKind>({
  grantType: 'attackSlots',
  readGrant: (out) =>
    'kind' in out && out.kind === 'attackSlots' ? { kind: out.attackKind, value: out.value } : null,
  unlockType: 'unlockAttack',
  readUnlock: (out) => ('kind' in out && out.kind === 'attackUnlock' ? out.attack : null),
  entities: (mode) => mode.attacks,
  isUnlocked: (state, mode, id) => isAttackUnlocked(state, mode, id),
  unlocked: (state, mode) => unlockedAttacks(state, mode),
})

/** Whether the mode caps how many attacks of `kind` a player may hold. */
export function isAttackKindCapped(mode: ModeDefinition, kind: AttackKind): boolean {
  return attackSlots.isCapped(mode, kind)
}

/**
 * How many attacks of `kind` this player may hold: the mode's base grant plus
 * `value × owned` for every owned `attackSlots` upgrade naming the kind.
 * `Infinity` for a kind the mode never caps (see {@link isAttackKindCapped}).
 */
export function attackLimit(
  state: Readonly<PlayerState>,
  mode: ModeDefinition,
  kind: AttackKind,
): number {
  return attackSlots.limit(state, mode, kind)
}

/**
 * How many attacks of `kind` this player holds — the unlocked attacks, filtered
 * by kind. Counts *attacks*, not unlock upgrades (see `SlotBudget.held`).
 */
export function attackSlotsHeld(
  state: Readonly<PlayerState>,
  mode: ModeDefinition,
  kind: AttackKind,
): number {
  return attackSlots.held(state, mode, kind)
}

/**
 * Whether buying one more level of `def` fits the player's attack budget —
 * all-or-nothing over the attacks it would newly unlock, counting any slots it
 * grants itself (see `SlotBudget.hasSlotsFor`). An upgrade with no
 * `unlockAttack` effect is never blocked here.
 */
export function hasAttackSlotsFor(
  state: Readonly<PlayerState>,
  def: UpgradeDefinition,
  mode: ModeDefinition,
): boolean {
  return attackSlots.hasSlotsFor(state, def, mode)
}

// ─── Attack alert ────────────────────────────────────────────────────
//
// An early warning of enemy active strikes. Purely a *viewer-side* grant: the
// server reads it for the victim and projects the attacker's pending strikes
// due within the lead onto the victim's opponent view. Nothing here touches
// the attacker's state or the strike itself.

/** Whether an effect output is an attack-alert grant. */
function isAttackAlertOutput(out: EffectOutput): out is AttackAlertOutput {
  return 'kind' in out && out.kind === 'attackAlert'
}

/** A player's resolved early-warning grant (see {@link collectAttackAlert}). */
export interface AttackAlert {
  /** Total seconds of warning; `0` when no alert is owned. */
  readonly leadSec: number
  /** Whether the warning may name the incoming attack. */
  readonly revealAttack: boolean
}

/** The alert a player with no `attackAlert` grant has — no warning at all. */
export const NO_ATTACK_ALERT: AttackAlert = { leadSec: 0, revealAttack: false }

/**
 * Collect a player's early-warning grant from every owned `attackAlert`
 * effect (plus the mode's own): the lead is the additive fold `attackLimit`
 * applies to slots — `leadSec × owned` per grant — and the reveal is true if
 * any owned grant says so. A reveal-only grant contributes no lead, and a lead
 * of `0` means "no alert" however the reveal reads: there is nothing to reveal
 * on.
 */
export function collectAttackAlert(
  state: Readonly<PlayerState>,
  mode: ModeDefinition,
): AttackAlert {
  let leadSec = 0
  let revealAttack = false
  forEachHeldEffectOutput(state, mode, 'attackAlert', (out, owned) => {
    if (!isAttackAlertOutput(out)) return
    leadSec += out.leadSec * owned
    if (out.revealAttack) revealAttack = true
  })
  if (leadSec <= 0) return NO_ATTACK_ALERT
  return { leadSec, revealAttack }
}

/**
 * The opponent's pending strikes that fall inside `alert`'s lead at `gameSec`,
 * in activation order — what the server shows the warned player. Pure. Empty
 * when the alert grants no lead, so a caller never needs to test that first.
 * Inclusive at exactly `leadSec` remaining, as `dueAttacks` is at zero.
 */
export function incomingAttacksWithin(
  attacker: Readonly<PlayerState>,
  gameSec: number,
  alert: AttackAlert,
): PendingAttack[] {
  if (alert.leadSec <= 0) return []
  return attacker.pendingAttacks.filter((p) => p.readyAtSec - gameSec <= alert.leadSec)
}
