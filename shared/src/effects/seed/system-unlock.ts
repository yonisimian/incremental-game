import { z } from 'zod'

import type { EffectDef, SystemUnlockOutput } from '../types.js'

/** The systems an upgrade can unlock via a `systemUnlock` effect. */
export const UNLOCKABLE_SYSTEMS = ['click', 'highlight', 'highlightBattery'] as const
export type UnlockableSystem = (typeof UNLOCKABLE_SYSTEMS)[number]

/**
 * Schema for the `systemUnlock` effect's params.
 *
 * While the owning upgrade is held, the named system becomes active. The system
 * is one of `UNLOCKABLE_SYSTEMS`; a closed enum, so an authored typo is rejected
 * at load time (the editor also renders it as a picker).
 *
 * The two *input* systems (`click` / `highlight`) default to available when no
 * upgrade gates them — a mode that never mentions them still lets you play. The
 * `highlightBattery` is the opposite: an added mechanic, hidden unless an upgrade
 * grants it. See `isClickUnlocked` / `isHighlightActive` /
 * `isHighlightBatteryActive`, which own that distinction.
 */
const schema = z.strictObject({
  system: z.enum(UNLOCKABLE_SYSTEMS),
})

/** Params for the `systemUnlock` effect (inferred from its schema). */
export type SystemUnlockParams = z.infer<typeof schema>

/**
 * State-independent: echoes the authored system name as a
 * {@link SystemUnlockOutput}. Whether the gate is actually satisfied (the
 * upgrade is owned) is decided by `isClickUnlocked` / `isHighlightActive` /
 * `isHighlightBatteryActive`, which own this output.
 */
function apply(p: SystemUnlockParams): SystemUnlockOutput {
  return { kind: 'systemUnlock', system: p.system }
}

export const systemUnlock: EffectDef<SystemUnlockParams> = { schema, apply }
