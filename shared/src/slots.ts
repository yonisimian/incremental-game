// @game/shared — one slot-budget algorithm, instantiated once per system.
//
// Attacks and pacts both cap how many of each kind a player can *hold*: a
// budget per kind, granted by the mode and raised by upgrades, enforced by
// refusing the *purchase* that would unlock one too many. Unlocking stays
// derived and monotonic; no player state is added — the count is the unlocked
// entities, the limit a sum over owned grants. `attacks.ts` and `pacts.ts`
// each describe their system once (which effect grants, which unlocks, what
// is held) and get the four rules back, so a change to the budget — the
// all-or-nothing rule, the owned-count scaling — is made in one place.

import { applyEffect, normalizeEffectOutputs } from './effects/registry.js'
import type { EffectOutput } from './effects/types.js'
import { createInitialState } from './modes/index.js'
import type { ModeDefinition } from './modes/types.js'
import type { EffectRef, PlayerState, UpgradeDefinition } from './types.js'

/** How one system — attacks, pacts — plugs into the slot budget. */
export interface SlotSystem<Kind extends string> {
  /** The ref type of the grant effect (`attackSlots`); other refs are skipped unrun. */
  readonly grantType: string
  /** The grant an output carries, or `null` for an output of another kind. */
  readonly readGrant: (out: EffectOutput) => { readonly kind: Kind; readonly value: number } | null
  /** The ref type of the unlock effect (`unlockAttack`); other refs are skipped unrun. */
  readonly unlockType: string
  /** The entity id an unlock output names, or `null` for an output of another kind. */
  readonly readUnlock: (out: EffectOutput) => string | null
  /** The mode's entities of this system, each with its kind. */
  readonly entities: (
    mode: ModeDefinition,
  ) => readonly { readonly id: string; readonly kind: Kind }[]
  /** Whether this player has unlocked the entity. */
  readonly isUnlocked: (state: Readonly<PlayerState>, mode: ModeDefinition, id: string) => boolean
  /** Every entity this player has unlocked. */
  readonly unlocked: (state: Readonly<PlayerState>, mode: ModeDefinition) => readonly string[]
}

/** The slot rules of one system; `attacks.ts` and `pacts.ts` export them under their own names. */
export interface SlotBudget<Kind extends string> {
  /** Whether the mode caps how many entities of `kind` a player may hold. */
  readonly isCapped: (mode: ModeDefinition, kind: Kind) => boolean
  /**
   * How many entities of `kind` this player may hold: the mode's base grant
   * plus `value × owned` for every owned grant upgrade naming the kind.
   * `Infinity` for a kind the mode never caps, so a mode that authors no slots
   * keeps its tree as pure breadth.
   */
  readonly limit: (state: Readonly<PlayerState>, mode: ModeDefinition, kind: Kind) => number
  /**
   * How many entities of `kind` this player holds — the unlocked ones, filtered
   * by kind. Counts *entities*, not unlock upgrades: two upgrades unlocking the
   * same one fill one slot, and one granted by the mode's starting effects
   * fills one too (it is held, and exempting it would make the cap mean
   * different things in different modes).
   */
  readonly held: (state: Readonly<PlayerState>, mode: ModeDefinition, kind: Kind) => number
  /**
   * Whether buying one more level of `def` fits the player's budget.
   *
   * Runs the upgrade's unlock refs, keeps the entities *not already* unlocked
   * (no double charge for a second route to the same one), buckets them by
   * kind, and requires `held + adding <= limit` for each kind — where the
   * limit includes any slots `def` itself would grant, so a node that adds a
   * slot and fills it in one purchase is legal. All-or-nothing for an upgrade
   * unlocking two entities with one slot free: a partial unlock is not
   * representable, since the gate is derived from the upgrade being owned.
   *
   * An upgrade with no unlock effect is never blocked here.
   */
  readonly hasSlotsFor: (
    state: Readonly<PlayerState>,
    def: UpgradeDefinition,
    mode: ModeDefinition,
  ) => boolean
}

