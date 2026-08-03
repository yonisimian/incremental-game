/**
 * The addressable-field catalog: the set of state scalars an effect may *read*
 * (sources) and the production-pipeline fields it may *feed* (targets), derived
 * from a {@link ModeDefinition}. Both are mode-specific (resource/generator keys
 * vary per mode), so this can't be a static zod enum baked into an effect's
 * schema — it's computed from the mode and consumed in three places:
 *
 *  - `relativeModifier`'s `apply` parses a `source` key through {@link
 *    readSourceValue};
 *  - `validateModeDefinition` rejects any `relativeModifier` whose `source`/
 *    `field` isn't in the catalog, so a typo refuses to boot;
 *  - (later) the `/dev.html` editor renders `source`/`field` as dropdowns whose
 *    labels are each entry's human description.
 *
 * Stage A sources are deliberately narrow: resource *stockpiles* and the live
 * peak-CPS meta value. Generator counts, score, and resource rates are out of
 * scope for now (they can be added here without touching the effect).
 */

import type { PlayerState } from '../types.js'
import type { ModeDefinition } from '../modes/types.js'

/** Namespace prefix for a resource-stockpile source (e.g. `resource:r0`). */
const RESOURCE_SOURCE_PREFIX = 'resource:'
/** The sole meta source in Stage A: the player's live peak CPS. */
const PEAK_CPS_SOURCE = 'meta:peakCps'

/** One addressable field: its stable key plus a human label for the editor. */
export interface AddressableField {
  readonly key: string
  readonly label: string
}

/** The full catalog for a mode: what may be read, and what may be fed. */
export interface AddressableFields {
  readonly sources: readonly AddressableField[]
  readonly targets: readonly AddressableField[]
}

/**
 * Source keys a `relativeModifier` may read, built from raw resource keys
 * (stockpiles) plus peak CPS. The `*For` form takes primitives so the
 * `/dev.html` editor — which holds a `TreeFile`, not a `ModeDefinition` — can
 * share one source of truth for the key format with the runtime and validator.
 */
export function addressableSourcesFor(resourceKeys: readonly string[]): AddressableField[] {
  return [
    ...resourceKeys.map((key) => ({
      key: `${RESOURCE_SOURCE_PREFIX}${key}`,
      label: `${key} (stockpile)`,
    })),
    { key: PEAK_CPS_SOURCE, label: 'Peak CPS' },
  ]
}

/** Source keys a `relativeModifier` may read in this mode (stockpiles + peak CPS). */
export function addressableSources(mode: ModeDefinition): AddressableField[] {
  return addressableSourcesFor(mode.resources)
}

/**
 * Target keys a `relativeModifier` may feed, built from raw resource keys
 * (per-second rates) and generator ids (output, folded by `collectModifiers`),
 * plus the two special `ModifierContext` fields. The `*For` form takes
 * primitives for the editor (see {@link addressableSourcesFor}).
 *
 * Each resource contributes two targets: `rK` (its global layer — all
 * production) and `bK` (its isolated base producer — see {@link
 * ResourceLayers}). `bK` uses the resource's *index*, so `b0` is the base
 * producer of `resourceKeys[0]`.
 */
export function addressableTargetsFor(
  resourceKeys: readonly string[],
  generatorIds: readonly string[],
): AddressableField[] {
  return [
    { key: 'clickIncome', label: 'Click income' },
    ...resourceKeys.map((key) => ({ key, label: `${key} (rate)` })),
    ...resourceKeys.map((key, i) => ({ key: `b${i}`, label: `${key} (base producer)` })),
    ...generatorIds.map((id) => ({ key: id, label: `${id} (output)` })),
  ]
}

/**
 * Target keys a `relativeModifier` may feed in this mode: the two special
 * `ModifierContext` fields, each resource (a per-second rate), and each
 * generator (its output is folded by `collectModifiers`).
 */
export function addressableTargets(mode: ModeDefinition): AddressableField[] {
  return addressableTargetsFor(
    mode.resources,
    mode.generators.map((g) => g.id),
  )
}

/**
 * Target keys an *offensive* `enemyProductionModifier` (carried by a passive
 * attack) may feed on the opponent. Deliberately a **subset** of {@link
 * addressableTargetsFor}: the debuffs are merged into the opponent's pipeline
 * *after* `collectModifiers` has already folded generator output into resource
 * rates and only on the passive-income path — so generator-id and `clickIncome`
 * would silently do nothing. Only per-second resource rates actually apply,
 * so those are the only targets offered and validated.
 */
export function enemyDebuffTargetsFor(resourceKeys: readonly string[]): AddressableField[] {
  return resourceKeys.map((key) => ({ key, label: `${key} (rate)` }))
}

/** Offensive-debuff target keys for this mode (resource rates). */
export function enemyDebuffTargets(mode: ModeDefinition): AddressableField[] {
  return enemyDebuffTargetsFor(mode.resources)
}

/** The combined source/target catalog for a mode. */
export function listAddressableFields(mode: ModeDefinition): AddressableFields {
  return { sources: addressableSources(mode), targets: addressableTargets(mode) }
}

/**
 * Read the scalar a `source` key names from player state. Returns `null` for an
 * unrecognized key (so `apply` stays inert on a bad ref even though
 * `validateModeDefinition` already rejects one at boot). A missing resource /
 * meta value reads as `0`.
 */
export function readSourceValue(source: string, state: Readonly<PlayerState>): number | null {
  if (source === PEAK_CPS_SOURCE) {
    const v = state.meta.peakCps
    return typeof v === 'number' ? v : 0
  }
  if (source.startsWith(RESOURCE_SOURCE_PREFIX)) {
    const key = source.slice(RESOURCE_SOURCE_PREFIX.length)
    return state.resources[key] ?? 0
  }
  return null
}
