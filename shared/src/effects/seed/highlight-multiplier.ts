import { z } from 'zod'

import { readHighlight } from '../../highlight.js'
import type { PlayerState } from '../../types.js'
import type { BaseModifierOutput, EffectDef } from '../types.js'

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
  multiplier: z.number().gt(1),
})

/** Params for the `highlightMultiplier` effect (inferred from its schema). */
export type HighlightMultiplierParams = z.infer<typeof schema>

/**
 * The effect does not gate itself: as a per-upgrade effect it runs only when its
 * host upgrade is owned; as a mode-level effect it always runs.
 *
 * Inactive (returns `null`) while nothing is highlighted — the bonus has no
 * resource to land on, and defaulting to one would hand out a multiplier the
 * player never selected.
 */
function apply(
  p: HighlightMultiplierParams,
  state: Readonly<PlayerState>,
): BaseModifierOutput | null {
  const highlight = readHighlight(state)
  if (highlight === null) return null
  return {
    kind: 'baseModifier',
    stage: 'multiplicative',
    field: highlight,
    value: p.multiplier,
  }
}

export const highlightMultiplier: EffectDef<HighlightMultiplierParams> = { schema, apply }
