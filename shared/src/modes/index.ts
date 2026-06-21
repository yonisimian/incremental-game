import type { Modifier } from '../modifiers/types.js'
import type { GameMode, Goal, PlayerState, UpgradeDefinition } from '../types.js'
import type { ModeDefinition, ModeFlavor } from './types.js'
import { validateUpgradePrerequisites } from '../prerequisites.js'
import { validateUpgradeChoiceGroups } from '../upgrade-groups.js'
import { getUpgradeNextCost } from '../upgrade-costs.js'
import {
  MIN_TARGET_SCORE,
  MAX_TARGET_SCORE,
  MIN_ROUND_DURATION_SEC,
  MAX_ROUND_DURATION_SEC,
} from '../game-config.js'
// Importing from the effects barrel ensures seed effects are registered
// whenever `collectModifiers` is reachable (incl. tests that import this module).
import { applyEffect, normalizeEffectOutputs, prepareEffect } from '../effects/index.js'
import type { EffectOutput } from '../effects/index.js'

export { IDLER_TIMED_ENVELOPE } from './idler-envelope.js'

// ─── Validation ──────────────────────────────────────────────────────

/**
 * Validate that a single flavor's display data covers exactly the mode's
 * mechanics (same resource keys, an entry per upgrade/generator, no orphans).
 * Every flavor must satisfy this independently, so players on different flavors
 * see consistent UI for the same shared simulation.
 */
function validateFlavor(id: string, def: ModeDefinition, f: ModeFlavor): void {
  const where = `flavor '${f.id}'`

  // Resource keys must match exactly (same set, same count)
  const mechKeys = new Set(def.resources)
  const flavorKeys = new Set(f.resources.map((r) => r.key))
  if (mechKeys.size !== flavorKeys.size || ![...mechKeys].every((k) => flavorKeys.has(k)))
    throw new Error(`[${id}] ${where}: resources keys don't match mode.resources`)

  // Every mechanical upgrade must have a flavor entry
  for (const u of def.upgrades) {
    if (!f.upgrades.some((fu) => fu.id === u.id))
      throw new Error(`[${id}] ${where}: missing flavor for upgrade '${u.id}'`)
  }

  // Every mechanical generator must have a flavor entry
  for (const g of def.generators) {
    if (!f.generators.some((fg) => fg.id === g.id))
      throw new Error(`[${id}] ${where}: missing flavor for generator '${g.id}'`)
  }

  // No orphan flavor entries (flavor references nonexistent mechanic)
  for (const fu of f.upgrades) {
    if (!def.upgrades.some((u) => u.id === fu.id))
      throw new Error(`[${id}] ${where}: references unknown upgrade '${fu.id}'`)
  }
  for (const fg of f.generators) {
    if (!def.generators.some((g) => g.id === fg.id))
      throw new Error(`[${id}] ${where}: references unknown generator '${fg.id}'`)
  }
}

