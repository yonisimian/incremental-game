// @game/shared — pure pact rules: which pacts are in force between two
// players, and what each is worth to its beneficiary.
//
// The pact twin of `attacks.ts`. A pact effect only *describes* a buff (its
// `apply` receives one player's state, like every effect); everything that
// needs both players lives here, and nothing here is called by an effect. The
// server is the only side holding both states, so it runs these resolvers and
// ships their results — cost factors stamped on `PlayerState.pactCostFactors`,
// production bonuses on `STATE_UPDATE.pactBonuses`.

import { scaledCost } from './cost.js'
import { cooldownUntilSec, startCooldown } from './cooldowns.js'
import { readEnemyStat } from './effects/enemy-stats.js'
import type { PartnerSnapshot } from './effects/enemy-stats.js'
import { applyEffect, normalizeEffectOutputs } from './effects/registry.js'
import type {
  EffectOutput,
  MirrorCostOutput,
  MirrorModifierOutput,
  PactSlotsOutput,
} from './effects/types.js'
import type { Modifier } from './modifiers/types.js'
import { readGameSec } from './game-clock.js'
import { createInitialState, isPactUnlocked, unlockedPacts } from './modes/index.js'
import type { ModeDefinition } from './modes/types.js'
import { isCostAffordable } from './upgrade-costs.js'
import type {
  ActivePact,
  EffectRef,
  PactCostFactor,
  PactDefinition,
  PactKind,
  PlayerState,
  UpgradeDefinition,
} from './types.js'

export type { PartnerSnapshot } from './effects/enemy-stats.js'

// ─── In force ────────────────────────────────────────────────────────

/**
 * The pacts whose buffs `owner` enjoys right now, in a stable order: every
 * passive pact `owner` has unlocked, then every **mutual** passive pact
 * `partner` has unlocked, then `owner`'s open active-pact windows, then
 * `partner`'s open **mutual** active-pact windows — each skipping a pact
 * already listed. The single walk both pact collectors share, so "what is in
 * force" can't be answered differently for prices than for production. An
 * open window is simply a pact in force for a while.
 *
 * Every pact listed resolves against the *partner*: an owner-held pact reads
 * the enemy by definition, and a partner-held mutual pact benefits `owner` by
 * reading its holder — who is, from `owner`'s side, the enemy. A pact both
 * players have signed appears once, not twice: "the enemy gains the same from
 * yours" is one treaty, not a doubled one.
 */
export function pactsInForce(
  owner: Readonly<PlayerState>,
  partner: Readonly<PlayerState>,
  mode: ModeDefinition,
): PactDefinition[] {
  const pactById = new Map(mode.pacts.map((p) => [p.id, p]))
  const inForce: PactDefinition[] = []
  const seen = new Set<string>()
  for (const id of unlockedPacts(owner, mode)) {
    const pact = pactById.get(id)
    if (pact?.kind !== 'passive') continue
    inForce.push(pact)
    seen.add(id)
  }
  for (const id of unlockedPacts(partner, mode)) {
    const pact = pactById.get(id)
    if (pact?.kind !== 'passive' || pact.mutual !== true || seen.has(id)) continue
    inForce.push(pact)
    seen.add(id)
  }
  for (const id of openWindowIds(owner)) {
    const pact = pactById.get(id)
    if (pact?.kind !== 'active' || seen.has(id)) continue
    inForce.push(pact)
    seen.add(id)
  }
  for (const id of openWindowIds(partner)) {
    const pact = pactById.get(id)
    if (pact?.kind !== 'active' || pact.mutual !== true || seen.has(id)) continue
    inForce.push(pact)
    seen.add(id)
  }
  return inForce
}

/** Ids of the active-pact windows open on `state` at its own game clock. */
function openWindowIds(state: Readonly<PlayerState>): string[] {
  return openPactWindows(state, readGameSec(state)).map((w) => w.pact)
}

/** The effect types that act on the signer's *partner* rather than the signer. */
const PARTNER_DIRECTED_EFFECTS: ReadonlySet<string> = new Set(['partnerAutoClick'])

/**
 * Whether `pact` reaches the other player while in force: it is `mutual` (they
 * get the same buffs), or it carries a partner-directed effect (a gift such as
 * `partnerAutoClick`). Judged by ref type, as the validator does.
 */
function reachesPartner(pact: PactDefinition): boolean {
  if (pact.mutual === true) return true
  return (pact.effects ?? []).some((ref) => PARTNER_DIRECTED_EFFECTS.has(ref.type))
}

