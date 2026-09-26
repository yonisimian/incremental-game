import { z } from 'zod'

import { MODIFIER_STAGES } from '../../modifiers/types.js'
import { guardModifierValue } from '../../modifiers/value-guard.js'
import type { EffectDef, EnemyModifierOutput } from '../types.js'

/**
 * Schema for the `enemyProductionModifier` effect's params.
 *
 * An *offensive* production modifier carried by an attack: while the attack is
 * unlocked, apply `value` to the **opponent's** `field` at the given pipeline
 * `stage`. `field` is a debuffable target — a resource rate, `clickIncome`, or
 * the virtual `highlightFactor`; like `baseModifier`'s `field`, it's a plain
 * `z.string()` so the schema-driven editor form can introspect it. The valid set
 * is the *enemy-debuff* catalog, which overlaps but doesn't match the full
 * addressable targets: the debuff merges into the opponent's pipeline after
 * generator output is folded, so generator-id targets would silently do nothing.
 * The editor dropdown offers only the supported targets and
 * `validateModeDefinition` rejects the rest at load, so an authored typo (or an
 * unsupported target) fails loudly.
 *
 * For a passive attack the modifier applies continuously while unlocked:
 *
 *  - `field: "r0", stage: "multiplicative", value: 0.9` — 10% off the opponent's
 *    wood production;
 *  - `field: "clickIncome", stage: "multiplicative", value: 0.7` — 30% off what
 *    each of their clicks pays;
 *  - `field: "highlightFactor", stage: "multiplicative", value: 0.9` — cuts
 *    their highlight *bonus* 10% (scaling the bonus above neutral, not the whole
 *    factor), whichever resource they hold;
 *  - `field: "highlightFactor", stage: "additive", value: -1` — subtracts from
 *    the highlight factor directly, which (unlike the multiplicative form) can
 *    cancel the bonus entirely, though it's clamped at neutral — never a penalty.
 *
 * On an *active* attack the same modifier applies for the attack's
 * `durationSec` after the strike lands — a debuff window, tracked on the
 * attacker as `activeDebuffs`. Same vocabulary, an order of magnitude stronger
 * values, paid for with a prepare cost and delay.
 *
 * `collectEnemyDebuffs` gathers these (from unlocked passive attacks and open
 * windows alike) and `resolveEnemyDebuffs` translates the virtual
 * `highlightFactor` target against the victim; the effect itself only
 * describes the debuff.
 */
const schema = z
  .strictObject({
    stage: z.enum(MODIFIER_STAGES),
    field: z.string(),
    value: z.number(),
  })
  .superRefine(guardModifierValue('debuff', 'enemyProductionModifier'))

/** Params for the `enemyProductionModifier` effect (inferred from its schema). */
export type EnemyProductionModifierParams = z.infer<typeof schema>

/**
 * State-independent: echoes the authored modifier as an
 * {@link EnemyModifierOutput}. Whether it actually applies (the attack is an
 * unlocked passive one held by the *other* player, or an active one whose
 * window is open) is decided by `collectEnemyDebuffs`, which owns this output.
 * Unlike `baseModifier` there is no owned-count compounding — an attack is
 * unlocked or it isn't.
 */
function apply(p: EnemyProductionModifierParams): EnemyModifierOutput {
  return { kind: 'enemyModifier', modifier: { stage: p.stage, field: p.field, value: p.value } }
}

export const enemyProductionModifier: EffectDef<EnemyProductionModifierParams> = {
  schema,
  apply,
  // Only `collectEnemyDebuffs` reads this output, and it walks the *passive*
  // attacks a player holds plus the debuff windows their *active* attacks have
  // opened — anywhere else the debuff would never be gathered.
  hosts: ['passiveAttack', 'activeAttack'],
}
