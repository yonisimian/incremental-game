// @game/shared — pure active-attack rules: activation validation, preparation
// bookkeeping, and strike resolution.
//
// Mirrors `purchase-validation.ts`'s "reason or null" pattern: `attackBlockReason`
// returns *why* an activation is disallowed (or `null` when allowed) and
// `isValidAttackActivation` is `reason === null`, so the two can never drift.
// The server tick uses `dueAttacks` + `resolveAttackStrike` to land strikes;
// the client re-uses `applyAttackActivation` for optimistic prediction.

import { scaledCost } from './cost.js'
import { isCostAffordable } from './upgrade-costs.js'
import { creditResource } from './modifiers/pipeline.js'
import { isAttackUnlocked } from './modes/index.js'
import { applyEffect, normalizeEffectOutputs } from './effects/registry.js'
import { ATTACK_STATS } from './effects/seed/attack-stat.js'
import type { AttackStat } from './effects/seed/attack-stat.js'
import type { AttackStatOutput, EffectOutput } from './effects/types.js'
import type { ModeDefinition } from './modes/types.js'
import type {
  ActiveDebuff,
  AttackDefinition,
  AttackKind,
  EffectRef,
  PendingAttack,
  PlayerState,
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
}

/**
 * The stats only an *active* attack can use. A passive attack is always-on and
 * never activated — `validateModeDefinition` forbids it from declaring a
 * `prepareCost`, `prepareTimeSec` or `durationSec` at all — so a stat moving any
 * of them would be authored dead weight.
 */
const ACTIVE_ONLY_ATTACK_STATS: readonly AttackStat[] = ['prepareCost', 'prepareTime', 'duration']

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
 */
const ATTACK_PARAM_FLOORS: Record<AttackStat, number> = {
  power: 0,
  prepareCost: 0,
  prepareTime: 0,
  duration: 0,
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

  const accumulate = (out: AttackStatOutput, owned: number): void => {
    if (out.attack !== attackId) return
    // `offset` is absolute (the stat's own unit) and so never touches the
    // multiplier; like `add` it scales linearly with the owned count.
    if (out.op === 'offset') offsets[out.stat] += out.value * owned
    else if (out.op === 'add') adds[out.stat] += out.value * owned
    else mults[out.stat] *= out.value ** owned
  }

  const collect = (refs: readonly EffectRef[] | undefined, owned: number): void => {
    for (const ref of refs ?? []) {
      // Skip non-stat effects without running them, matching
      // `collectBatteryParams`.
      if (ref.type !== 'attackStat') continue
      for (const o of normalizeEffectOutputs(applyEffect(ref, state, mode))) {
        if (isAttackStatOutput(o)) accumulate(o, owned)
      }
    }
  }

  collect(mode.effects, 1)
  for (const upgrade of mode.upgrades) {
    const owned = state.upgrades[upgrade.id] ?? 0
    if (owned > 0) collect(upgrade.effects, owned)
  }

  const resolved = {} as Record<AttackStat, number>
  for (const stat of ATTACK_STATS) {
    // Neutral base of 1: these are multipliers on the authored values.
    resolved[stat] = clampAttackParam(stat, (1 + adds[stat]) * mults[stat])
  }
  return {
    ...resolved,
    prepareTimeOffsetSec: clampOffsetSec(offsets.prepareTime),
    durationOffsetSec: clampOffsetSec(offsets.duration),
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
 * Seconds left on the debuff window `attackId` is currently inflicting, or
 * `null` when none is open — the window twin of the panel's `pendingRemaining`.
 * Reads `meta.gameSec` off `state` as every other attack-timing path does.
 *
 * Expired entries the server has not swept yet read as `null`, so a caller
 * never needs to know about the sweep.
 */
export function activeDebuffRemainingSec(
  state: Readonly<PlayerState>,
  attackId: string,
): number | null {
  const gameSec = (state.meta.gameSec as number | undefined) ?? 0
  let remaining: number | null = null
  for (const window of state.activeDebuffs ?? []) {
    if (window.attack !== attackId) continue
    const left = window.expiresAtSec - gameSec
    if (left > 0 && (remaining === null || left > remaining)) remaining = left
  }
  return remaining
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
 * fundamental one.
 */
export function attackBlockReason(
  state: Readonly<PlayerState>,
  attackId: string,
  mode: ModeDefinition,
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
  if (activeDebuffRemainingSec(state, attackId) !== null) return 'already-active'
  const params = collectAttackParams(state, mode, attackId)
  if (!isCostAffordable(state.resources, getAttackPrepareCost(def, params))) return 'unaffordable'
  return null
}

/**
 * Validate an activation. True if the attack exists, is an unlocked active attack
 * carrying effects, isn't already preparing or inflicting a window, and the
 * player can pay its prepare cost.
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
 * Whether an effect output is one the enemy-debuff collectors gather — the
 * outputs that consume an active attack's `durationSec`.
 */
export function isDebuffOutput(out: EffectOutput): boolean {
  return 'kind' in out && (out.kind === 'enemyModifier' || out.kind === 'enemyCost')
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
  if (opensWindow) {
    const durationSec = getAttackDurationSec(def, params)
    if (durationSec > 0) {
      const gameSec = (attacker.meta.gameSec as number | undefined) ?? 0
      const window: ActiveDebuff = { attack: def.id, expiresAtSec: gameSec + durationSec }
      attacker.activeDebuffs = [...(attacker.activeDebuffs ?? []), window]
      results.push({ kind: 'debuff', durationSec })
    }
  }
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
