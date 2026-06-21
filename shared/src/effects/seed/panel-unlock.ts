import { z } from 'zod'

import type { EffectDef, PanelUnlockOutput } from '../types.js'

/**
 * Schema for the `panelUnlock` effect's params.
 *
 * While the owning upgrade is held, the named UI panel becomes accessible. The
 * panel id matches the client `Panel.id` (e.g. `'generators'`). A panel that no
 * owned upgrade unlocks is always available; see `isPanelUnlocked`.
 */
const schema = z.strictObject({
  panel: z.string(),
})

/** Params for the `panelUnlock` effect (inferred from its schema). */
export type PanelUnlockParams = z.infer<typeof schema>

/**
 * State-independent: echoes the authored panel id as a {@link PanelUnlockOutput}.
 * Whether the gate is actually satisfied (the upgrade is owned) is decided by
 * `isPanelUnlocked`, which owns this output.
 */
function apply(p: PanelUnlockParams): PanelUnlockOutput {
  return { kind: 'panelUnlock', panel: p.panel }
}

export const panelUnlock: EffectDef<PanelUnlockParams> = { schema, apply }
