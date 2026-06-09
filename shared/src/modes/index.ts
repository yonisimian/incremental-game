import type { Modifier } from '../modifiers/types.js'
import type { GameMode, Goal, PlayerState, UpgradeDefinition } from '../types.js'
import type { ModeDefinition } from './types.js'
import { idlerMode } from './idler.js'
import { validateUpgradePrerequisites } from '../prerequisites.js'
import { validateUpgradeChoiceGroups } from '../upgrade-groups.js'
import { getUpgradeNextCost } from '../upgrade-costs.js'

export { IDLER_TIMED_ENVELOPE } from './idler-envelope.js'

// ─── Validation ──────────────────────────────────────────────────────

/** Validate that flavor ↔ mechanics agree. Called once per mode at startup. */
export function validateModeDefinition(id: string, def: ModeDefinition): void {
  const f = def.flavor

  // Resource keys must match exactly (same set, same count)
  const mechKeys = new Set(def.resources)
  const flavorKeys = new Set(f.resources.map((r) => r.key))
  if (mechKeys.size !== flavorKeys.size || ![...mechKeys].every((k) => flavorKeys.has(k)))
    throw new Error(`[${id}] flavor.resources keys don't match mode.resources`)

  // Every mechanical upgrade must have a flavor entry
  for (const u of def.upgrades) {
    if (!f.upgrades.some((fu) => fu.id === u.id))
      throw new Error(`[${id}] missing flavor for upgrade '${u.id}'`)
  }

  // Every mechanical generator must have a flavor entry
  for (const g of def.generators) {
    if (!f.generators.some((fg) => fg.id === g.id))
      throw new Error(`[${id}] missing flavor for generator '${g.id}'`)
  }

  // No orphan flavor entries (flavor references nonexistent mechanic)
  for (const fu of f.upgrades) {
    if (!def.upgrades.some((u) => u.id === fu.id))
      throw new Error(`[${id}] flavor references unknown upgrade '${fu.id}'`)
  }
  for (const fg of f.generators) {
    if (!def.generators.some((g) => g.id === fg.id))
      throw new Error(`[${id}] flavor references unknown generator '${fg.id}'`)
  }

  // Prerequisite expression validation
  validateUpgradePrerequisites(def.upgrades)
  validateUpgradeChoiceGroups(def.upgrades)

  // highlightEnabled ↔ initialMeta consistency
  if (def.highlightEnabled && !('highlight' in def.initialMeta))
    throw new Error(`[${id}] highlightEnabled is true but initialMeta has no 'highlight' key`)
}

// ─── Registry ────────────────────────────────────────────────────────

const MODE_REGISTRY: Record<GameMode, ModeDefinition> = {
  idler: idlerMode,
}

// Validate all modes at registration time — app won't start if a flavor is incomplete.
for (const [id, def] of Object.entries(MODE_REGISTRY)) {
  validateModeDefinition(id, def)
}

/** Look up the mode definition for a GameMode. */
export function getModeDefinition(mode: GameMode): ModeDefinition {
  return MODE_REGISTRY[mode]
}

/** All available game mode keys. Derived from the registry — no hard-coding needed. */
export const AVAILABLE_MODES: readonly GameMode[] = Object.keys(MODE_REGISTRY) as GameMode[]

/** Get the default goal for a mode (first in the goals array). */
export function getDefaultGoal(mode: GameMode): Goal {
  return MODE_REGISTRY[mode].goals[0]
}