/**
 * `partner`'s open active-pact windows that reach the other player (see
 * {@link reachesPartner}), with their closing time on `partner`'s clock — what
 * lets the viewer count down a treaty they did not sign.
 */
export function sharedPactWindows(
  partner: Readonly<PlayerState>,
  mode: ModeDefinition,
): ActivePact[] {
  const pactById = new Map(mode.pacts.map((p) => [p.id, p]))
  return openPactWindows(partner, readGameSec(partner)).filter((w) => {
    const pact = pactById.get(w.pact)
    return pact?.kind === 'active' && reachesPartner(pact)
  })
}

/**
 * The pacts of `partner`'s that reach the other player right now — unlocked
 * mutual passive ones in mode declaration order, then open active-pact windows
 * that are mutual or carry a gift. What the server reveals of a partner's
 * pacts (`OpponentView.pacts`): only these already affect the viewer, so a
 * one-sided pact stays hidden.
 */
export function sharedPacts(partner: Readonly<PlayerState>, mode: ModeDefinition): string[] {
  const pactById = new Map(mode.pacts.map((p) => [p.id, p]))
  const passive = unlockedPacts(partner, mode).filter((id) => {
    const pact = pactById.get(id)
    return pact?.kind === 'passive' && pact.mutual === true
  })
  return [...passive, ...sharedPactWindows(partner, mode).map((w) => w.pact)]
}

// ─── Cost factors ────────────────────────────────────────────────────

/**
 * The entities a `mirrorCost` output is in force on right now: those in its
 * scope (one named id, or every entity of the scope) that `partner` owns more
 * levels / copies of than `owner` — "they already bought what you are about to
 * buy". Expanding a whole-scope target here is what keeps the stamped list
 * concrete, so the price paths need no scope-wide branch of their own.
 */
function mirroredEntities(
  out: MirrorCostOutput,
  owner: Readonly<PlayerState>,
  partner: Readonly<PlayerState>,
  mode: ModeDefinition,
): string[] {
  const ids =
    out.id !== undefined
      ? [out.id]
      : out.scope === 'upgrade'
        ? mode.upgrades.map((u) => u.id)
        : mode.generators.map((g) => g.id)
  const [own, theirs] =
    out.scope === 'upgrade'
      ? [owner.upgrades, partner.upgrades]
      : [owner.generators, partner.generators]
  return ids.filter((id) => (theirs[id] ?? 0) > (own[id] ?? 0))
}

/**
 * The discounts in force on `owner`'s prices — the cost-path pact collector,
 * gathered from every pact `pactsInForce` lists and resolved against `partner`.
 * Each `mirrorCost`-emitting effect contributes one concrete `{ scope, id }`
 * entry per entity the partner is ahead on (see {@link mirroredEntities}),
 * tagged with the granting pact. No owned-count compounding — a pact is in
 * force or it isn't — and no `power`: pacts have no stats to scale by.
 *
 * The server stamps the result onto {@link PlayerState.pactCostFactors}
 * wherever a price is about to be judged or shown (the same cadence as
 * `incomingCostFactors`, since the partner's level can change on any message);
 * `pactCostFactors` in `cost.ts` is the victim-side read.
 */
export function collectPactCostFactors(
  owner: Readonly<PlayerState>,
  partner: Readonly<PlayerState>,
  mode: ModeDefinition,
): PactCostFactor[] {
  const factors: PactCostFactor[] = []
  for (const pact of pactsInForce(owner, partner, mode)) {
    for (const ref of pact.effects ?? []) {
      for (const out of normalizeEffectOutputs(applyEffect(ref, owner, mode))) {
        if (!('kind' in out) || out.kind !== 'mirrorCost') continue
        for (const id of mirroredEntities(out, owner, partner, mode)) {
          factors.push({
            pact: pact.id,
            scope: out.scope,
            id,
            ...(out.costFactor !== undefined ? { costFactor: out.costFactor } : {}),
            ...(out.scalingFactor !== undefined ? { scalingFactor: out.scalingFactor } : {}),
          })
        }
      }
    }
  }
  return factors
}

// ─── Production bonuses ──────────────────────────────────────────────

/**
 * What one pact in force is worth to its beneficiary right now — for the
 * pipeline (flattened by {@link pactModifiers}) and for the relations panel,
 * which lists it per pact. Resolved server-side and shipped on `STATE_UPDATE`,
 * since the enemy stats it reads are never sent.
 */
export interface PactBonus {
  /** Pact id (matches {@link PactDefinition.id}). */
  readonly pact: string
  /** The resolved modifiers, as authored — may still name the virtual `highlightFactor`. Never empty. */
  readonly modifiers: readonly Modifier[]
}