/** Validate that flavor ↔ mechanics agree. Called once per mode at startup. */
export function validateModeDefinition(id: string, def: ModeDefinition): void {
  // At least one flavor (also enforced by the schema), with unique ids so a
  // selector can address them and `getModeFlavor` resolves deterministically.
  if (def.flavors.length === 0) throw new Error(`[${id}] mode has no flavors`)
  const seen = new Set<string>()
  for (const f of def.flavors) {
    if (seen.has(f.id)) throw new Error(`[${id}] duplicate flavor id '${f.id}'`)
    seen.add(f.id)
    validateFlavor(id, def, f)
  }

  // Prerequisite expression validation
  validateUpgradePrerequisites(def.upgrades)
  validateUpgradeChoiceGroups(def.upgrades)

  // highlightEnabled ↔ initialMeta consistency
  if (def.highlightEnabled && !('highlight' in def.initialMeta))
    throw new Error(`[${id}] highlightEnabled is true but initialMeta has no 'highlight' key`)

  // Referential integrity for generator gating + cost reductions: a typo in an
  // authored id would otherwise be silently ignored at runtime.
  const upgradeIds = new Set(def.upgrades.map((u) => u.id))
  const generatorIds = new Set(def.generators.map((g) => g.id))
  for (const gen of def.generators) {
    if (gen.unlockUpgrade !== undefined && !upgradeIds.has(gen.unlockUpgrade))
      throw new Error(
        `[${id}] generator '${gen.id}' unlockUpgrade references unknown upgrade '${gen.unlockUpgrade}'`,
      )
  }
  // `generatorCost` effects name a generator by id; validate that ref up front
  // (the generic effect schema only checks it's a string). This is the one
  // effect that points at another mechanic, so the check is targeted by type.
  for (const u of def.upgrades) {
    for (const ref of u.effects ?? []) {
      if (ref.type !== 'generatorCost') continue
      const target = ref.generator
      if (typeof target === 'string' && !generatorIds.has(target))
        throw new Error(
          `[${id}] upgrade '${u.id}' generatorCost effect references unknown generator '${target}'`,
        )
    }
  }

  // Effect refs: resolve + parse once up front, so unknown types or malformed
  // params fail at startup rather than mid-tick. Also warms the per-ref cache.
  for (const ref of def.effects ?? []) prepareEffect(ref)
  for (const u of def.upgrades) {
    for (const ref of u.effects ?? []) prepareEffect(ref)
  }
}

// ─── Registry ────────────────────────────────────────────────────────

/**
 * Loaded mode definitions, keyed by mode id. Empty at import: modes are loaded
 * at runtime from their (server-served) tree files via `loadTree` (see
 * `shared/src/tree/codec.ts`), not baked into the bundle. Call `loadTree` once
 * at startup before any `getModeDefinition` call (server reads the file from
 * disk; the client fetches it from the server — D17/D18).
 */
const MODE_REGISTRY = new Map<GameMode, ModeDefinition>()

/**
 * Register a validated mode definition under its id. Idempotent: re-registering
 * the same id overwrites it. Called by `loadTree` after parsing + validating a
 * tree file; not meant to be called with hand-built definitions.
 */
export function registerMode(id: GameMode, def: ModeDefinition): void {
  MODE_REGISTRY.set(id, def)
}

/**
 * Look up the mode definition for a GameMode. Throws if the mode has not been
 * loaded yet — a missing load is a boot-order bug that should surface loudly.
 */
export function getModeDefinition(mode: GameMode): ModeDefinition {
  const def = MODE_REGISTRY.get(mode)
  if (!def) {
    throw new Error(`Mode '${mode}' is not loaded — call loadTree() at startup before use`)
  }
  return def
}

/**
 * All game mode keys the app knows about. Static (the `GameMode` union), so it is
 * available before any tree is loaded — distinct from whether a mode's data has
 * been loaded into the registry. Used for input validation and the lobby picker.
 */
export const AVAILABLE_MODES: readonly GameMode[] = ['idler']

/** Get the default goal for a mode (first in the goals array). */
export function getDefaultGoal(mode: GameMode): Goal {
  return getModeDefinition(mode).goals[0]
}

/**
 * Apply a creator's custom value (target score / duration) onto a predefined
 * goal, clamping it to safe bounds. Non-customizable fields (label, safety cap)
 * always come from `base`, so the result is authoritative regardless of what
 * the client sent. Returns `base` unchanged for goal types without a tunable.
 */
export function customizeGoal(base: Goal, requested: Goal): Goal {
  if (base.type === 'target-score' && requested.type === 'target-score') {
    return { ...base, target: clampInt(requested.target, MIN_TARGET_SCORE, MAX_TARGET_SCORE) }
  }
  if (base.type === 'timed' && requested.type === 'timed') {
    return {
      ...base,
      durationSec: clampInt(requested.durationSec, MIN_ROUND_DURATION_SEC, MAX_ROUND_DURATION_SEC),
    }
  }
  return base
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, Math.round(value)))
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

/** Whether the click mechanic is currently active for this player. */
export function isClickUnlocked(state: Readonly<PlayerState>, mode: ModeDefinition): boolean {
  if (!mode.clicksEnabled) return false
  if (!mode.clickUnlockUpgrade) return true
  return (state.upgrades[mode.clickUnlockUpgrade] ?? 0) > 0
}

