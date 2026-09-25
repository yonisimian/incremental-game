import { z } from 'zod'

import { parsePurchaseLockTarget } from '../addressable.js'
import type { EffectDef, EnemyPurchaseLockOutput } from '../types.js'

/**
 * Schema for the `enemyPurchaseLock` effect's params.
 *
 * An *offensive embargo* carried by an active attack: for the attack's
 * `durationSec` after its strike lands, the opponent cannot **buy** what
 * `target` names. It takes nothing and slows nothing; it takes away the
 * victim's *timing*, which is
 * decisive when fired at a player one purchase from a milestone and nearly
 * worthless otherwise. Selling and attack activation stay open (a lock is on
 * spending, and a locked player must still be able to fire back).
 *
 * `target` is a catalog key, the same vocabulary as `enemyCostModifier`'s:
 * `upgrades` / `generators` for a whole scope, `upgrade:<id>` / `generator:<id>`
 * for one entity, plus `purchases` for both scopes at once. Like the cost
 * target it is a mode-specific string the schema only checks is present;
 * `validateModeDefinition` checks it against `purchaseLockTargets`.
 *
 * A lock has no magnitude, so the attacker's `power` never touches it — the
 * lever for "a stronger lock" is `duration`. `validateModeDefinition` rejects a
 * `power` stat aimed at an attack whose effects are all locks, as it rejects
 * `duration` on an attack with no window.
 */
const schema = z.strictObject({
  /** What the victim is barred from buying. */
  target: z.string(),
})

/** Params for the `enemyPurchaseLock` effect (inferred from its schema). */
export type EnemyPurchaseLockParams = z.infer<typeof schema>

/**
 * State-independent: echoes the authored target as an
 * {@link EnemyPurchaseLockOutput}, or `null` for an unrecognized one (boot
 * rejects it first). Whether it actually applies (the owning attack's window is
 * open) is decided by `collectEnemyPurchaseLocks`, which owns this output.
 */
function apply(p: EnemyPurchaseLockParams): EnemyPurchaseLockOutput | null {
  const targets = parsePurchaseLockTarget(p.target)
  return targets ? { kind: 'enemyPurchaseLock', targets } : null
}

export const enemyPurchaseLock: EffectDef<EnemyPurchaseLockParams> = {
  schema,
  apply,
  // Active only — the first debuff effect that refuses the passive host on
  // purpose. A passive lock would bar the victim from buying for the whole
  // round, which is not a debuff but a loss condition; declaring the host list
  // here keeps the editor from ever offering it there and the boot-time check
  // from ever loading it.
  hosts: ['activeAttack'],
}
