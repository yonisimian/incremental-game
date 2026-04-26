import type { Modifier } from '../modifiers/types.js'
import type { GameMode, Goal, PlayerState } from '../types.js'
import type { ModeDefinition } from './types.js'
import { clickerMode } from './clicker.js'
import { idlerMode } from './idler.js'

// ─── Registry ────────────────────────────────────────────────────────

const MODE_REGISTRY: Record<GameMode, ModeDefinition> = {
  clicker: clickerMode,
  idler: idlerMode,
}

/** Look up the mode definition for a GameMode. */
export function getModeDefinition(mode: GameMode): ModeDefinition {
  return MODE_REGISTRY[mode]
}

/** Get the default goal for a mode (first in the goals array). */
export function getDefaultGoal(mode: GameMode): Goal {
  return MODE_REGISTRY[mode].goals[0]
}

// ─── Initial State ───────────────────────────────────────────────────

/** Create a fresh player state for a given mode. */
export function createInitialState(mode: ModeDefinition): PlayerState {
  return {
    score: 0,
    resources: { ...mode.initialResources },
    upgrades: Object.fromEntries(mode.upgrades.map((u) => [u.id, 0])),
    generators: Object.fromEntries(mode.generators.map((g) => [g.id, 0])),
    meta: structuredClone(mode.initialMeta),
  }
}

// ─── Modifier Collection ─────────────────────────────────────────────

/**
 * Collect all active modifiers for a player: native + owned upgrades + state-derived.
 * This is the bridge between game domain types and the pure pipeline.
 */
export function collectModifiers(state: Readonly<PlayerState>, mode: ModeDefinition): Modifier[] {
  const modifiers: Modifier[] = []

  // Native modifiers (base income rates for this mode)
  modifiers.push(...mode.nativeModifiers)

  // Upgrade modifiers
  for (const upgrade of mode.upgrades) {
    const owned = state.upgrades[upgrade.id] ?? 0
    if (owned <= 0) continue

    if (upgrade.repeatable) {
      // Repeatable: scale modifier values by the owned count
      for (const mod of upgrade.modifiers) {
        modifiers.push({ stage: mod.stage, field: mod.field, value: mod.value * owned })
      }
    } else {
      // One-shot upgrade: emit modifiers as-is
      modifiers.push(...upgrade.modifiers)
    }
  }

  // Dynamic (state-derived) modifiers — mode-specific hook
  if (mode.collectDynamic) {
    modifiers.push(...mode.collectDynamic(state))
  }

  // Generator modifiers
  for (const gen of mode.generators) {
    const owned = state.generators[gen.id] ?? 0
    if (owned <= 0) continue
    modifiers.push({
      stage: 'additive',
      field: gen.production.resource,
      value: gen.production.rate * owned,
    })
  }

  return modifiers
}

// ─── Purchase ────────────────────────────────────────────────────────

/**
 * Apply an upgrade purchase to the player state.
 * Deducts the cost from the correct resource and grants the upgrade.
 * Mutates `state` in place.
 *
 * Callers are responsible for validating that the purchase is legal.
 */
export function applyPurchase(state: PlayerState, upgradeId: string, mode: ModeDefinition): void {
  const def = mode.upgrades.find((u) => u.id === upgradeId)
  if (!def) return

  // Deduct from correct resource
  const costResource = def.costCurrency ?? mode.scoreResource
  state.resources[costResource] = (state.resources[costResource] ?? 0) - def.cost

  // Grant upgrade
  state.upgrades[upgradeId] = (state.upgrades[upgradeId] ?? 0) + 1
}
