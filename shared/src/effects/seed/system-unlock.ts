import { z } from 'zod'

import type { EffectDef, SystemUnlockOutput } from '../types.js'

/** The input systems an upgrade can unlock via a `systemUnlock` effect. */
export const UNLOCKABLE_SYSTEMS = ['click', 'highlight'] as const
export type UnlockableSystem = (typeof UNLOCKABLE_SYSTEMS)[number]

/**
 * Schema for the `systemUnlock` effect's params.
 *
 * While the owning upgrade is held, the named input system becomes active. The
 * system is one of `UNLOCKABLE_SYSTEMS` (`'click'` / `'highlight'`); a closed
 * enum, so an authored typo is rejected at load time (the editor also renders it
 * as a picker). A system that no owned upgrade unlocks is always available; see
 * `isClickUnlocked` / `isHighlightActive`.
 */
const schema = z.strictObject({
  system: z.enum(UNLOCKABLE_SYSTEMS),
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
