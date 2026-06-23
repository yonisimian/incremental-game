/**
 * Effect-driven unlock gates.
 *
 * A family of effects (`panelUnlock`, `generatorUnlock`, `systemUnlock`) carry
 * no production weight — instead, while the owning upgrade is held they mark a
 * UI panel, a generator, or an input system (clicking / highlighting) as
 * unlocked. Each shares the same shape: build a reverse index — gate key → ids
 * of the upgrades whose effect names it — so an "is this unlocked?" check is an
 * O(gates-for-this-key) ownership lookup rather than a full scan of every
 * upgrade/effect (which runs on every frame via the tab-lock refresh).
 *
 * The index is derived topology (not authored data), so it lives in a WeakMap
 * keyed by the mode and is dropped automatically when the mode is GC'd. All
 * three effects are state-independent (they echo their authored key), so a
 * throwaway probe state is enough to read which key each effect names.
 */

import { applyEffect, normalizeEffectOutputs } from './effects/index.js'
import type { EffectOutput } from './effects/index.js'
import type { ModeDefinition } from './modes/types.js'
import type { PlayerState } from './types.js'

/** The input systems an upgrade can unlock via a `systemUnlock` effect. */
export const UNLOCKABLE_SYSTEMS = ['click', 'highlight'] as const
export type UnlockableSystem = (typeof UNLOCKABLE_SYSTEMS)[number]

// mode → effect type → (gate key → ids of the upgrades whose effect names it).
const gateCache = new WeakMap<ModeDefinition, Map<string, ReadonlyMap<string, readonly string[]>>>()

/**
 * A throwaway state for running the (state-independent) unlock effects while
 * building an index — they ignore everything but their authored params.
 */
function probeState(): PlayerState {
  return { score: 0, resources: {}, upgrades: {}, generators: {}, meta: {} }
}

/**
 * The reverse index for one unlock effect type: gate key → ids of the upgrades
 * whose effect of that type names the key. Built once per (mode, effect type)
 * and cached. `keyOf` pulls the gate key from a matching output (returning
 * `null` for any output it doesn't own).
 */
function gateIndex(
  mode: ModeDefinition,
  effectType: string,
  keyOf: (out: EffectOutput) => string | null,
): ReadonlyMap<string, readonly string[]> {
  let byType = gateCache.get(mode)
  if (!byType) {
    byType = new Map()
    gateCache.set(mode, byType)
  }
  const cached = byType.get(effectType)
  if (cached) return cached

  const index = new Map<string, string[]>()
  const probe = probeState()
  for (const upgrade of mode.upgrades) {
    for (const ref of upgrade.effects ?? []) {
      if (ref.type !== effectType) continue
      for (const out of normalizeEffectOutputs(applyEffect(ref, probe, mode))) {
        const key = keyOf(out)
        if (key === null) continue
        const gates = index.get(key)
        if (gates) {
          if (!gates.includes(upgrade.id)) gates.push(upgrade.id)
        } else {
          index.set(key, [upgrade.id])
        }
      }
    }
  }
  byType.set(effectType, index)
  return index
}

/** Ids of the upgrades whose `panelUnlock` effect gates `panelId`, or `undefined` if none. */
export function panelGateUpgrades(
  mode: ModeDefinition,
  panelId: string,
): readonly string[] | undefined {
  return gateIndex(mode, 'panelUnlock', (out) =>
    'kind' in out && out.kind === 'panelUnlock' ? out.panel : null,
  ).get(panelId)
}

/** Ids of the upgrades whose `generatorUnlock` effect gates `generatorId`, or `undefined`. */
export function generatorGateUpgrades(
  mode: ModeDefinition,
  generatorId: string,
): readonly string[] | undefined {
  return gateIndex(mode, 'generatorUnlock', (out) =>
    'kind' in out && out.kind === 'generatorUnlock' ? out.generator : null,
  ).get(generatorId)
}

/** Ids of the upgrades whose `systemUnlock` effect gates `system`, or `undefined` if none. */
export function systemGateUpgrades(
  mode: ModeDefinition,
  system: string,
): readonly string[] | undefined {
  return gateIndex(mode, 'systemUnlock', (out) =>
    'kind' in out && out.kind === 'systemUnlock' ? out.system : null,
  ).get(system)
}

/** Whether the player owns at least one of `ids` (false for an empty/absent gate). */
export function anyOwned(
  state: Readonly<PlayerState>,
  ids: readonly string[] | undefined,
): boolean {
  return ids?.some((id) => (state.upgrades[id] ?? 0) > 0) ?? false
}
