import type { Modifier } from '../modifiers/types.js'
import type { EffectRef, GameMode, Goal, PlayerState, UpgradeDefinition } from '../types.js'
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
import {
  addressableSources,
  addressableTargets,
  NON_RESOURCE_INTEL_KEYS,
  enemyDataResourceKey,
} from '../effects/index.js'
import type { BaseModifierOutput, EffectOutput } from '../effects/index.js'
import {
  allAttackIds,
  anyOwned,
  attackGateUpgrades,
  panelGateUpgrades,
  systemGateUpgrades,
} from '../unlock-gates.js'

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

  // Every mechanical attack must have a flavor entry
  for (const a of def.attacks) {
    if (!f.attacks.some((fa) => fa.id === a.id))
      throw new Error(`[${id}] ${where}: missing flavor for attack '${a.id}'`)
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
  for (const fa of f.attacks) {
    if (!def.attacks.some((a) => a.id === fa.id))
      throw new Error(`[${id}] ${where}: references unknown attack '${fa.id}'`)
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

  // Referential integrity for generator-targeting effects: `generatorCost` and
  // `generatorUnlock` both name a generator by id (the generic effect schema
  // only checks it's a string), so a typo would otherwise be silently ignored
  // at runtime. These are the effects that point at another mechanic, so the
  // check is targeted by type.
  const generatorIds = new Set(def.generators.map((g) => g.id))
  for (const u of def.upgrades) {
    for (const ref of u.effects ?? []) {
      if (ref.type !== 'generatorCost' && ref.type !== 'generatorUnlock') continue
      const target = ref.generator
      if (typeof target === 'string' && !generatorIds.has(target))
        throw new Error(
          `[${id}] upgrade '${u.id}' ${ref.type} effect references unknown generator '${target}'`,
        )
    }
  }

  // `unlockAttack` effects name an attack by id; validate against the mode's
  // attacks so an authored typo fails loudly instead of unlocking nothing.
  const attackIds = new Set(def.attacks.map((a) => a.id))
  for (const u of def.upgrades) {
    for (const ref of u.effects ?? []) {
      if (ref.type !== 'unlockAttack') continue
      const target = ref.attack
      if (typeof target === 'string' && !attackIds.has(target))
        throw new Error(
          `[${id}] upgrade '${u.id}' unlockAttack effect references unknown attack '${target}'`,
        )
    }
  }

  // `accessEnemyData` effects name a resource (optionally `:rate`-suffixed) by
  // key; validate it the same way so an authored typo fails loudly instead of
  // silently revealing nothing at runtime.
  const resourceKeys = new Set(def.resources)
  // Reserved non-resource intel keys (e.g. peak CPS) must not collide with a
  // real resource, or their whitelist below would mask a genuine typo.
  for (const intelKey of NON_RESOURCE_INTEL_KEYS) {
    if (resourceKeys.has(intelKey))
      throw new Error(
        `[${id}] resource key '${intelKey}' collides with a reserved non-resource intel key`,
      )
  }
  const nonResourceIntel = new Set(NON_RESOURCE_INTEL_KEYS)
  for (const u of def.upgrades) {
    for (const ref of u.effects ?? []) {
      if (ref.type !== 'accessEnemyData') continue
      const target = ref.data
      if (typeof target === 'string' && nonResourceIntel.has(target)) continue // non-resource intel
      if (typeof target === 'string' && !resourceKeys.has(enemyDataResourceKey(target)))
        throw new Error(
          `[${id}] upgrade '${u.id}' accessEnemyData effect references unknown resource '${target}'`,
        )
    }
  }

  // `relativeModifier` effects name a `source` (a state field to read) and a
  // `field` (the modifier target). Both are mode-specific, so the generic schema
  // only checks they're strings; validate them against the addressable-field
  // catalog so an authored typo refuses to boot instead of silently reading or
  // writing nothing at runtime. Covers mode-level and upgrade-level refs.
  const sourceKeys = new Set(addressableSources(def).map((f) => f.key))
  const targetKeys = new Set(addressableTargets(def).map((f) => f.key))
  const checkRelativeModifier = (where: string, ref: EffectRef): void => {
    if (ref.type !== 'relativeModifier') return
    if (typeof ref.source === 'string' && !sourceKeys.has(ref.source))
      throw new Error(
        `[${id}] ${where} relativeModifier effect references unknown source '${ref.source}'`,
      )
    if (typeof ref.field === 'string' && !targetKeys.has(ref.field))
      throw new Error(
        `[${id}] ${where} relativeModifier effect references unknown field '${ref.field}'`,
      )
  }
  for (const ref of def.effects ?? []) checkRelativeModifier('mode-level', ref)
  for (const u of def.upgrades) {
    for (const ref of u.effects ?? []) checkRelativeModifier(`upgrade '${u.id}'`, ref)
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

/**
 * Whether an input system is unlocked: gated by any upgrade carrying a
 * `systemUnlock` effect naming it (locked until one is owned). A system that no
 * upgrade gates is always unlocked. Callers check the relevant `*Enabled` flag
 * first.
 */
function isSystemUnlocked(
  state: Readonly<PlayerState>,
  mode: ModeDefinition,
  system: string,
): boolean {
  const gates = systemGateUpgrades(mode, system)
  if (!gates) return true // no upgrade gates this system → always available
  return anyOwned(state, gates)
}

/** Whether the highlight mechanic is currently active for this player. */
export function isHighlightActive(state: Readonly<PlayerState>, mode: ModeDefinition): boolean {
  if (!mode.highlightEnabled) return false
  return isSystemUnlocked(state, mode, 'highlight')
}

/** Whether the click mechanic is currently active for this player. */
export function isClickUnlocked(state: Readonly<PlayerState>, mode: ModeDefinition): boolean {
  if (!mode.clicksEnabled) return false
  return isSystemUnlocked(state, mode, 'click')
}

/**
 * Whether a UI panel is currently accessible for this player. A panel is gated
 * by any upgrade carrying a `panelUnlock` effect naming it: locked until one
 * such upgrade is owned. Panels that no upgrade unlocks are always available.
 * (See `unlock-gates` for the reverse index this and the other unlock gates
 * share — `isPanelUnlocked` runs every frame via the tab-lock refresh, so the
 * check is an O(gates-for-this-panel) ownership lookup, not a full tree scan.)
 */
export function isPanelUnlocked(
  state: Readonly<PlayerState>,
  mode: ModeDefinition,
  panelId: string,
): boolean {
  const gates = panelGateUpgrades(mode, panelId)
  if (!gates) return true // no upgrade gates this panel → always available
  return anyOwned(state, gates)
}

/**
 * Whether an attack is available to this player. Granted by any owned upgrade
 * carrying an `unlockAttack` effect naming it. Unlike `isPanelUnlocked`, an
 * attack no upgrade unlocks is *hidden* by default (attacks only appear once
 * unlocked). The attack itself has no behavior yet — this gates its appearance
 * in the attack panel.
 */
export function isAttackUnlocked(
  state: Readonly<PlayerState>,
  mode: ModeDefinition,
  attackId: string,
): boolean {
  return anyOwned(state, attackGateUpgrades(mode, attackId))
}

/** The attack ids this player has unlocked, in mode declaration order. */
export function unlockedAttacks(state: Readonly<PlayerState>, mode: ModeDefinition): string[] {
  return allAttackIds(mode).filter((id) => isAttackUnlocked(state, mode, id))
}

/**
 * Per-mode reverse index: enemy-data key → ids of the upgrades whose
 * `accessEnemyData` effect grants it. Mirrors {@link getPanelGateIndex}: derived
 * topology, cached in a `WeakMap` keyed by the mode, so `hasEnemyDataAccess`
 * stays an O(grants-for-this-key) ownership check on the espionage refresh path.
 */
const enemyDataGateIndex = new WeakMap<ModeDefinition, ReadonlyMap<string, readonly string[]>>()

/**
 * Build (or return the cached) enemy-data gate index for a mode.
 * `accessEnemyData` is state-independent — it echoes its authored key — so a
 * throwaway initial state is enough to read which key each effect names.
 */
function getEnemyDataGateIndex(mode: ModeDefinition): ReadonlyMap<string, readonly string[]> {
  const cached = enemyDataGateIndex.get(mode)
  if (cached) return cached

  const index = new Map<string, string[]>()
  const probe = createInitialState(mode)
  for (const upgrade of mode.upgrades) {
    for (const ref of upgrade.effects ?? []) {
      if (ref.type !== 'accessEnemyData') continue
      for (const out of normalizeEffectOutputs(applyEffect(ref, probe, mode))) {
        if (!('kind' in out) || out.kind !== 'enemyDataAccess') continue
        const grants = index.get(out.data)
        if (grants) {
          if (!grants.includes(upgrade.id)) grants.push(upgrade.id)
        } else {
          index.set(out.data, [upgrade.id])
        }
      }
    }
  }

  enemyDataGateIndex.set(mode, index)
  return index
}

/**
 * Whether the viewing player may see a slice of opponent intel (e.g.
 * `'resources'`) in the espionage panel. Granted by any owned upgrade carrying
 * an `accessEnemyData` effect naming that key. Unlike `isPanelUnlocked`, an
 * ungranted key is *hidden* by default (a key no upgrade grants is never
 * visible). `state` is the *viewer's* own state — the spy unlocks visibility
 * into the opponent.
 */
export function hasEnemyDataAccess(
  state: Readonly<PlayerState>,
  mode: ModeDefinition,
  dataKey: string,
): boolean {
  const grants = getEnemyDataGateIndex(mode).get(dataKey)
  if (!grants) return false // no upgrade grants this key → never visible
  return grants.some((id) => (state.upgrades[id] ?? 0) > 0)
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

  // Route a `baseModifier` output with the owning upgrade's owned-count
  // compounding: additive scales linearly (× owned), multiplicative/global
  // compound (^ owned). Generator-targeted bonuses feed the per-generator
  // accumulator (additive per-unit × owned, applied again per generator below);
  // everything else is pushed to the pipeline. Reproduces the legacy per-upgrade
  // `modifiers` array exactly.
  const routeBaseModifier = (o: BaseModifierOutput, owned: number): void => {
    if (generatorIds.has(o.field)) {
      const genState = generatorModifiers.get(o.field)!
      if (o.stage === 'additive') genState.additive += o.value * owned
      else if (o.stage === 'multiplicative') genState.multiplicative *= o.value ** owned
    } else {
      const value = o.stage === 'additive' ? o.value * owned : o.value ** owned
      modifiers.push({ stage: o.stage, field: o.field, value })
    }
  }

  // Route an effect's outputs. Production `Modifier`s feed the pipeline verbatim;
  // `baseModifier`s feed it with owned-count compounding (only when an owning
  // upgrade count is supplied). Cost-track outputs (`GeneratorCostOutput`) and
  // the unlock outputs belong to other subsystems and are ignored here.
  const routeEffect = (
    out: EffectOutput | readonly EffectOutput[] | null,
    owned?: number,
  ): void => {
    for (const o of normalizeEffectOutputs(out)) {
      if ('kind' in o && o.kind === 'baseModifier') {
        if (owned !== undefined) routeBaseModifier(o, owned)
      } else if ('stage' in o) {
        routeModifier(o)
      }
    }
  }

  // Mode-level effects — state-derived modifiers applied to every player.
  for (const ref of mode.effects ?? []) {
    routeEffect(applyEffect(ref, state, mode))
  }

  // Upgrade-level effects — per-upgrade bonuses (owned upgrades only). `owned`
  // drives `baseModifier` compounding; state-derived effects ignore it.
  for (const upgrade of mode.upgrades) {
    const owned = state.upgrades[upgrade.id] ?? 0
    if (owned <= 0) continue
    for (const ref of upgrade.effects ?? []) {
      routeEffect(applyEffect(ref, state, mode), owned)
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
