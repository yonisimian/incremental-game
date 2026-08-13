import { z } from 'zod'

import type { EffectDef, GeneratorStealOutput } from '../types.js'

/**
 * Schema for the `stealGenerator` effect's params.
 *
 * Carried by an *active* attack: when the attack strikes, take copies of the
 * victim's `generator` and hand them to the attacker. How many is authored one
 * of two ways, and *which key is present* is the discriminant:
 *
 * - `fraction` — a share of the copies the victim owns, in `(0, 1]` (`0.5` =
 *   half, floored to a whole copy).
 * - `count` — a flat number of copies (a positive integer).
 *
 * Two shapes rather than a `mode` + `value` pair, for the same reason as
 * `stealResource`: each key then carries its own fixed range without a
 * `z.refine`, which the editor's schema-driven form can't introspect. Setting
 * both keys — or neither — parses as neither shape and fails at load, with
 * `validateModeDefinition` naming the mistake ahead of the raw zod error.
 *
 * `generator` is a plain `z.string()` (like other mode-specific keys) so the
 * editor form can introspect it; it's validated against the mode's generators at
 * load. The effect only describes the theft; `resolveAttackStrike` owns the
 * transfer arithmetic — the floor, and the clamp to what the victim actually
 * owns.
 */
const schema = z.union([
  z.strictObject({ generator: z.string(), fraction: z.number().gt(0).max(1) }),
  z.strictObject({ generator: z.string(), count: z.number().int().positive() }),
])

/** Params for the `stealGenerator` effect (inferred from its schema). */
export type StealGeneratorParams = z.infer<typeof schema>

/**
 * State-independent: echoes the authored params as a {@link GeneratorStealOutput},
 * preserving which shape was authored. How many copies actually move (the
 * victim's owned count at strike time) is decided by `resolveAttackStrike`,
 * which owns this output.
 */
function apply(p: StealGeneratorParams): GeneratorStealOutput {
  return 'count' in p
    ? { kind: 'generatorSteal', generator: p.generator, count: p.count }
    : { kind: 'generatorSteal', generator: p.generator, fraction: p.fraction }
}

export const stealGenerator: EffectDef<StealGeneratorParams> = {
  schema,
  apply,
  // A steal resolves on a strike, and only `resolveAttackStrike` reads this
  // output — an active attack is the one host where it can ever fire.
  hosts: ['activeAttack'],
}
