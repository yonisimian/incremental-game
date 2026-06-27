import { z } from 'zod'

import type { EffectDef, EnemyDataAccessOutput } from '../types.js'

/**
 * Suffix marking an `accessEnemyData` key as the per-second *rate* of a resource
 * (e.g. `'r0:rate'`) rather than its stockpile (`'r0'`). Single source of truth
 * shared by the effect, mode validation, the espionage panel, and the editor's
 * key dropdown so the convention can't drift.
 */
export const ENEMY_DATA_RATE_SUFFIX = ':rate'

/**
 * Intel key revealing the opponent's peak clicks-per-second (`meta.peakCps`).
 * Unlike the per-resource keys it names no resource, so `validateModeDefinition`
 * whitelists it and the editor dropdown offers it alongside the resource keys.
 */
export const ENEMY_DATA_CPS_KEY = 'cps'

/** The two intel keys a resource exposes: its stockpile and its per-second rate. */
export function enemyDataKeysFor(resourceKey: string): [string, string] {
  return [resourceKey, `${resourceKey}${ENEMY_DATA_RATE_SUFFIX}`]
}

/** The resource a `data` key refers to, stripping an optional `:rate` suffix. */
export function enemyDataResourceKey(data: string): string {
  return data.endsWith(ENEMY_DATA_RATE_SUFFIX)
    ? data.slice(0, -ENEMY_DATA_RATE_SUFFIX.length)
    : data
}

/**
 * Schema for the `accessEnemyData` effect's params.
 *
 * While the owning upgrade is held, the named slice of opponent intel becomes
 * visible in the espionage panel: a resource key (e.g. `'r0'`) reveals that
 * resource's stockpile, and a `':rate'`-suffixed key (e.g. `'r0:rate'`) reveals
 * its per-second production. The editor offers both per resource as a dropdown.
 * Like `generatorCost`'s `generator`, the field is a plain `z.string()` (not a
 * `z.enum`) so the schema-driven editor form can introspect it — the valid set
 * is enforced by the dropdown, validated against the mode's resources at load
 * (`validateModeDefinition`), and tolerated by `hasEnemyDataAccess` (an unknown
 * key reveals nothing rather than erroring).
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
