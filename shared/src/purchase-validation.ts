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
import { getUpgradeNextCost, isCostAffordable } from './upgrade-costs.js'
import { canAffordGenerator, isGeneratorUnlocked, resolveGeneratorDef } from './generators.js'
import type { ModeDefinition } from './modes/types.js'
import type { PlayerState, UpgradeDefinition } from './types.js'

/** Why an upgrade purchase is disallowed. `unaffordable` is the only transient one. */
export type PurchaseBlockReason =
  | 'unknown' // no such upgrade
  | 'maxed' // already at purchaseLimit
  | 'prerequisite' // prerequisites not satisfied
  | 'choice-group' // a mutually exclusive sibling was already taken
  | 'unaffordable' // valid target, cannot pay the next cost yet

/**
 * The reason an upgrade cannot be purchased right now, or `null` if it can.
 * Checked in cheapest-permanent-first order so the returned reason is the most
 * fundamental one.
 */
export function purchaseBlockReason(
  state: PlayerState,
  upgradeId: string,
  upgradeMap: ReadonlyMap<string, UpgradeDefinition>,
): PurchaseBlockReason | null {
  const def = upgradeMap.get(upgradeId)
  if (!def) return 'unknown'

  const owned = state.upgrades[upgradeId] ?? 0
  if (isMaxed(def, owned)) return 'maxed'
  if (!isPrerequisiteSatisfied(def.prerequisites, state)) return 'prerequisite'
  if (!isChoiceGroupAvailable(def, state, Array.from(upgradeMap.values()))) return 'choice-group'
  if (!isCostAffordable(state.resources, getUpgradeNextCost(def, owned))) return 'unaffordable'
  return null
}

/**
 * Validate a purchase action. True if the player can afford the upgrade, hasn't
 * hit its purchase limit, satisfies its prerequisites, and no mutually exclusive
 * sibling is already owned.
 */
export function isValidPurchase(
  state: PlayerState,
  upgradeId: string,
  upgradeMap: ReadonlyMap<string, UpgradeDefinition>,
): boolean {
  return purchaseBlockReason(state, upgradeId, upgradeMap) === null
}

/** Why a generator purchase is disallowed. `unaffordable` is the only transient one. */
export type GeneratorBlockReason =
  | 'unknown' // no such generator
  | 'locked' // not yet unlocked (no gating upgrade owned)
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
  if (!canAffordGenerator(state, resolveGeneratorDef(def, state, mode))) return 'unaffordable'
  return null
}

/**
 * Validate a generator purchase. True if the generator exists, is unlocked, and
 * the player can afford the next (cost-adjusted) copy.
 */
export function isValidGeneratorPurchase(
  state: PlayerState,
  generatorId: string,
  mode: ModeDefinition,
): boolean {
  return generatorBlockReason(state, generatorId, mode) === null
}

/** Why a generator sale is disallowed. Both reasons are permanent. */
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
