import { z } from 'zod'

import type { CostScope } from '../../types.js'
import type { EffectDef, EnemyPurchaseLockOutput } from '../types.js'

/**
 * Schema for the `enemyPurchaseLock` effect's params (plan 40).
 *
 * An *offensive embargo* carried by an active attack: for the attack's
 * `durationSec` after its strike lands, the opponent cannot **buy** what
 * `target` names — `upgrades`, `generators`, or `purchases` for both. It takes
 * nothing and slows nothing; it takes away the victim's *timing*, which is
 * decisive when fired at a player one purchase from a milestone and nearly
 * worthless otherwise. Selling and attack activation stay open (a lock is on
 * spending, and a locked player must still be able to fire back).
 *
 * The three words are a real enum rather than a catalog string like
 * `enemyCostModifier`'s `target`: there is no per-entity form, so the vocabulary
 * is closed and the editor's form gets its dropdown from the schema. The two
 * scope words match `ALL_UPGRADES_TARGET` / `ALL_GENERATORS_TARGET`, so one
 * authored word means the same thing across the two attack effects.
 *
 * A lock has no magnitude, so the attacker's `power` never touches it — the
 * lever for "a stronger lock" is `duration`. `validateModeDefinition` rejects a
 * `power` stat aimed at an attack whose effects are all locks, as it rejects
 * `duration` on an attack with no window.
 */
const schema = z.strictObject({
  /** What the victim is barred from buying. */
  target: z.enum(['upgrades', 'generators', 'purchases']),
})

/** Params for the `enemyPurchaseLock` effect (inferred from its schema). */
export type EnemyPurchaseLockParams = z.infer<typeof schema>

/** The scopes each authored target bars. `purchases` is both. */
const SCOPES_FOR_TARGET: Record<EnemyPurchaseLockParams['target'], readonly CostScope[]> = {
  upgrades: ['upgrade'],
  generators: ['generator'],
  purchases: ['upgrade', 'generator'],
}

/** The purchase scopes an `enemyPurchaseLock` ref's `target` bars. */
export function purchaseLockScopesFor(
  target: EnemyPurchaseLockParams['target'],
): readonly CostScope[] {
  return SCOPES_FOR_TARGET[target]
}

/**
 * State-independent: echoes the authored target as an
 * {@link EnemyPurchaseLockOutput}. Whether it actually applies (the owning
 * attack's window is open) is decided by `collectEnemyPurchaseLocks`, which
 * owns this output.
 */
function apply(p: EnemyPurchaseLockParams): EnemyPurchaseLockOutput {
  return { kind: 'enemyPurchaseLock', scopes: purchaseLockScopesFor(p.target) }
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
