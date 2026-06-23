import { z } from 'zod'

import type { EffectDef, EnemyDataAccessOutput } from '../types.js'

/**
 * Schema for the `accessEnemyData` effect's params.
 *
 * While the owning upgrade is held, the named opponent resource (`data` is a
 * resource key, e.g. `'r0'`) becomes visible in the espionage panel. The editor
 * offers the tree's resource keys as a dropdown. Like `generatorCost`'s
 * `generator`, the field is a plain `z.string()` (not a `z.enum`) so the
 * schema-driven editor form can introspect it — the valid set is enforced by
 * the dropdown and tolerated by `hasEnemyDataAccess` (an unknown key reveals
 * nothing rather than erroring).
 */
const schema = z.strictObject({
  data: z.string(),
})

/** Params for the `accessEnemyData` effect (inferred from its schema). */
export type AccessEnemyDataParams = z.infer<typeof schema>

/**
 * State-independent: echoes the authored intel key as an
 * {@link EnemyDataAccessOutput}. Whether the gate is actually satisfied (the
 * viewer owns the upgrade) is decided by `hasEnemyDataAccess`, which owns this
 * output.
 */
function apply(p: AccessEnemyDataParams): EnemyDataAccessOutput {
  return { kind: 'enemyDataAccess', data: p.data }
}

export const accessEnemyData: EffectDef<AccessEnemyDataParams> = { schema, apply }