/** Upgrades visible/valid under the given goal — filters out goal-tagged upgrades whose tag doesn't match. */
export function getAvailableUpgrades(
  mode: ModeDefinition,
  goal: Goal | null,
): readonly UpgradeDefinition[] {
  return mode.upgrades.filter((u) => !u.goalType || u.goalType === goal?.type)
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

// ─── Purchase Helpers ─────────────────────────────────────────────────

/** Whether an upgrade can be purchased infinitely. */
export function isUnlimited(upgrade: UpgradeDefinition): boolean {
  return upgrade.purchaseLimit === Infinity
}

/** Whether an upgrade has reached its purchase limit. */
export function isMaxed(upgrade: UpgradeDefinition, ownedCount: number): boolean {
  return ownedCount >= upgrade.purchaseLimit
}

// ─── Highlight ────────────────────────────────────────────────────────

/** Whether the highlight mechanic is currently active for this player. */
export function isHighlightActive(state: Readonly<PlayerState>, mode: ModeDefinition): boolean {
  if (!mode.highlightEnabled) return false
  if (!mode.highlightUnlockUpgrade) return true
  return (state.upgrades[mode.highlightUnlockUpgrade] ?? 0) > 0
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
  const generatorIds = new Set(mode.generators.map((g) => g.id))
  const generatorModifiers = new Map<string, { additive: number; multiplicative: number }>()
  for (const gen of mode.generators) {
    generatorModifiers.set(gen.id, { additive: 0, multiplicative: 1 })
  }

  for (const upgrade of mode.upgrades) {
    const owned = state.upgrades[upgrade.id] ?? 0
    if (owned <= 0) continue

    for (const mod of upgrade.modifiers) {
      if (generatorIds.has(mod.field)) {
        // Generator-targeted modifier: accumulate for later application.
        // Additive value is per-generator-unit (multiplied by owned count below).
        const genState = generatorModifiers.get(mod.field)!
        if (mod.stage === 'additive') {
          genState.additive += mod.value * owned
        } else if (mod.stage === 'multiplicative') {
          genState.multiplicative *= mod.value ** owned
        }
      } else {
        modifiers.push({ stage: mod.stage, field: mod.field, value: mod.value * owned })
      }
    }
  }

  // Dynamic (state-derived) modifiers — mode-specific hook
  if (mode.collectDynamic) {
    for (const mod of mode.collectDynamic(state)) {
      if (generatorIds.has(mod.field)) {
        const genState = generatorModifiers.get(mod.field)!
        if (mod.stage === 'additive') genState.additive += mod.value
        else if (mod.stage === 'multiplicative') genState.multiplicative *= mod.value
      } else {
        modifiers.push(mod)
      }
    }
  }

  // Upgrade-level dynamic modifiers — per-upgrade state-derived bonuses
  for (const upgrade of mode.upgrades) {
    if (!upgrade.dynamicModifier || (state.upgrades[upgrade.id] ?? 0) <= 0) continue
    const mod = upgrade.dynamicModifier(state)
    if (!mod) continue
    if (generatorIds.has(mod.field)) {
      const genState = generatorModifiers.get(mod.field)!
      if (mod.stage === 'additive') genState.additive += mod.value
      else if (mod.stage === 'multiplicative') genState.multiplicative *= mod.value
    } else {
      modifiers.push(mod)
    }
  }

  // Generator modifiers — apply accumulated generator-targeted bonuses.
  // additive: extra rate per generator unit (total bonus = additive × owned).
  // multiplicative: factor applied to the generator's total output.
  for (const gen of mode.generators) {
    const owned = state.generators[gen.id] ?? 0
    if (owned <= 0) continue

    const genState = generatorModifiers.get(gen.id)!
    const baseRate = gen.production.rate * owned
    const additiveBonus = genState.additive * owned
    const effectiveRate = (baseRate + additiveBonus) * genState.multiplicative

    modifiers.push({
      stage: 'additive',
      field: gen.production.resource,
      value: effectiveRate,
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

  const owned = state.upgrades[upgradeId] ?? 0
  if (isMaxed(def, owned)) return

  // Deduct each currency in the cost map
  const cost = getUpgradeNextCost(def, owned)
  for (const [currency, amount] of Object.entries(cost)) {
    state.resources[currency] = (state.resources[currency] ?? 0) - amount
  }

  // Grant upgrade
  state.upgrades[upgradeId] = owned + 1

  // Record purchase time on first buy
  if (owned === 0) {
    const purchasedAt = (state.meta.purchasedAt as Record<string, number> | undefined) ?? {}
    purchasedAt[upgradeId] = (state.meta.gameSec as number | undefined) ?? 0
    state.meta.purchasedAt = purchasedAt
  }
}

/**
 * Normalize upgrade counts in a loaded `PlayerState` to respect `purchaseLimit`.
 * Useful for migration when loading older save files.
 */
export function normalizeUpgrades(state: PlayerState, mode: ModeDefinition): void {
  for (const u of mode.upgrades) {
    if (isUnlimited(u)) continue
    const cur = state.upgrades[u.id] ?? 0
    if (cur > u.purchaseLimit) state.upgrades[u.id] = u.purchaseLimit
  }
}
