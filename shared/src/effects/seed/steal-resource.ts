import { z } from 'zod'

import type { EffectDef, ResourceStealOutput } from '../types.js'

/**
 * Schema for the `stealResource` effect's params.
 *
 * Carried by an *active* attack: when the attack strikes, take `fraction` of the
 * victim's `resource` stockpile and credit it to the attacker. `resource` is a
 * plain `z.string()` (like other mode-specific keys) so the schema-driven editor
 * form can introspect it; it's validated against the mode's resources at load
 * (`validateModeDefinition`), so an authored typo fails loudly. `fraction` is a
 * share in `(0, 1]`. The effect only describes the theft; `resolveAttackStrike`
 * owns the transfer arithmetic.
 */
const schema = z.strictObject({
  resource: z.string(),
  fraction: z.number().gt(0).max(1),
})

/** Params for the `stealResource` effect (inferred from its schema). */
export type StealResourceParams = z.infer<typeof schema>

/**
 * State-independent: echoes the authored params as a {@link ResourceStealOutput}.
 * Whether and how much is actually taken (the victim's balance at strike time) is
 * decided by `resolveAttackStrike`, which owns this output.
 */
function apply(p: StealResourceParams): ResourceStealOutput {
  return { kind: 'resourceSteal', resource: p.resource, fraction: p.fraction }
}

export const stealResource: EffectDef<StealResourceParams> = { schema, apply }
