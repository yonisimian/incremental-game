import { z } from 'zod'

import type { Modifier } from '../../modifiers/types.js'
import type { PlayerState } from '../../types.js'
import type { EffectDef } from '../types.js'

/**
 * Schema for the `highlightMultiplier` effect's params.
 *
 * Either a flat `multiplier`, or a `multiplier` plus a boost tier: owning
 * `boostUpgradeId` raises the value to `boostedMultiplier`. Both boost fields are
 * a discriminated pair — present together or not at all. Strict objects make the
 * pairing enforceable: a partial boost matches neither union member and is
 * rejected, so `apply` never has to assert the fields' presence.
 *
 * `z.number()` already rejects `NaN`/`Infinity`, so finiteness needs no extra guard.
 */
const schema = z.union([
  z.strictObject({
    multiplier: z.number(),
    boostUpgradeId: z.string().min(1),
    boostedMultiplier: z.number(),
  }),
  z.strictObject({
    multiplier: z.number(),
  }),
])

/** Params for the `highlightMultiplier` effect (inferred from its schema). */
export type HighlightMultiplierParams = z.infer<typeof schema>

/**
 * The effect does not gate itself: as a per-upgrade effect it runs only when its
 * host upgrade is owned; as a mode-level effect it always runs.
 */
function apply(p: HighlightMultiplierParams, state: Readonly<PlayerState>): Modifier | null {
  // `?? 'r0'` mirrors the prior idler default when no resource is highlighted.
  const highlight = (state.meta.highlight as string | undefined) ?? 'r0'
  const value =
    'boostUpgradeId' in p && (state.upgrades[p.boostUpgradeId] ?? 0) > 0
      ? p.boostedMultiplier
      : p.multiplier
  return { stage: 'multiplicative', field: highlight, value }
}

export const highlightMultiplier: EffectDef<HighlightMultiplierParams> = { schema, apply }
