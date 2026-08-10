import { z } from 'zod'

import type { EffectDef, ResourceStealOutput } from '../types.js'

/**
 * Schema for the `stealResource` effect's params.
 *
 * Carried by an *active* attack: when the attack strikes, take some of the
 * victim's `resource` stockpile and credit it to the attacker. How much is
 * authored one of two ways, and *which key is present* is the discriminant:
 *
 * - `fraction` — a share of what the victim holds, in `(0, 1]` (`0.1` = 10%).
 * - `amount` — a flat quantity, any positive number.
 *
 * Two shapes rather than a `mode` + `value` pair, because each key then carries
 * its own fixed range: a range that depended on a sibling field would need a
 * `z.refine`, which the editor's schema-driven form can't introspect (it models
 * strict objects and unions of them, and hides any effect it can't describe).
 * As a union of strict objects it renders as a variant picker for free, and
 * setting both keys — or neither — parses as neither shape and so fails at load
 * (`validateModeDefinition` reports which, ahead of the raw zod error).
 *
 * `resource` is a plain `z.string()` (like other mode-specific keys) so the
 * editor form can introspect it; it's validated against the mode's resources at
 * load, so an authored typo fails loudly. The effect only describes the theft;
 * `resolveAttackStrike` owns the transfer arithmetic, including the clamp to
 * what the victim actually holds.
 */
const schema = z.union([
  z.strictObject({ resource: z.string(), fraction: z.number().gt(0).max(1) }),
  z.strictObject({ resource: z.string(), amount: z.number().positive() }),
])

/** Params for the `stealResource` effect (inferred from its schema). */
export type StealResourceParams = z.infer<typeof schema>

/**
 * State-independent: echoes the authored params as a {@link ResourceStealOutput},
 * preserving which shape was authored. Whether and how much is actually taken
 * (the victim's balance at strike time) is decided by `resolveAttackStrike`,
 * which owns this output.
 */
function apply(p: StealResourceParams): ResourceStealOutput {
  return 'amount' in p
    ? { kind: 'resourceSteal', resource: p.resource, amount: p.amount }
    : { kind: 'resourceSteal', resource: p.resource, fraction: p.fraction }
}

export const stealResource: EffectDef<StealResourceParams> = {
  schema,
  apply,
  // A steal resolves on a strike, and only `resolveAttackStrike` reads this
  // output — an active attack is the one host where it can ever fire.
  hosts: ['activeAttack'],
}