/**
 * Turn one mirrored rule into the modifier it is worth against `partner`:
 * `perUnit × stat`, bounded by `cap`, applied at the rule's stage — additive
 * adds the bonus, multiplicative scales by `1 + bonus`. `null` when the bonus is
 * nothing (the partner has none of the source), so a worthless pact reports and
 * applies nothing rather than a neutral modifier.
 */
function resolveMirroredModifier(
  out: MirrorModifierOutput,
  partner: PartnerSnapshot,
): Modifier | null {
  const stat = readEnemyStat(partner, out.source)
  const raw = out.perUnit * stat
  const bonus = out.cap === undefined ? raw : Math.min(raw, out.cap)
  if (!(bonus > 0)) return null
  return {
    stage: out.stage,
    field: out.field,
    value: out.stage === 'additive' ? bonus : 1 + bonus,
  }
}

/**
 * What each pact in force is worth to `owner` right now — the production-path
 * pact collector, the twin of {@link collectPactCostFactors}. Walks
 * `pactsInForce`, runs each ref against the owner (the signature every effect
 * is owed; neither pact effect reads it), keeps the `mirrorModifier` outputs
 * and resolves each against the *partner* snapshot — the enemy's stats, and
 * the enemy's **pact-free** rates (see {@link PartnerSnapshot}), which is what
 * keeps two rate-mirroring pacts a single pass rather than a fixed point.
 *
 * Every pact listed resolves against `partner`, a partner-held mutual pact
 * included: it benefits `owner` by reading its holder, who is `owner`'s enemy.
 * So one snapshot suffices, and the server calls this once per player with the
 * roles swapped.
 *
 * A `pactModifier` output (from `pactProductionModifier`) needs no partner: it
 * is kept verbatim, in authoring order beside the resolved mirrors.
 *
 * Bonuses come out **as authored**, which can include the virtual
 * `highlightFactor` field. Run them through `resolveEnemyDebuffs` (whose
 * arithmetic is direction-neutral) before handing them to the pipeline, as the
 * debuffs are. A pact whose rules all resolve to nothing is omitted.
 */
export function collectPactBonuses(
  owner: Readonly<PlayerState>,
  partner: PartnerSnapshot,
  mode: ModeDefinition,
): PactBonus[] {
  const bonuses: PactBonus[] = []
  for (const pact of pactsInForce(owner, partner.state, mode)) {
    const modifiers: Modifier[] = []
    for (const ref of pact.effects ?? []) {
      for (const out of normalizeEffectOutputs(applyEffect(ref, owner, mode))) {
        if (!('kind' in out)) continue
        if (out.kind === 'pactModifier') {
          modifiers.push(out.modifier)
        } else if (out.kind === 'mirrorModifier') {
          const modifier = resolveMirroredModifier(out, partner)
          if (modifier) modifiers.push(modifier)
        }
      }
    }
    if (modifiers.length > 0) bonuses.push({ pact: pact.id, modifiers })
  }
  return bonuses
}

/**
 * Automatic clicks per second `signer`'s open active-pact windows grant their
 * **partner** — the `partnerAutoClick` outputs, summed across windows (two
 * such pacts stack). Judged on the signer's clock, as every window is. Resolved
 * server-side: the partner's click income and click target live there.
 */
export function collectPartnerAutoClicks(
  signer: Readonly<PlayerState>,
  mode: ModeDefinition,
): number {
  const pactById = new Map(mode.pacts.map((p) => [p.id, p]))
  let clicksPerSec = 0
  for (const id of openWindowIds(signer)) {
    const pact = pactById.get(id)
    if (pact?.kind !== 'active') continue
    for (const ref of pact.effects ?? []) {
      for (const out of normalizeEffectOutputs(applyEffect(ref, signer, mode))) {
        if ('kind' in out && out.kind === 'partnerAutoClick') clicksPerSec += out.clicksPerSec
      }
    }
  }
  return clicksPerSec
}

/** Flatten resolved bonuses for the pipeline (still unresolved for the virtual target). */
export function pactModifiers(bonuses: readonly PactBonus[]): Modifier[] {
  return bonuses.flatMap((b) => b.modifiers)
}

// ─── Activation ──────────────────────────────────────────────────────
//
// The active-attack lifecycle with the strike removed: activate (pay) → window
// (`durationSec`) → cooldown (`cooldownSec`). The window opens on the
// activating tick, so the client predicts it with the same function the server
// applies — `applyPactActivation` — and the reconcile replays it.

/**
 * Why an active pact cannot be activated right now. `unaffordable` is the only
 * transient reason (wait for income); the rest are permanent for the current
 * state — the order `attackBlockReason` uses.
 */
