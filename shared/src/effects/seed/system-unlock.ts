import { z } from 'zod'

import type { EffectDef, SystemUnlockOutput } from '../types.js'

/**
 * Schema for the `systemUnlock` effect's params.
 *
 * While the owning upgrade is held, the named input system becomes active. The
 * system is `'click'` or `'highlight'` (see `UNLOCKABLE_SYSTEMS`). Modelled as a
 * plain string — like `panelUnlock`'s `panel` — so the editor renders it as a
 * picker (a value naming no real system simply gates nothing). A system that no
 * owned upgrade unlocks is always available; see `isClickUnlocked` /
 * `isHighlightActive`.
 */
const schema = z.strictObject({
  system: z.string(),
})

/** Params for the `systemUnlock` effect (inferred from its schema). */
export type SystemUnlockParams = z.infer<typeof schema>

/**
 * State-independent: echoes the authored system name as a
 * {@link SystemUnlockOutput}. Whether the gate is actually satisfied (the
 * upgrade is owned) is decided by `isClickUnlocked` / `isHighlightActive`, which
 * own this output.
 */
function apply(p: SystemUnlockParams): SystemUnlockOutput {
  return { kind: 'systemUnlock', system: p.system }
}

export const systemUnlock: EffectDef<SystemUnlockParams> = { schema, apply }
