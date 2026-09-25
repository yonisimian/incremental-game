// @game/shared — pure purchase-validation rules.
//
// These were previously in `server/src/validation.ts`; they are built entirely
// from shared primitives, so they live here and the server re-imports them. That
// keeps one implementation of "can this be bought" shared by the authoritative
// server tick and the headless strategy simulator (see `simulation/`).
//
// Each validator is expressed in terms of a `*BlockReason` helper that returns
// *why* a purchase is disallowed (or `null` when allowed). The boolean
// `isValid*` wrappers are `reason === null`, so the reason and the go/no-go
// answer can never drift. The simulator uses the reason to distinguish a
// *transient* block (unaffordable — wait for income) from a *permanent* one
// (maxed / choice-group closed / prerequisite unmet / locked / unknown — give up
// and report), while the server only needs the boolean.

import { isChoiceGroupAvailable } from './upgrade-groups.js'
import { isMaxed } from './modes/index.js'
import { isPrerequisiteSatisfied } from './prerequisites.js'
import { getUpgradeNextCost, isCostAffordable, upgradeCostFactors } from './upgrade-costs.js'
import { canAffordGenerator, isGeneratorUnlocked, resolveGeneratorDef } from './generators.js'
import { hasAttackSlotsFor } from './attacks.js'
import type { ModeDefinition } from './modes/types.js'
import type { CostScope, PlayerState, UpgradeDefinition } from './types.js'

/**
 * Whether an opponent's open attack window currently bars this player from
 * buying anything of `scope` (plan 40). Reads the server-stamped
 * {@link PlayerState.incomingPurchaseLocks} by *presence* — not by comparing
 * `untilSec` against the clock — so a client whose game clock has drifted a
 * tick still agrees with the server on whether a buy goes through. The lock
 * lifts when the next stamp omits the scope.
 */
export function isPurchaseLocked(state: Readonly<PlayerState>, scope: CostScope): boolean {
  return state.incomingPurchaseLocks?.some((lock) => lock.scope === scope) ?? false
}

/**
 * Seconds until the lock on `scope` lifts, or `null` when none is stamped —
 * the victim-side countdown, the twin of `activeDebuffRemainingSec` on the
 * attacker's side. Reads `meta.gameSec` off `state` as every attack-timing path
 * does, and floors at `0` so a stamp the server has not refreshed yet never
 * reads as a negative wait.
 */
export function purchaseLockRemainingSec(
  state: Readonly<PlayerState>,
  scope: CostScope,
): number | null {
  const lock = state.incomingPurchaseLocks?.find((l) => l.scope === scope)
  if (!lock) return null
  const gameSec = (state.meta.gameSec as number | undefined) ?? 0
  return Math.max(0, lock.untilSec - gameSec)
}

/**
 * Why an upgrade purchase is disallowed. `unaffordable` is the only reason
 * income can fix; `locked-by-attack` is the only one *time* fixes (the window
 * closes on its own); every other reason is permanent for the current state.
 */
export type PurchaseBlockReason =
  | 'unknown' // no such upgrade
  | 'maxed' // already at purchaseLimit
  | 'prerequisite' // prerequisites not satisfied
  | 'choice-group' // a mutually exclusive sibling was already taken
  | 'attack-slots' // would unlock more attacks of a kind than the player has slots for
  | 'locked-by-attack' // an opponent's open attack window bars upgrade purchases
  | 'unaffordable' // valid target, cannot pay the next cost yet

/**
 * The reason an upgrade cannot be purchased right now, or `null` if it can.
 * Checked in cheapest-permanent-first order so the returned reason is the most
 * fundamental one.
 *
 * `upgradeMap` is the mode's upgrade lookup, built once by the caller; `mode` is
 * the definition it was built from, needed by the attack-slot rule (which reads
 * the mode's attacks and slot grants). Both are passed rather than deriving one
 * from the other so the hot server path keeps its prebuilt index.
 */
