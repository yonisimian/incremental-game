import type { Modifier } from '../modifiers/types.js'
import { computePassiveRates } from '../modifiers/pipeline.js'
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
import {
  applyEffect,
  effectHosts,
  isEffectAllowedOn,
  normalizeEffectOutputs,
  prepareEffect,
} from '../effects/index.js'
import {
  addressableSources,
  addressableTargets,
  enemyDebuffTargets,
  NON_RESOURCE_INTEL_KEYS,
  enemyDataResourceKey,
} from '../effects/index.js'
import type { BaseModifierOutput, EffectHost, EffectOutput } from '../effects/index.js'
import {
  allAttackIds,
  allPactIds,
  anyOwned,
  attackGateUpgrades,
  pactGateUpgrades,
  panelGateUpgrades,
  systemGateUpgrades,
} from '../unlock-gates.js'

// ─── Validation ──────────────────────────────────────────────────────

/** How each effect host reads in an authoring error message. */
const HOST_LABELS: Record<EffectHost, string> = {
  mode: 'the mode',
  upgrade: 'an upgrade',
  passiveAttack: 'a passive attack',
  activeAttack: 'an active attack',
}

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

  // Every mechanical pact must have a flavor entry
  for (const p of def.pacts) {
    if (!f.pacts.some((fp) => fp.id === p.id))
      throw new Error(`[${id}] ${where}: missing flavor for pact '${p.id}'`)
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
  for (const fp of f.pacts) {
    if (!def.pacts.some((p) => p.id === fp.id))
      throw new Error(`[${id}] ${where}: references unknown pact '${fp.id}'`)
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

  // Generators are single-currency: their cost map must have exactly one entry.
  // (Upgrades may be multi-currency; generators are not, since their purchase,
  // affordability, and UI all assume one paying resource.)
  for (const g of def.generators) {
    // A generator id shaped like a base-producer field (`bK`) would collide in
    // the addressable-target catalog and be shadowed by the base-layer route in
    // the pipeline (`resolveField`). Reject it so a modifier can never ambiguously
    // target "generator b0" vs "base producer of resource 0".
    if (/^b\d+$/u.test(g.id))
      throw new Error(
        `[${id}] generator id '${g.id}' collides with the base-producer field namespace (bK); rename it`,
      )
    const currencies = Object.keys(g.cost)
    if (currencies.length !== 1)
      throw new Error(
        `[${id}] generator '${g.id}' must cost exactly one currency (has ${currencies.length})`,
      )
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

  // `unlockPact` effects name a pact by id; validate against the mode's pacts
  // so an authored typo fails loudly instead of unlocking nothing.
  const pactIds = new Set(def.pacts.map((p) => p.id))
  for (const u of def.upgrades) {
    for (const ref of u.effects ?? []) {
      if (ref.type !== 'unlockPact') continue
      const target = ref.pact
      if (typeof target === 'string' && !pactIds.has(target))
        throw new Error(
          `[${id}] upgrade '${u.id}' unlockPact effect references unknown pact '${target}'`,
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

  // `nativeModifiers` and `baseModifier` effects name a production `field` the
  // generic schema only checks is a string. Validate it against the same target
  // catalog as `relativeModifier` (which now includes each resource's base
  // producer `bK` alongside its global `rK`, generator ids, and the two
  // specials) so an authored typo — or a base/global mix-up like `b9` — refuses
  // to boot instead of landing on a dead field the pipeline silently ignores.
  const checkProductionField = (where: string, field: unknown): void => {
    if (typeof field === 'string' && !targetKeys.has(field))
      throw new Error(
        `[${id}] ${where} targets unknown production field '${field}' (expected a resource rate 'rK', base producer 'bK', generator id, or 'clickIncome')`,
      )
  }
  for (const m of def.nativeModifiers) checkProductionField('native modifier', m.field)
  const checkBaseModifier = (where: string, ref: EffectRef): void => {
    if (ref.type === 'baseModifier') checkProductionField(`${where} baseModifier`, ref.field)
  }
  for (const ref of def.effects ?? []) checkBaseModifier('mode-level', ref)
  for (const u of def.upgrades) {
    for (const ref of u.effects ?? []) checkBaseModifier(`upgrade '${u.id}'`, ref)
  }
  for (const a of def.attacks) {
    for (const ref of a.effects ?? []) checkBaseModifier(`attack '${a.id}'`, ref)
  }

  // Effect placement. Each host is read by different code and keeps different
  // output kinds, so a ref on the wrong one doesn't misbehave — it silently does
  // nothing. Every effect declares where it may live (defaulting to the
  // production-pipeline hosts), so this is one generic check rather than a
  // special case per offensive effect.
  const checkHost = (where: string, host: EffectHost, refs: readonly EffectRef[]): void => {
    for (const ref of refs) {
      if (isEffectAllowedOn(ref.type, host)) continue
      throw new Error(
        `[${id}] ${where} carries a '${ref.type}' effect, which only applies on ${effectHosts(
          ref.type,
        )
          .map((h) => HOST_LABELS[h])
          .join(' / ')} — here it would silently do nothing`,
      )
    }
  }
  checkHost('the mode', 'mode', def.effects ?? [])
  for (const u of def.upgrades) checkHost(`upgrade '${u.id}'`, 'upgrade', u.effects ?? [])
  for (const attack of def.attacks) {
    checkHost(
      `${attack.kind} attack '${attack.id}'`,
      attack.kind === 'passive' ? 'passiveAttack' : 'activeAttack',
      attack.effects ?? [],
    )
  }

  // `enemyProductionModifier` effects (carried by passive attacks) name a
  // `field` — the opponent-pipeline target. It's a mode-specific string the
  // generic schema only checks is present, so validate it against the
  // *enemy-debuff* target catalog — a subset of `relativeModifier`'s (resource
  // rates only). Generator-id and `clickIncome` targets are rejected here because
  // the debuff merges into the opponent's pipeline after generator output is
  // folded and only on the passive path, so they'd silently do nothing (see
  // `enemyDebuffTargetsFor`).
  const debuffTargetKeys = new Set(enemyDebuffTargets(def).map((f) => f.key))
  for (const attack of def.attacks) {
    for (const ref of attack.effects ?? []) {
      if (ref.type !== 'enemyProductionModifier') continue
      if (typeof ref.field === 'string' && !debuffTargetKeys.has(ref.field))
        throw new Error(
          `[${id}] attack '${attack.id}' enemyProductionModifier effect references unknown or unsupported field '${ref.field}' (only resource rates can be debuffed)`,
        )
    }
  }

  // Active-attack cost/timing + `stealResource` integrity. An active attack that
  // carries effects is *activated* (pay `prepareCost`, wait `prepareTimeSec`,
  // strike), so both fields must be present and well-formed; a passive attack is
  // always-on and never activated, so declaring either is an authoring mistake.
  // Effect-less active attacks stay legal — they're placeholders.
  for (const attack of def.attacks) {
    const hasEffects = (attack.effects?.length ?? 0) > 0
    const hasCost = attack.prepareCost !== undefined && Object.keys(attack.prepareCost).length > 0

    if (attack.kind === 'passive') {
      if (attack.prepareCost !== undefined || attack.prepareTimeSec !== undefined)
        throw new Error(
          `[${id}] passive attack '${attack.id}' declares prepareCost/prepareTimeSec, but passive attacks are always-on and never activated`,
        )
    } else {
      // active
      if (hasEffects) {
        if (!hasCost)
          throw new Error(
            `[${id}] active attack '${attack.id}' carries effects but has no prepareCost`,
          )
        if (attack.prepareTimeSec === undefined)
          throw new Error(
            `[${id}] active attack '${attack.id}' carries effects but has no prepareTimeSec`,
          )
      }
      if (attack.prepareTimeSec !== undefined && attack.prepareTimeSec < 0)
        throw new Error(`[${id}] active attack '${attack.id}' has a negative prepareTimeSec`)
      for (const currency of Object.keys(attack.prepareCost ?? {})) {
        if (!resourceKeys.has(currency))
          throw new Error(
            `[${id}] active attack '${attack.id}' prepareCost references unknown resource '${currency}'`,
          )
      }
    }

    // `stealResource` may only ride an active attack, and must name a real
    // resource. Checked for every attack so a misplaced steal on a passive attack
    // fails loudly rather than silently never resolving.
    for (const ref of attack.effects ?? []) {
      if (ref.type !== 'stealResource') continue
      if (attack.kind !== 'active')
        throw new Error(
          `[${id}] attack '${attack.id}' carries a stealResource effect but is not active (steals resolve on a strike, which only active attacks have)`,
        )
      if (typeof ref.resource === 'string' && !resourceKeys.has(ref.resource))
        throw new Error(
          `[${id}] attack '${attack.id}' stealResource effect references unknown resource '${ref.resource}'`,
        )
      // The take is authored as *either* a share (`fraction`) or a flat quantity
      // (`amount`). The effect's schema already rejects both-or-neither, but as a
      // union it can only report "Invalid input" — so name the mistake here,
      // ahead of the `prepareEffect` pass below that raises the zod error.
      const hasFraction = ref.fraction !== undefined
      const hasAmount = ref.amount !== undefined
      if (hasFraction && hasAmount)
        throw new Error(
          `[${id}] attack '${attack.id}' stealResource effect sets both 'fraction' and 'amount' — use exactly one (a share of the victim's stockpile, or a flat quantity)`,
        )
      if (!hasFraction && !hasAmount)
        throw new Error(
          `[${id}] attack '${attack.id}' stealResource effect sets neither 'fraction' nor 'amount' — use exactly one (a share of the victim's stockpile, or a flat quantity)`,
        )
    }
  }

  // Effect refs: resolve + parse once up front, so unknown types or malformed
  // params fail at startup rather than mid-tick. Also warms the per-ref cache.
  for (const ref of def.effects ?? []) prepareEffect(ref)
  for (const u of def.upgrades) {
    for (const ref of u.effects ?? []) prepareEffect(ref)
  }
  for (const attack of def.attacks) {
    for (const ref of attack.effects ?? []) prepareEffect(ref)
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
 * Look up a mode definition, or `undefined` if it has not been loaded. Unlike
 * {@link getModeDefinition} this never throws — for callers that must degrade
 * gracefully when a mode's tree isn't loaded (e.g. the balance registry).
 */
export function getModeDefinitionOrUndefined(mode: GameMode): ModeDefinition | undefined {
  return MODE_REGISTRY.get(mode)
}

/** All currently-loaded mode definitions (registration order). */
export function getLoadedModeDefinitions(): ModeDefinition[] {
  return [...MODE_REGISTRY.values()]
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
    pendingAttacks: [],
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

/**
 * The multiplicative bonus currently applied to the highlighted resource by
 * `highlightMultiplier` effects — mode-level effects (always on) and owned
 * upgrades (compounding `multiplier ^ owned`, matching `collectModifiers`).
 * Returns `1` when nothing boosts the highlight. Independent of *which* resource
 * is highlighted (the factor only moves between resources).
 */
export function getHighlightMultiplier(state: Readonly<PlayerState>, mode: ModeDefinition): number {
  let mult = 1

  const accumulate = (refs: readonly EffectRef[] | undefined, owned: number): void => {
    for (const ref of refs ?? []) {
      if (ref.type !== 'highlightMultiplier') continue
      for (const out of normalizeEffectOutputs(applyEffect(ref, state, mode))) {
        if ('kind' in out && out.kind === 'baseModifier' && out.stage === 'multiplicative') {
          mult *= out.value ** owned
        }
      }
    }
  }

  accumulate(mode.effects, 1)
  for (const upgrade of mode.upgrades) {
    const owned = state.upgrades[upgrade.id] ?? 0
    if (owned > 0) accumulate(upgrade.effects, owned)
  }
  return mult
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
 * Whether a pact is available to this player. Granted by any owned upgrade
 * carrying an `unlockPact` effect naming it. Unlike `isPanelUnlocked`, a pact no
 * upgrade unlocks is *hidden* by default (pacts only appear once unlocked). The
 * pact itself has no behavior yet — this gates its appearance in the
 * international relationship panel.
 */
export function isPactUnlocked(
  state: Readonly<PlayerState>,
  mode: ModeDefinition,
  pactId: string,
): boolean {
  return anyOwned(state, pactGateUpgrades(mode, pactId))
}

/** The pact ids this player has unlocked, in mode declaration order. */
export function unlockedPacts(state: Readonly<PlayerState>, mode: ModeDefinition): string[] {
  return allPactIds(mode).filter((id) => isPactUnlocked(state, mode, id))
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
      else genState.multiplicative *= mod.value
    } else {
      modifiers.push(mod)
    }
  }

  // Route a `baseModifier` output with the owning upgrade's owned-count
  // compounding: additive scales linearly (× owned), multiplicative compounds
  // (^ owned). Generator-targeted bonuses feed the per-generator
  // accumulator (additive per-unit × owned, applied again per generator below);
  // everything else is pushed to the pipeline. Reproduces the legacy per-upgrade
  // `modifiers` array exactly.
  const routeBaseModifier = (o: BaseModifierOutput, owned: number): void => {
    if (generatorIds.has(o.field)) {
      const genState = generatorModifiers.get(o.field)!
      if (o.stage === 'additive') genState.additive += o.value * owned
      else genState.multiplicative *= o.value ** owned
    } else {
      const value = o.stage === 'additive' ? o.value * owned : o.value ** owned
      modifiers.push({ stage: o.stage, field: o.field, value })
    }
  }

  // Route an effect's outputs. Production `Modifier`s feed the pipeline verbatim;
  // `baseModifier`s feed it with owned-count compounding — per-upgrade effects
  // pass the owning upgrade's owned count, while mode-level effects (no count)
  // apply once (`owned ?? 1`). Cost-track outputs (`GeneratorCostOutput`) and
  // the unlock outputs belong to other subsystems and are ignored here.
  const routeEffect = (
    out: EffectOutput | readonly EffectOutput[] | null,
    owned?: number,
  ): void => {
    for (const o of normalizeEffectOutputs(out)) {
      if ('kind' in o && o.kind === 'baseModifier') {
        routeBaseModifier(o, owned ?? 1)
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

/**
 * Attribution of one resource's passive rate to the systems that produce it.
 * `base + generators` always equals `total` (the same number the header shows),
 * and `byGenerator` sums to `generators`. See {@link computeRateBreakdown}.
 */
export interface ResourceRateBreakdown {
  /** Authoritative per-second rate (matches `computePassiveRates`). */
  total: number
  /**
   * The base producer: native modifiers + mode-level effects, *including* every
   * upgrade boost applied to them. Upgrades are not a bucket of their own — a
   * base-boosting upgrade shows up here, a generator-boosting one in
   * `generators`.
   */
  base: number
  /** Contribution of all generators producing this resource. */
  generators: number
  /** Per-generator contribution (owned generators producing this resource). */
  byGenerator: Record<string, number>
}

/** Shallow player-state clone with every generator un-owned. */
function playerWithoutGenerators(state: Readonly<PlayerState>): PlayerState {
  return {
    score: state.score,
    resources: { ...state.resources },
    upgrades: { ...state.upgrades },
    generators: {},
    pendingAttacks: [...state.pendingAttacks],
    meta: structuredClone(state.meta),
  }
}

/**
 * Decompose each resource's passive rate into base / generator contributions,
 * for display (e.g. the data panel).
 *
 * The generator bucket is measured by *differencing* the full pipeline against
 * the pipeline with no generators owned, so shared multiplicative stages
 * (highlight, global multipliers, debuffs) cancel and the two buckets telescope
 * back to the authoritative total — regardless of how the modifiers compose.
 * Optional `debuffs` (from `collectEnemyDebuffs`) are merged in so the total
 * matches the income the server actually applies.
 *
 * `byGenerator` splits the generator bucket across owned generators in
 * proportion to their raw output (`rate × owned`); generators are mutually
 * additive, so this preserves the exact bucket sum.
 *
 * Upgrades are deliberately *not* a bucket: they have no standalone output, they
 * scale whichever producer they target. An upgrade boosting generator output is
 * folded into `generators`, one boosting the base producer into `base`.
 */
export function computeRateBreakdown(
  state: Readonly<PlayerState>,
  mode: ModeDefinition,
  debuffs: readonly Modifier[] = [],
): Record<string, ResourceRateBreakdown> {
  const { resources } = mode
  const rateFor = (player: Readonly<PlayerState>): Record<string, number> =>
    computePassiveRates([...collectModifiers(player, mode), ...debuffs], resources)

  const total = rateFor(state)
  const noGen = rateFor(playerWithoutGenerators(state))

  // Raw generator output per resource, for proportionally splitting the
  // generator bucket across the individual generators that feed it.
  const genRawByResource = new Map<string, { total: number; byId: Record<string, number> }>()
  for (const gen of mode.generators) {
    const owned = state.generators[gen.id] ?? 0
    if (owned <= 0) continue
    const raw = gen.production.rate * owned
    if (raw <= 0) continue
    const entry = genRawByResource.get(gen.production.resource) ?? { total: 0, byId: {} }
    entry.total += raw
    entry.byId[gen.id] = (entry.byId[gen.id] ?? 0) + raw
    genRawByResource.set(gen.production.resource, entry)
  }

  const result: Record<string, ResourceRateBreakdown> = {}
  for (const r of resources) {
    const t = total[r] ?? 0
    const base = noGen[r] ?? 0
    const generators = t - base

    const byGenerator: Record<string, number> = {}
    const raw = genRawByResource.get(r)
    if (raw && raw.total > 0) {
      for (const [id, rawRate] of Object.entries(raw.byId)) {
        byGenerator[id] = generators * (rawRate / raw.total)
      }
    }

    result[r] = { total: t, base, generators, byGenerator }
  }
  return result
}

/**
 * Collect the *offensive* modifiers a player's unlocked passive attacks inflict
 * on the **opponent**. These are gathered from `attacker` but applied to the
 * other player's pipeline (merge them with the defender's own `collectModifiers`
 * output before running `computePassiveRates` / `applyPassiveTick`).
 *
 * Only `passive` attacks contribute — an active attack's effects await a trigger
 * mechanism. Each attack's `enemyModifier`-emitting effects (e.g.
 * `enemyProductionModifier`) become raw {@link Modifier}s, applied verbatim
 * (no owned-count compounding — an attack is unlocked or it isn't). The
 * attacker's state is passed to `applyEffect` so future state-relative debuffs
 * can read it; today's effects are state-independent.
 */
export function collectEnemyDebuffs(
  attacker: Readonly<PlayerState>,
  mode: ModeDefinition,
): Modifier[] {
  const debuffs: Modifier[] = []
  const attackById = new Map(mode.attacks.map((a) => [a.id, a]))
  for (const attackId of unlockedAttacks(attacker, mode)) {
    const attack = attackById.get(attackId)
    if (attack?.kind !== 'passive') continue
    for (const ref of attack.effects ?? []) {
      for (const out of normalizeEffectOutputs(applyEffect(ref, attacker, mode))) {
        if ('kind' in out && out.kind === 'enemyModifier') debuffs.push(out.modifier)
      }
    }
  }
  return debuffs
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