/** Build the slot rules for one system. Called once per system, at module load. */
export function makeSlotBudget<Kind extends string>(system: SlotSystem<Kind>): SlotBudget<Kind> {
  /**
   * The kinds a mode caps: those any grant effect names, on the mode itself or
   * on any upgrade, owned or not. Derived topology, so it is built once per
   * mode and cached — like the unlock-gate index.
   *
   * Naming a kind *anywhere* is what caps it, so a mode whose only slot grant
   * sits on an upgrade caps the kind at `0` until that upgrade is bought (see
   * the `attackSlots` seed for why that is authorable).
   */
  const cappedKindsCache = new WeakMap<ModeDefinition, ReadonlySet<Kind>>()

  function cappedKinds(mode: ModeDefinition): ReadonlySet<Kind> {
    const cached = cappedKindsCache.get(mode)
    if (cached) return cached
    const kinds = new Set<Kind>()
    // The grant effect is state-independent (it echoes its authored params), so
    // a fresh initial state is probe enough.
    const probe = createInitialState(mode)
    const scan = (refs: readonly EffectRef[] | undefined): void => {
      for (const ref of refs ?? []) {
        if (ref.type !== system.grantType) continue
        for (const out of normalizeEffectOutputs(applyEffect(ref, probe, mode))) {
          const grant = system.readGrant(out)
          if (grant) kinds.add(grant.kind)
        }
      }
    }
    scan(mode.effects)
    for (const upgrade of mode.upgrades) scan(upgrade.effects)
    cappedKindsCache.set(mode, kinds)
    return kinds
  }

  /** The slots one host's refs grant for `kind`, at `owned` levels — the additive fold `limit` applies to every grant. */
  function granted(
    refs: readonly EffectRef[] | undefined,
    owned: number,
    state: Readonly<PlayerState>,
    mode: ModeDefinition,
    kind: Kind,
  ): number {
    let total = 0
    for (const ref of refs ?? []) {
      // Skip non-grant effects without running them, matching `collectAttackParams`.
      if (ref.type !== system.grantType) continue
      for (const out of normalizeEffectOutputs(applyEffect(ref, state, mode))) {
        const grant = system.readGrant(out)
        if (grant?.kind === kind) total += grant.value * owned
      }
    }
    return total
  }

  /**
   * Entity id → kind, built once per mode and reused — `held` and `hasSlotsFor`
   * sit under `purchaseBlockReason`, which the client runs for every tree node
   * on every render, so a map per call would be the render's dominant
   * allocation. Keyed by identity: a re-registered (patched) mode is a new key.
   */
  const kindByIdCache = new WeakMap<ModeDefinition, ReadonlyMap<string, Kind>>()

  function kindById(mode: ModeDefinition): ReadonlyMap<string, Kind> {
    let index = kindByIdCache.get(mode)
    if (!index) {
      index = new Map(system.entities(mode).map((e) => [e.id, e.kind]))
      kindByIdCache.set(mode, index)
    }
    return index
  }

  function isCapped(mode: ModeDefinition, kind: Kind): boolean {
    return cappedKinds(mode).has(kind)
  }

  function limit(state: Readonly<PlayerState>, mode: ModeDefinition, kind: Kind): number {
    if (!isCapped(mode, kind)) return Infinity
    let total = granted(mode.effects, 1, state, mode, kind)
    for (const upgrade of mode.upgrades) {
      const owned = state.upgrades[upgrade.id] ?? 0
      if (owned > 0) total += granted(upgrade.effects, owned, state, mode, kind)
    }
    return total
  }

  function held(state: Readonly<PlayerState>, mode: ModeDefinition, kind: Kind): number {
    const kindOf = kindById(mode)
    let count = 0
    for (const id of system.unlocked(state, mode)) if (kindOf.get(id) === kind) count += 1
    return count
  }

  function hasSlotsFor(
    state: Readonly<PlayerState>,
    def: UpgradeDefinition,
    mode: ModeDefinition,
  ): boolean {
    // Most nodes unlock nothing of this system: answer before allocating.
    if (!def.effects?.some((ref) => ref.type === system.unlockType)) return true
    const adding = new Map<Kind, Set<string>>()
    const kindOf = kindById(mode)
    for (const ref of def.effects) {
      if (ref.type !== system.unlockType) continue
      for (const out of normalizeEffectOutputs(applyEffect(ref, state, mode))) {
        const id = system.readUnlock(out)
        if (id === null) continue
        if (system.isUnlocked(state, mode, id)) continue
        const kind = kindOf.get(id)
        if (!kind) continue // unknown entity — `validateModeDefinition` rejects it at boot
        let ids = adding.get(kind)
        if (!ids) {
          ids = new Set()
          adding.set(kind, ids)
        }
        ids.add(id)
      }
    }
    for (const [kind, ids] of adding) {
      const room = limit(state, mode, kind) + granted(def.effects, 1, state, mode, kind)
      if (held(state, mode, kind) + ids.size > room) return false
    }
    return true
  }

  return { isCapped, limit, held, hasSlotsFor }
}
