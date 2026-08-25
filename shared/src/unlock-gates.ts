/**
 * Effect-driven unlock gates.
 *
 * A family of effects (`panelUnlock`, `generatorUnlock`, `systemUnlock`,
 * `unlockAttack`, `unlockPact`, `accessEnemyData`) carry no production weight —
 * instead they mark a UI panel, a generator, a system (clicking / highlighting /
 * the highlight battery), an attack, a pact, or a slice of enemy intel as
 * unlocked. Each shares the same shape: build a reverse index — gate key → who
 * grants it — so an "is this unlocked?" check is an O(grants-for-this-key)
 * lookup rather than a full scan of every effect (which runs on every frame via
 * the tab-lock refresh).
 *
 * A gate can be granted from either host the effects are legal on:
 * **an upgrade**, which grants only while that upgrade is held, or **the mode's
 * `startingEffects`**, which have no owner and so grant unconditionally for the
 * whole round. {@link GateSources} keeps the two apart, and {@link isGranted}
 * answers the question both ways.
 *
 * The index is derived topology (not authored data), so it lives in a WeakMap
 * keyed by the mode and is dropped automatically when the mode is GC'd. Every
 * effect in the family is state-independent (they echo their authored key), so a
 * throwaway probe state is enough to read which key each effect names.
 */

import { applyEffect, normalizeEffectOutputs } from './effects/index.js'
import type { EffectOutput } from './effects/index.js'
import type { ModeDefinition } from './modes/types.js'
import type { EffectRef, PlayerState } from './types.js'

// Re-exported from the `systemUnlock` seed (its schema owns the canonical enum,
// so the list and the load-time validation can't drift). Kept here too since
// the gate helpers below are the other natural home for "what can be unlocked".
export { UNLOCKABLE_SYSTEMS } from './effects/seed/system-unlock.js'
export type { UnlockableSystem } from './effects/seed/system-unlock.js'

/**
 * Who grants one gate key.
 *
 * The two hosts an unlock effect may be authored on differ in *when* they grant:
 * a mode-level starting effect has no owner, so it is in force for the whole
 * round; an upgrade's grants only while that upgrade is held. A key can be named
 * by both — the mode-level grant then simply makes the upgrade's redundant.
 */
export interface GateSources {
  /** A mode-level starting effect names this key → granted to every player, always. */
  readonly fromMode: boolean
  /** Ids of the upgrades whose effect names this key → granted while any is held. */
  readonly upgrades: readonly string[]
}

/** The mutable form {@link gateIndex} accumulates into. */
interface MutableGateSources {
  fromMode: boolean
  upgrades: string[]
}

// mode → effect type → (gate key → who grants it).
const gateCache = new WeakMap<ModeDefinition, Map<string, ReadonlyMap<string, GateSources>>>()

/**
 * A throwaway state for running the (state-independent) unlock effects while
 * building an index — they ignore everything but their authored params.
 */
function probeState(): PlayerState {
  return { score: 0, resources: {}, upgrades: {}, generators: {}, pendingAttacks: [], meta: {} }
}

/**
 * The reverse index for one unlock effect type: gate key → who grants it. Built
 * once per (mode, effect type) and cached. `keyOf` pulls the gate key from a
 * matching output (returning `null` for any output it doesn't own).
 *
 * Both hosts are scanned. Skipping the mode's own effects here would make an
 * unlock authored as a starting effect a silent no-op — the boot-time host check
 * permits it (`DEFAULT_EFFECT_HOSTS` covers `mode`), so nothing else would catch it.
 */
function gateIndex(
  mode: ModeDefinition,
  effectType: string,
  keyOf: (out: EffectOutput) => string | null,
): ReadonlyMap<string, GateSources> {
  let byType = gateCache.get(mode)
  if (!byType) {
    byType = new Map()
    gateCache.set(mode, byType)
  }
  const cached = byType.get(effectType)
  if (cached) return cached

  const index = new Map<string, MutableGateSources>()
  const probe = probeState()

  /** Record every key `refs` names, attributed to `owner` (`null` = the mode itself). */
  const record = (refs: readonly EffectRef[] | undefined, owner: string | null): void => {
    for (const ref of refs ?? []) {
      if (ref.type !== effectType) continue
      for (const out of normalizeEffectOutputs(applyEffect(ref, probe, mode))) {
        const key = keyOf(out)
        if (key === null) continue
        let sources = index.get(key)
        if (!sources) {
          sources = { fromMode: false, upgrades: [] }
          index.set(key, sources)
        }
        if (owner === null) sources.fromMode = true
        else if (!sources.upgrades.includes(owner)) sources.upgrades.push(owner)
      }
    }
  }

  record(mode.effects, null)
  for (const upgrade of mode.upgrades) record(upgrade.effects, upgrade.id)

  byType.set(effectType, index)
  return index
}

/** Who grants the `panelUnlock` gate on `panelId`, or `undefined` if nothing gates it. */
export function panelGate(mode: ModeDefinition, panelId: string): GateSources | undefined {
  return gateIndex(mode, 'panelUnlock', (out) =>
    'kind' in out && out.kind === 'panelUnlock' ? out.panel : null,
  ).get(panelId)
}

