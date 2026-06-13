import { z } from 'zod'

import type { Modifier } from '../../modifiers/types.js'
import type { PlayerState } from '../../types.js'
import type { EffectDef } from '../types.js'

/**
 * Schema for the `highlightMultiplier` effect's params.
 *
 * A single `multiplier` applied to the highlighted resource. Tiers are composed
 * by distribution, not branching: a stronger tier is its own effect on a later
 * upgrade whose multiplier stacks multiplicatively with this one (e.g. `uh`'s ×2
 * and `uh2`'s ×1.5 combine to ×3). `z.number()` already rejects `NaN`/`Infinity`,
 * so finiteness needs no extra guard.
 */
const schema = z.strictObject({
  multiplier: z.number(),
})

/** Params for the `highlightMultiplier` effect (inferred from its schema). */
export type HighlightMultiplierParams = z.infer<typeof schema>

/**
 * The effect does not gate itself: as a per-upgrade effect it runs only when its
 * host upgrade is owned; as a mode-level effect it always runs.
 */
function apply(p: HighlightMultiplierParams, state: Readonly<PlayerState>): Modifier | null {
  // `?? 'r0'` mirrors the prior idler default when no resource is highlighted.
  const highlight = (state.meta.highlight as string | undefined) ?? 'r0'
  return { stage: 'multiplicative', field: highlight, value: p.multiplier }
}

export const highlightMultiplier: EffectDef<HighlightMultiplierParams> = { schema, apply }
