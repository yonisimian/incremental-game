// @game/shared — pure pact rules: which pacts are in force between two
// players, and what each is worth to its beneficiary.
//
// The pact twin of `attacks.ts`. A pact effect only *describes* a buff (its
// `apply` receives one player's state, like every effect); everything that
// needs both players lives here, and nothing here is called by an effect. The
// server is the only side holding both states, so it runs these resolvers and
// ships their results — cost factors stamped on `PlayerState.pactCostFactors`,
// production bonuses on `STATE_UPDATE.pactBonuses`.

import { readEnemyStat } from './effects/enemy-stats.js'
import type { PartnerSnapshot } from './effects/enemy-stats.js'
import { applyEffect, normalizeEffectOutputs } from './effects/registry.js'
import type { MirrorCostOutput, MirrorModifierOutput } from './effects/types.js'
import type { Modifier } from './modifiers/types.js'
import { unlockedPacts } from './modes/index.js'
import type { ModeDefinition } from './modes/types.js'
import type { PactCostFactor, PactDefinition, PlayerState } from './types.js'

export type { PartnerSnapshot } from './effects/enemy-stats.js'

// ─── In force ────────────────────────────────────────────────────────

/**
 * The passive pacts whose buffs `owner` enjoys right now, in a stable order:
 * every passive pact `owner` has unlocked, then every **mutual** passive pact
 * `partner` has unlocked that `owner` has not. The single walk both pact
 * collectors share, so "what is in force" can't be answered differently for
 * prices than for production.
 *
 * Every pact listed resolves against the *partner*: an owner-held pact reads
 * the enemy by definition, and a partner-held mutual pact benefits `owner` by
 * reading its holder — who is, from `owner`'s side, the enemy. A pact both
 * players have signed appears once, not twice: "the enemy gains the same from
 * yours" is one treaty, not a doubled one. Plan 44 appends open active windows.
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
  return inForce
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
        if (!('kind' in out) || out.kind !== 'mirrorModifier') continue
        const modifier = resolveMirroredModifier(out, partner)
        if (modifier) modifiers.push(modifier)
      }
    }
    if (modifiers.length > 0) bonuses.push({ pact: pact.id, modifiers })
  }
  return bonuses
}

/** Flatten resolved bonuses for the pipeline (still unresolved for the virtual target). */
export function pactModifiers(bonuses: readonly PactBonus[]): Modifier[] {
  return bonuses.flatMap((b) => b.modifiers)
}
