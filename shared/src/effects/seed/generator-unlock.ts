import { z } from 'zod'

import type { EffectDef, GeneratorUnlockOutput } from '../types.js'

/**
 * Schema for the `generatorUnlock` effect's params.
 *
 * While the owning upgrade is held, the named generator becomes available. The
 * generator id matches `GeneratorDefinition.id`. A generator that no owned
 * upgrade unlocks is always available; see `isGeneratorUnlocked`.
 */
const schema = z.strictObject({
  generator: z.string(),
})

/** Params for the `generatorUnlock` effect (inferred from its schema). */
export type GeneratorUnlockParams = z.infer<typeof schema>

/**
 * State-independent: echoes the authored generator id as a
 * {@link GeneratorUnlockOutput}. Whether the gate is actually satisfied (the
 * upgrade is owned) is decided by `isGeneratorUnlocked`, which owns this output.
 */
function apply(p: GeneratorUnlockParams): GeneratorUnlockOutput {
  return { kind: 'generatorUnlock', generator: p.generator }
}

export const generatorUnlock: EffectDef<GeneratorUnlockParams> = { schema, apply }