export type PactBlockReason =
  | 'unknown' // no such pact
  | 'not-active' // a passive pact (always-on, never activated)
  | 'locked' // not yet unlocked (no gating upgrade owned)
  | 'no-effects' // an effect-less placeholder — nothing to activate
  | 'already-active' // this pact's window is still open
  | 'cooling-down' // the window closed; its cooldown has not elapsed
  | 'unaffordable' // valid target, cannot pay the activation cost yet

/**
 * An active pact's activation cost resolved to concrete per-currency amounts,
 * each evaluated at level 0 (pacts have no cost curve). Empty when unset.
 */
export function getPactActivationCost(def: PactDefinition): Record<string, number> {
  const cost: Record<string, number> = {}
  for (const [currency, entry] of Object.entries(def.activationCost ?? {})) {
    cost[currency] = scaledCost(entry, 0)
  }
  return cost
}

/**
 * Game-clock time pact `pactId`'s open window closes, or `null` when none is
 * open. A closed window the server has not swept yet reads as `null`.
 */
export function activePactExpiresAtSec(
  state: Readonly<PlayerState>,
  pactId: string,
): number | null {
  const gameSec = readGameSec(state)
  const window = state.activePacts?.find((w) => w.pact === pactId && w.expiresAtSec > gameSec)
  return window?.expiresAtSec ?? null
}

/**
 * The pact windows in `state` still open at `gameSec` (strictly before
 * `expiresAtSec`). Pure. The server's tick sweeps with it; readers apply the
 * same test at read time.
 */
export function openPactWindows(state: Readonly<PlayerState>, gameSec: number): ActivePact[] {
  return (state.activePacts ?? []).filter((w) => w.expiresAtSec > gameSec)
}

/** The reason pact `pactId` cannot be activated right now, or `null` if it can. */
export function pactBlockReason(
  state: Readonly<PlayerState>,
  pactId: string,
  mode: ModeDefinition,
): PactBlockReason | null {
  const def = mode.pacts.find((p) => p.id === pactId)
  if (!def) return 'unknown'
  if (def.kind !== 'active') return 'not-active'
  if (!isPactUnlocked(state, mode, pactId)) return 'locked'
  if ((def.effects?.length ?? 0) === 0) return 'no-effects'
  if (activePactExpiresAtSec(state, pactId) !== null) return 'already-active'
  if (cooldownUntilSec(state, 'pact', pactId) !== null) return 'cooling-down'
  if (!isCostAffordable(state.resources, getPactActivationCost(def))) return 'unaffordable'
  return null
}

/** Whether pact `pactId` can be activated right now (`pactBlockReason === null`). */
export function isValidPactActivation(
  state: Readonly<PlayerState>,
  pactId: string,
  mode: ModeDefinition,
): boolean {
  return pactBlockReason(state, pactId, mode) === null
}

/**
 * Activate pact `pactId` on `state`: deduct the activation cost, open its
 * window for `durationSec`, and — the window's end being known now — stamp its
 * cooldown to lift `cooldownSec` after that. Mutates `state`; callers validate
 * first (`isValidPactActivation`). Never touches `score`.
 */
export function applyPactActivation(
  state: PlayerState,
  pactId: string,
  mode: ModeDefinition,
): void {
  const def = mode.pacts.find((p) => p.id === pactId)
  if (!def) return
  for (const [currency, amount] of Object.entries(getPactActivationCost(def))) {
    state.resources[currency] = (state.resources[currency] ?? 0) - amount
  }
  const expiresAtSec = readGameSec(state) + (def.durationSec ?? 0)
  const others = (state.activePacts ?? []).filter((w) => w.pact !== pactId)
  state.activePacts = [...others, { pact: pactId, expiresAtSec }]
  if (def.cooldownSec !== undefined)
    startCooldown(state, 'pact', pactId, expiresAtSec + def.cooldownSec)
}

// ─── Pact slots ──────────────────────────────────────────────────────
//
// The pact twin of the attack budget (`attacks.ts § Attack slots`): how many
// pacts of each kind a player can *hold*. Unlocking stays derived and
// monotonic; the cap refuses the *purchase* that would exceed it. No player
// state — the count is the unlocked pacts, the limit a sum over owned grants.

/** Whether an effect output is a pact-slot grant. */
function isPactSlotsOutput(out: EffectOutput): out is PactSlotsOutput {
  return 'kind' in out && out.kind === 'pactSlots'
}

/**
 * The pact kinds a mode caps: those any `pactSlots` effect names, on the mode
 * or on any upgrade, owned or not. Derived topology, cached per mode.
 */
