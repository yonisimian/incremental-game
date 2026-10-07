import { z } from 'zod'

import { MAX_CPS } from '../../game-config.js'
import type { EffectDef, PartnerAutoClickOutput } from '../types.js'

/**
 * Schema for the `partnerAutoClick` effect's params.
 *
 * A pact's *price paid to the other side*: while the pact is in force, the
 * **partner** is credited `clicksPerSec` automatic clicks per second — each
 * worth what a real click of theirs would earn right now, credited to what they
 * last clicked on. A partner who has not unlocked clicking gets nothing.
 *
 *  - `clicksPerSec: 3` — the enemy clicks three extra times a second, for free.
 *
 * Partner-directed (`partnerDirected: true`), so it is *not* shared through
 * `mutual` (which means "the partner gets the same buff") and boot rejects it
 * on a mutual pact. Bounded by the human click-rate limit (`MAX_CPS`): a gift
 * faster than anyone can click is an authoring slip.
 */
const schema = z.strictObject({
  clicksPerSec: z.number().positive().max(MAX_CPS),
})

/** Params for the `partnerAutoClick` effect (inferred from its schema). */
export type PartnerAutoClickParams = z.infer<typeof schema>

/**
 * State-independent: echoes the rate as a {@link PartnerAutoClickOutput}. Only
 * `collectPartnerAutoClicks` reads it, and only from open active-pact windows.
 */
function apply(p: PartnerAutoClickParams): PartnerAutoClickOutput {
  return { kind: 'partnerAutoClick', clicksPerSec: p.clicksPerSec }
}

export const partnerAutoClick: EffectDef<PartnerAutoClickParams> = {
  schema,
  apply,
  // A permanent auto-clicker for the enemy is not a pact anyone would sign.
  hosts: ['activePact'],
  // The gift goes to the partner: never on a mutual pact, always revealed to them.
  partnerDirected: true,
}