/** Who grants the `generatorUnlock` gate on `generatorId`, or `undefined` if nothing does. */
export function generatorGate(mode: ModeDefinition, generatorId: string): GateSources | undefined {
  return gateIndex(mode, 'generatorUnlock', (out) =>
    'kind' in out && out.kind === 'generatorUnlock' ? out.generator : null,
  ).get(generatorId)
}

/** Who grants the `systemUnlock` gate on `system`, or `undefined` if nothing gates it. */
export function systemGate(mode: ModeDefinition, system: string): GateSources | undefined {
  return gateIndex(mode, 'systemUnlock', (out) =>
    'kind' in out && out.kind === 'systemUnlock' ? out.system : null,
  ).get(system)
}

/** The reverse index for `unlockAttack`: attack id → who unlocks it. */
function attackGateIndex(mode: ModeDefinition): ReadonlyMap<string, GateSources> {
  return gateIndex(mode, 'unlockAttack', (out) =>
    'kind' in out && out.kind === 'attackUnlock' ? out.attack : null,
  )
}

/** Who grants the `unlockAttack` gate on `attackId`, or `undefined` if nothing does. */
export function attackGate(mode: ModeDefinition, attackId: string): GateSources | undefined {
  return attackGateIndex(mode).get(attackId)
}

/** Every attack id any `unlockAttack` effect in the mode names (declaration order). */
export function allAttackIds(mode: ModeDefinition): readonly string[] {
  return [...attackGateIndex(mode).keys()]
}

/** The reverse index for `unlockPact`: pact id → who unlocks it. */
function pactGateIndex(mode: ModeDefinition): ReadonlyMap<string, GateSources> {
  return gateIndex(mode, 'unlockPact', (out) =>
    'kind' in out && out.kind === 'pactUnlock' ? out.pact : null,
  )
}

/** Who grants the `unlockPact` gate on `pactId`, or `undefined` if nothing does. */
export function pactGate(mode: ModeDefinition, pactId: string): GateSources | undefined {
  return pactGateIndex(mode).get(pactId)
}

/** Every pact id any `unlockPact` effect in the mode names (declaration order). */
export function allPactIds(mode: ModeDefinition): readonly string[] {
  return [...pactGateIndex(mode).keys()]
}

/** Who grants the `accessEnemyData` gate on `dataKey`, or `undefined` if nothing does. */
export function enemyDataGate(mode: ModeDefinition, dataKey: string): GateSources | undefined {
  return gateIndex(mode, 'accessEnemyData', (out) =>
    'kind' in out && out.kind === 'enemyDataAccess' ? out.data : null,
  ).get(dataKey)
}

/**
 * Whether `sources` currently grant their gate: unconditionally (a mode-level
 * starting effect) or because the player holds one of the granting upgrades.
 * An absent gate is not granted — callers decide what "nothing gates this" means
 * (always available for panels/generators/systems, hidden for attacks/pacts/intel).
 */
export function isGranted(state: Readonly<PlayerState>, sources: GateSources | undefined): boolean {
  if (!sources) return false
  return sources.fromMode || sources.upgrades.some((id) => (state.upgrades[id] ?? 0) > 0)
}

// ─── System gates ────────────────────────────────────────────────────
//
// The `systemUnlock` predicates live here rather than in `modes/` so that
// `highlight-battery` can consult them without importing the mode registry,
// which imports the battery back (the one runtime import cycle this layering
// avoids). They read only a mode's own `*Enabled` flags plus the gate index
// above, so this is their natural home either way.

/**
 * Whether an input system is unlocked: gated by any `systemUnlock` effect naming
 * it (locked until its grant is in force — an owned upgrade, or the mode's
 * starting effects). A system nothing gates is always unlocked. Callers check the
 * relevant `*Enabled` flag first.
 */
function isSystemUnlocked(
  state: Readonly<PlayerState>,
  mode: ModeDefinition,
  system: string,
): boolean {
  const gate = systemGate(mode, system)
  if (!gate) return true // nothing gates this system → always available
  return isGranted(state, gate)
}

/** Whether the click mechanic is currently active for this player. */
export function isClickUnlocked(state: Readonly<PlayerState>, mode: ModeDefinition): boolean {
  if (!mode.clicksEnabled) return false
  return isSystemUnlocked(state, mode, 'click')
}

/** Whether the highlight mechanic is currently active for this player. */
export function isHighlightActive(state: Readonly<PlayerState>, mode: ModeDefinition): boolean {
  if (!mode.highlightEnabled) return false
  return isSystemUnlocked(state, mode, 'highlight')
}

/**
 * Whether the highlight battery is currently active for this player.
 *
 * Unlike the *input* systems above, this is **hidden by default**: the battery is
 * an added mechanic, so it needs an explicit grant (a mode that never mentions it
 * simply doesn't have one). That's the inverse of `isSystemUnlocked`'s "no gate →
 * always available", which is why this reads the gate directly rather than
 * reusing it — mirroring how `isAttackUnlocked` departs from `isPanelUnlocked`.
 *
 * Implies `isHighlightActive`: a battery for a highlight you can't use would
 * charge and drain against nothing.
 */
export function isHighlightBatteryActive(
  state: Readonly<PlayerState>,
  mode: ModeDefinition,
): boolean {
  if (!isHighlightActive(state, mode)) return false
  return isGranted(state, systemGate(mode, 'highlightBattery'))
}
