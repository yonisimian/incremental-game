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
import type { ModeDefinition } from './modes/types.js'
import type { AttackDefinition, PendingAttack, PlayerState } from './types.js'

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
  | 'unaffordable' // valid target, cannot pay the prepare cost yet

/**
 * An attack's prepare cost resolved to concrete per-currency amounts. Attacks
 * have no cost curve, so each currency is evaluated at level 0 (`scaledCost`
 * returns `baseCost` for a flat entry). An attack with no `prepareCost` yields
 * an empty map (trivially affordable).
 */
export function getAttackPrepareCost(def: AttackDefinition): Record<string, number> {
  const cost: Record<string, number> = {}
  for (const [currency, entry] of Object.entries(def.prepareCost ?? {})) {
    cost[currency] = scaledCost(entry, 0)
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
  if (!isCostAffordable(state.resources, getAttackPrepareCost(def))) return 'unaffordable'
  return null
}

/**
 * Validate an activation. True if the attack exists, is an unlocked active attack
 * carrying effects, isn't already preparing, and the player can pay its prepare
 * cost.
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
 */
export function applyAttackActivation(
  state: PlayerState,
  attackId: string,
  mode: ModeDefinition,
): void {
  const def = mode.attacks.find((a) => a.id === attackId)
  if (!def) return
  for (const [currency, amount] of Object.entries(getAttackPrepareCost(def))) {
    state.resources[currency] = (state.resources[currency] ?? 0) - amount
  }
  const gameSec = (state.meta.gameSec as number | undefined) ?? 0
  state.pendingAttacks.push({ attack: attackId, readyAtSec: gameSec + (def.prepareTimeSec ?? 0) })
}

/**
 * The pending attacks that have reached their strike time (`readyAtSec <= gameSec`,
 * inclusive), in activation order. Pure — does not mutate `state`.
 */
export function dueAttacks(state: Readonly<PlayerState>, gameSec: number): PendingAttack[] {
  return state.pendingAttacks.filter((p) => p.readyAtSec <= gameSec)
}

/**
 * What a single strike moved from victim to attacker: `amount` of a resource,
 * or `count` copies of a generator. A union on `kind` rather than one shape with
 * optional fields, so consumers (the event feed, VFX) must branch instead of
 * reading an absent field as `undefined`.
 */
export type AttackStrikeResult = ResourceStrikeResult | GeneratorStrikeResult

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

/**
 * Resolve an active attack's strike, moving whatever its steal effects name from
 * `victim` to `attacker`. Mutates both states in place and returns what was
 * moved (for event feeds / VFX).
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
  for (const ref of def.effects ?? []) {
    for (const out of normalizeEffectOutputs(applyEffect(ref, attacker, mode))) {
      if (!('kind' in out)) continue
      if (out.kind === 'resourceSteal') {
        const held = victim.resources[out.resource] ?? 0
        const requested = 'amount' in out ? out.amount : held * out.fraction
        const amount = Math.min(held, Math.max(0, requested))
        if (amount <= 0) continue
        victim.resources[out.resource] = held - amount
        creditResource(attacker, out.resource, amount, '')
        results.push({ kind: 'resource', resource: out.resource, amount })
      } else if (out.kind === 'generatorSteal') {
        const owned = victim.generators[out.generator] ?? 0
        // Floor a share to a whole copy: half of three sawmills is one, and half
        // of one is none (which drops out below rather than moving a fraction).
        const requested = 'count' in out ? out.count : Math.floor(owned * out.fraction)
        const count = Math.min(owned, Math.max(0, requested))
        if (count <= 0) continue
        victim.generators[out.generator] = owned - count
        attacker.generators[out.generator] = (attacker.generators[out.generator] ?? 0) + count
        results.push({ kind: 'generator', generator: out.generator, count })
      }
    }
  }
  return results
}
