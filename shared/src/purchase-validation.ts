// @game/shared — pure purchase-validation rules.
//
// Built entirely from shared primitives, so the authoritative server tick and
// the headless strategy simulator (see `simulation/`) share one implementation
// of "can this be bought".
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
import { hasPactSlotsFor } from './pacts.js'
import type { ModeDefinition } from './modes/types.js'
import type { CostScope, PlayerState, PurchaseLock, UpgradeDefinition } from './types.js'

/** Whether `lock` bars buying `id` of `scope` — a whole-scope lock, or one naming `id`. */
function locksEntity(lock: PurchaseLock, scope: CostScope, id: string): boolean {
  return lock.scope === scope && (lock.id === undefined || lock.id === id)
}

/**
 * Whether an opponent's open attack window currently bars this player from
 * buying `id` of `scope`. Reads the server-stamped
 * {@link PlayerState.incomingPurchaseLocks} by *presence* — not by comparing
 * `untilSec` against the clock — so a client whose game clock has drifted a
 * tick still agrees with the server on whether a buy goes through. The lock
 * lifts when the next stamp omits it.
 */
export function isPurchaseLocked(
  state: Readonly<PlayerState>,
  scope: CostScope,
  id: string,
): boolean {
  return state.incomingPurchaseLocks?.some((lock) => locksEntity(lock, scope, id)) ?? false
}

/**
 * Game-clock time every lock barring `id` of `scope` lifts, or `null` when none
 * is stamped — the victim-side twin of `activeDebuffExpiresAtSec`. A stamp the
 * server has not refreshed yet may already be in the past.
 */
export function purchaseLockUntilSec(
  state: Readonly<PlayerState>,
  scope: CostScope,
  id: string,
): number | null {
  const locks = (state.incomingPurchaseLocks ?? []).filter((l) => locksEntity(l, scope, id))
  return locks.length === 0 ? null : Math.max(...locks.map((l) => l.untilSec))
}

/**
 * Why an upgrade purchase is disallowed. `unaffordable` is the only reason
 * income can fix; `locked-by-attack` is the only one *time* fixes (the window
 * closes on its own); every other reason is permanent for the current state.
 */
export type PurchaseBlockReason =
  | 'unknown' // no such upgrade
  | 'coming-soon' // announced on the tree, not yet purchasable
  | 'maxed' // already at purchaseLimit
  | 'prerequisite' // prerequisites not satisfied
  | 'choice-group' // a mutually exclusive sibling was already taken
  | 'attack-slots' // would unlock more attacks of a kind than the player has slots for
  | 'pact-slots' // would unlock more pacts of a kind than the player has slots for
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
  if (def.comingSoon) return 'coming-soon'

  const owned = state.upgrades[upgradeId] ?? 0
  if (isMaxed(def, owned)) return 'maxed'
  if (!isPrerequisiteSatisfied(def.prerequisites, state)) return 'prerequisite'
  if (!isChoiceGroupAvailable(def, state, Array.from(upgradeMap.values()))) return 'choice-group'
  // Permanent for the current state (only a slot upgrade can lift it), so it
  // sits with the permanent reasons, ahead of the transient `unaffordable`.
  if (!hasAttackSlotsFor(state, def, mode)) return 'attack-slots'
  if (!hasPactSlotsFor(state, def, mode)) return 'pact-slots'
  // After the structural reasons, before the transient one: a player who is
  // locked *and* broke is told they are locked, since that is the thing no
  // income of theirs can fix right now.
  if (isPurchaseLocked(state, 'upgrade', upgradeId)) return 'locked-by-attack'
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
  if (isPurchaseLocked(state, 'generator', generatorId)) return 'locked-by-attack'
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
