import { z } from 'zod'

import type { Modifier } from '../../modifiers/types.js'
import type { PlayerState } from '../../types.js'
import type { EffectDef } from '../types.js'

/**
 * Schema for the `peakCpsClickBonus` effect's params.
 *
 * Adds the player's peak clicks-per-second (the highest CPS reached this match)
 * to their click income. `perCps` scales how much each point of peak CPS is
 * worth (default `1`, so a peak of 13 CPS grants +13 click income). The bonus is
 * additive and recomputed every click as peak CPS climbs. Peak CPS is mirrored
 * into `state.meta.peakCps` by the match loop so the pipeline can read it.
 */
const schema = z.strictObject({
  perCps: z.number().positive().optional(),
})

/** Params for the `peakCpsClickBonus` effect (inferred from its schema). */
export type PeakCpsClickBonusParams = z.infer<typeof schema>

/**
 * Reads the live peak CPS from `state.meta.peakCps` (0 until the first click)
 * and contributes it to click income. Inactive (returns `null`) until peak CPS
 * is positive, mirroring the other state-dependent effects.
 */
function apply(p: PeakCpsClickBonusParams, state: Readonly<PlayerState>): Modifier | null {
  const peakCps = (state.meta.peakCps as number | undefined) ?? 0
  if (peakCps <= 0) return null
  const perCps = p.perCps ?? 1
  return { stage: 'additive', field: 'clickIncome', value: peakCps * perCps }
}

export const peakCpsClickBonus: EffectDef<PeakCpsClickBonusParams> = { schema, apply }