export function purchaseBlockReason(
  state: PlayerState,
  upgradeId: string,
  upgradeMap: ReadonlyMap<string, UpgradeDefinition>,
  mode: ModeDefinition,
): PurchaseBlockReason | null {
  const def = upgradeMap.get(upgradeId)
  if (!def) return 'unknown'

  const owned = state.upgrades[upgradeId] ?? 0
  if (isMaxed(def, owned)) return 'maxed'
  if (!isPrerequisiteSatisfied(def.prerequisites, state)) return 'prerequisite'
  if (!isChoiceGroupAvailable(def, state, Array.from(upgradeMap.values()))) return 'choice-group'
  // Permanent for the current state (only a slot upgrade can lift it), so it
  // sits with the permanent reasons, ahead of the transient `unaffordable`.
  if (!hasAttackSlotsFor(state, def, mode)) return 'attack-slots'
  // After the structural reasons, before the transient one: a player who is
  // locked *and* broke is told they are locked, since that is the thing no
  // income of theirs can fix right now.
  if (isPurchaseLocked(state, 'upgrade')) return 'locked-by-attack'
  const cost = getUpgradeNextCost(def, owned, upgradeCostFactors(state, upgradeId))
  if (!isCostAffordable(state.resources, cost)) return 'unaffordable'
  return null
}

/**
 * Validate a purchase action. True if the player can afford the upgrade, hasn't
 * hit its purchase limit, satisfies its prerequisites, no mutually exclusive
 * sibling is already owned, any attack it unlocks fits the player's slots, and
 * no enemy purchase lock is in force.
 */
export function isValidPurchase(
  state: PlayerState,
  upgradeId: string,
  upgradeMap: ReadonlyMap<string, UpgradeDefinition>,
  mode: ModeDefinition,
): boolean {
  return purchaseBlockReason(state, upgradeId, upgradeMap, mode) === null
}

/**
 * Why a generator purchase is disallowed. `unaffordable` is the only reason
 * income fixes and `locked-by-attack` the only one time fixes; the rest are
 * permanent for the current state.
 */
export type GeneratorBlockReason =
  | 'unknown' // no such generator
  | 'locked' // not yet unlocked (no gating upgrade owned)
  | 'locked-by-attack' // an opponent's open attack window bars generator purchases
  | 'unaffordable' // valid target, cannot pay the next copy yet

/** The reason a generator cannot be purchased right now, or `null` if it can. */
export function generatorBlockReason(
  state: PlayerState,
  generatorId: string,
  mode: ModeDefinition,
): GeneratorBlockReason | null {
  const def = mode.generators.find((g) => g.id === generatorId)
  if (!def) return 'unknown'
  if (!isGeneratorUnlocked(state, def, mode)) return 'locked'
  if (isPurchaseLocked(state, 'generator')) return 'locked-by-attack'
  if (!canAffordGenerator(state, resolveGeneratorDef(def, state, mode, 'buy')))
    return 'unaffordable'
  return null
}

/**
 * Validate a generator purchase. True if the generator exists, is unlocked, no
 * enemy purchase lock is in force, and the player can afford the next
 * (cost-adjusted) copy.
 */
export function isValidGeneratorPurchase(
  state: PlayerState,
  generatorId: string,
  mode: ModeDefinition,
): boolean {
  return generatorBlockReason(state, generatorId, mode) === null
}

/**
 * Why a generator sale is disallowed. Both reasons are permanent. An enemy
 * purchase lock is deliberately *not* one of them: the lock is on spending, and
 * barring a sale would let an attack strand a victim who needs to liquidate.
 */
export type GeneratorSellBlockReason =
  | 'unknown' // no such generator
  | 'not-owned' // owns zero copies

export function generatorSellBlockReason(
  state: PlayerState,
  generatorId: string,
  mode: ModeDefinition,
): GeneratorSellBlockReason | null {
  const def = mode.generators.find((g) => g.id === generatorId)
  if (!def) return 'unknown'
  if ((state.generators[generatorId] ?? 0) <= 0) return 'not-owned'
  return null
}

export function isValidGeneratorSell(
  state: PlayerState,
  generatorId: string,
  mode: ModeDefinition,
): boolean {
  return generatorSellBlockReason(state, generatorId, mode) === null
}
