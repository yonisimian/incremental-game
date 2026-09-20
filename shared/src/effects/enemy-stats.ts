/**
 * The enemy-stat catalog: the opponent scalars a pact's `mirrorStatModifier`
 * may scale a bonus by, and the one reader every consumer resolves them with.
 *
 * Mode-specific (resource / generator / upgrade ids vary per mode), so like the
 * addressable-field catalog it is computed from a {@link ModeDefinition} rather
 * than baked into an effect's zod enum, and consumed in three places:
 *
 *  - `collectPactBonuses` (see `pacts.ts`) reads the named stat off the partner
 *    through {@link readEnemyStat};
 *  - `validateModeDefinition` rejects a `mirrorStatModifier` whose `source`
 *    isn't in the catalog, so a typo refuses to boot;
 *  - the `/dev.html` editor renders `source` as a dropdown over these keys.
 *
 * The spellings are deliberately borrowed, not invented: a resource stockpile
 * and its `:rate` form are the `accessEnemyData` intel keys, `peakCps` is the
 * intel key, and the entity keys (`upgrades` / `generators` / `upgrade:<id>` /
 * `generator:<id>`) are the enemy-cost target vocabulary. One vocabulary per
 * concept, so an author who has written one attack can write a pact.
 */

import type { PlayerState } from '../types.js'
import type { ModeDefinition } from '../modes/types.js'
import type { AddressableField } from './addressable.js'
import { enemyCostTargetsFor, parseEnemyCostTarget } from './addressable.js'
import {
  ENEMY_DATA_CPS_KEY,
  ENEMY_DATA_RATE_SUFFIX,
  enemyDataKeysFor,
  enemyDataResourceKey,
} from './seed/access-enemy-data.js'

/**
 * Stat key reading the opponent's `score`. Names no resource, so
 * `validateModeDefinition` refuses a mode declaring a resource by this name — the
 * same collision rule the intel keys have.
 */
export const ENEMY_STAT_SCORE_KEY = 'score'

/**
 * What a pact resolver may read about the partner. Assembled by the server
 * (the only side holding both players' states) once per tick; never sent.
 *
 * `rates` are the partner's per-second production **before their own pact
 * bonuses** — own modifiers plus the debuffs on them, nothing else. A `:rate`
 * source reads this figure, which is what makes two rate-mirroring pacts a
 * one-pass computation instead of a fixed point: "the enemy's own production"
 * is well-defined without asking what the enemy's pacts are worth first.
 */
export interface PartnerSnapshot {
  readonly state: Readonly<PlayerState>
  readonly rates: Readonly<Record<string, number>>
}

/**
 * The enemy stats a `mirrorStatModifier` may read, built from primitives so the
 * `/dev.html` editor — which holds a `TreeFile`, not a `ModeDefinition` — can
 * share one source of truth with the runtime and validator. Ordered for the
 * dropdown: per-resource stockpile and rate, then the two meta figures, then the
 * entity counts (whole scope first, then one key per entity).
 */
export function enemyStatKeysFor(
  resourceKeys: readonly string[],
  upgradeIds: readonly string[],
  generatorIds: readonly string[],
): AddressableField[] {
  const entities = enemyCostTargetsFor(upgradeIds, generatorIds).map(({ key }) => {
    const target = parseEnemyCostTarget(key)!
    if (target.id === undefined) {
      return {
        key,
        label: target.scope === 'upgrade' ? 'Upgrades (total levels)' : 'Generators (total owned)',
      }
    }
    return {
      key,
      label: `${target.id} (${target.scope === 'upgrade' ? 'upgrade level' : 'generator count'})`,
    }
  })
  return [
    ...resourceKeys.flatMap((resource) => {
      const [stockpile, rate] = enemyDataKeysFor(resource)
      return [
        { key: stockpile, label: `${resource} (stockpile)` },
        { key: rate, label: `${resource} (rate, before their pacts)` },
      ]
    }),
    { key: ENEMY_DATA_CPS_KEY, label: 'Peak CPS' },
    { key: ENEMY_STAT_SCORE_KEY, label: 'Score' },
    ...entities,
  ]
}

/** The enemy stats a `mirrorStatModifier` may read in this mode. */
export function enemyStatKeys(mode: ModeDefinition): AddressableField[] {
  return enemyStatKeysFor(
    mode.resources,
    mode.upgrades.map((u) => u.id),
    mode.generators.map((g) => g.id),
  )
}

/** Sum of a level / count map (the whole-scope entity stats). */
function total(counts: Readonly<Record<string, number>>): number {
  let sum = 0
  for (const n of Object.values(counts)) sum += n
  return sum
}

/**
 * Read the scalar a stat `key` names off the partner. An unknown key — or a
 * known one the partner has nothing under — reads as `0`, so a consumer never
 * needs to branch: a zero stat is simply a bonus worth nothing right now.
 * (`validateModeDefinition` already rejects an unknown key at boot; the `0` is
 * for a programmatically built ref.)
 */
export function readEnemyStat(snapshot: PartnerSnapshot, key: string): number {
  const { state } = snapshot
  if (key === ENEMY_STAT_SCORE_KEY) return state.score
  if (key === ENEMY_DATA_CPS_KEY) {
    const cps = state.meta.peakCps
    return typeof cps === 'number' ? cps : 0
  }
  if (key.endsWith(ENEMY_DATA_RATE_SUFFIX)) return snapshot.rates[enemyDataResourceKey(key)] ?? 0
  const target = parseEnemyCostTarget(key)
  if (target) {
    const counts = target.scope === 'upgrade' ? state.upgrades : state.generators
    return target.id === undefined ? total(counts) : (counts[target.id] ?? 0)
  }
  return state.resources[key] ?? 0
}