const cappedPactKindsCache = new WeakMap<ModeDefinition, ReadonlySet<PactKind>>()

function cappedPactKinds(mode: ModeDefinition): ReadonlySet<PactKind> {
  const cached = cappedPactKindsCache.get(mode)
  if (cached) return cached
  const kinds = new Set<PactKind>()
  // State-independent effect, so a fresh initial state is probe enough.
  const probe = createInitialState(mode)
  const scan = (refs: readonly EffectRef[] | undefined): void => {
    for (const ref of refs ?? []) {
      if (ref.type !== 'pactSlots') continue
      for (const out of normalizeEffectOutputs(applyEffect(ref, probe, mode))) {
        if (isPactSlotsOutput(out)) kinds.add(out.pactKind)
      }
    }
  }
  scan(mode.effects)
  for (const upgrade of mode.upgrades) scan(upgrade.effects)
  cappedPactKindsCache.set(mode, kinds)
  return kinds
}

/** Whether the mode caps how many pacts of `kind` a player may hold. */
export function isPactKindCapped(mode: ModeDefinition, kind: PactKind): boolean {
  return cappedPactKinds(mode).has(kind)
}

/** The pact slots one host's refs grant for `kind`, at `owned` levels. */
function pactSlotsGranted(
  refs: readonly EffectRef[] | undefined,
  owned: number,
  state: Readonly<PlayerState>,
  mode: ModeDefinition,
  kind: PactKind,
): number {
  let total = 0
  for (const ref of refs ?? []) {
    if (ref.type !== 'pactSlots') continue
    for (const out of normalizeEffectOutputs(applyEffect(ref, state, mode))) {
      if (isPactSlotsOutput(out) && out.pactKind === kind) total += out.value * owned
    }
  }
  return total
}

/**
 * How many pacts of `kind` this player may hold: the mode's base grant plus
 * `value × owned` for every owned `pactSlots` upgrade naming the kind.
 * `Infinity` for a kind the mode never caps.
 */
export function pactLimit(
  state: Readonly<PlayerState>,
  mode: ModeDefinition,
  kind: PactKind,
): number {
  if (!isPactKindCapped(mode, kind)) return Infinity
  let limit = pactSlotsGranted(mode.effects, 1, state, mode, kind)
  for (const upgrade of mode.upgrades) {
    const owned = state.upgrades[upgrade.id] ?? 0
    if (owned > 0) limit += pactSlotsGranted(upgrade.effects, owned, state, mode, kind)
  }
  return limit
}

/**
 * How many pacts of `kind` this player holds — the unlocked pacts of the kind.
 * Counts *pacts*, not unlock routes, as `attackSlotsHeld` does.
 */
export function pactSlotsHeld(
  state: Readonly<PlayerState>,
  mode: ModeDefinition,
  kind: PactKind,
): number {
  const kindOf = new Map(mode.pacts.map((p) => [p.id, p.kind]))
  return unlockedPacts(state, mode).filter((id) => kindOf.get(id) === kind).length
}

/**
 * Whether buying one more level of `def` fits the player's pact budget: the
 * pacts its `unlockPact` refs would newly unlock, bucketed by kind, must fit
 * `held + adding <= limit` — the limit including any slots `def` itself grants.
 * All-or-nothing, and an upgrade unlocking no pact is never blocked here —
 * `hasAttackSlotsFor`'s rules.
 */
export function hasPactSlotsFor(
  state: Readonly<PlayerState>,
  def: UpgradeDefinition,
  mode: ModeDefinition,
): boolean {
  const adding = new Map<PactKind, Set<string>>()
  const kindOf = new Map(mode.pacts.map((p) => [p.id, p.kind]))
  for (const ref of def.effects ?? []) {
    if (ref.type !== 'unlockPact') continue
    for (const out of normalizeEffectOutputs(applyEffect(ref, state, mode))) {
      if (!('kind' in out) || out.kind !== 'pactUnlock') continue
      if (isPactUnlocked(state, mode, out.pact)) continue
      const kind = kindOf.get(out.pact)
      if (!kind) continue // unknown pact — rejected at boot
      let ids = adding.get(kind)
      if (!ids) {
        ids = new Set()
        adding.set(kind, ids)
      }
      ids.add(out.pact)
    }
  }
  for (const [kind, ids] of adding) {
    const limit = pactLimit(state, mode, kind) + pactSlotsGranted(def.effects, 1, state, mode, kind)
    if (pactSlotsHeld(state, mode, kind) + ids.size > limit) return false
  }
  return true
}