/**
 * Per-mode reverse index: panel id → ids of the upgrades whose `panelUnlock`
 * effect gates it. This is derived topology (not authored data), so it lives in
 * a WeakMap keyed by the mode rather than on `ModeDefinition`, and is dropped
 * automatically when the mode is GC'd.
 *
 * `isPanelUnlocked` runs on every frame via the tab-lock refresh, so it must not
 * scan every upgrade/effect (that grows with the whole tree). The index turns it
 * into an O(gates-for-this-panel) ownership check — effectively O(1), since a
 * panel is normally gated by one upgrade.
 */
const panelGateIndex = new WeakMap<ModeDefinition, ReadonlyMap<string, readonly string[]>>()

/**
 * Build (or return the cached) panel-gate index for a mode. `panelUnlock` is
 * state-independent — it echoes its authored panel id — so a throwaway initial
 * state is enough to read which panel each effect names.
 */
function getPanelGateIndex(mode: ModeDefinition): ReadonlyMap<string, readonly string[]> {
  const cached = panelGateIndex.get(mode)
  if (cached) return cached

  const index = new Map<string, string[]>()
  const probe = createInitialState(mode)
  for (const upgrade of mode.upgrades) {
    for (const ref of upgrade.effects ?? []) {
      if (ref.type !== 'panelUnlock') continue
      for (const out of normalizeEffectOutputs(applyEffect(ref, probe, mode))) {
        if (!('kind' in out) || out.kind !== 'panelUnlock') continue
        const gates = index.get(out.panel)
        if (gates) {
          if (!gates.includes(upgrade.id)) gates.push(upgrade.id)
        } else {
          index.set(out.panel, [upgrade.id])
        }
      }
    }
  }

  panelGateIndex.set(mode, index)
  return index
}

/**
 * Whether a UI panel is currently accessible for this player. A panel is gated
 * by any upgrade carrying a `panelUnlock` effect naming it: locked until one
 * such upgrade is owned. Panels that no upgrade unlocks are always available.
 */
export function isPanelUnlocked(
  state: Readonly<PlayerState>,
  mode: ModeDefinition,
  panelId: string,
): boolean {
  const gates = getPanelGateIndex(mode).get(panelId)
  if (!gates) return true // no upgrade gates this panel → always available
  return gates.some((id) => (state.upgrades[id] ?? 0) > 0)
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
        // Additive bonuses scale linearly with owned count; multiplicative and
        // global factors compound (value ** owned), matching the generator path.
        const value = mod.stage === 'additive' ? mod.value * owned : mod.value ** owned
        modifiers.push({ stage: mod.stage, field: mod.field, value })
      }
    }
  }

  // Route a single state-derived modifier: generator-targeted ones accumulate
  // into the per-generator totals; everything else is pushed directly.
  const routeModifier = (mod: Modifier): void => {
    if (generatorIds.has(mod.field)) {
      const genState = generatorModifiers.get(mod.field)!
      if (mod.stage === 'additive') genState.additive += mod.value
      else if (mod.stage === 'multiplicative') genState.multiplicative *= mod.value
    } else {
      modifiers.push(mod)
    }
  }

  // Route an effect's outputs: production `Modifier`s feed the pipeline;
  // cost-track outputs (`GeneratorCostOutput`) belong to a different subsystem
  // (`collectGeneratorCostFactors`) and are ignored here.
  const routeEffect = (out: EffectOutput | readonly EffectOutput[] | null): void => {
    for (const o of normalizeEffectOutputs(out)) if ('stage' in o) routeModifier(o)
  }

  // Mode-level effects — state-derived modifiers applied to every player.
  for (const ref of mode.effects ?? []) {
    routeEffect(applyEffect(ref, state, mode))
  }

  // Upgrade-level effects — per-upgrade state-derived bonuses (owned upgrades only).
  for (const upgrade of mode.upgrades) {
    if ((state.upgrades[upgrade.id] ?? 0) <= 0) continue
    for (const ref of upgrade.effects ?? []) {
      routeEffect(applyEffect(ref, state, mode))
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
