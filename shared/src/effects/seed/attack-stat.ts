import { z } from 'zod'

import type { AttackStatOutput, EffectDef } from '../types.js'

/**
 * The attack parameters an `attackStat` effect can move.
 *
 * `duration` is deliberately absent: an active attack has no duration field yet
 * (see plan 37), so shipping the enum member would offer the `/dev.html` editor
 * a stat nothing reads. Add it here — plus a floor in `ATTACK_PARAM_FLOORS` and a
 * consumer — when durations land.
 */
export const ATTACK_STATS = ['power', 'prepareCost', 'prepareTime'] as const
export type AttackStat = (typeof ATTACK_STATS)[number]

/**
 * How an `attackStat` adjustment combines with the attack's authored value.
 *
 * `add` and `mult` are *relative*: they shape a multiplier on whatever the attack
 * authored (`add` shifts it, `mult` scales it), because each attack authors its
 * own numbers and there is no global default to add to — unlike `batteryStat`,
 * whose `add` lands in the stat's own units on top of `BATTERY_DEFAULTS`.
 *
 * `offset` is the *absolute* op, in the stat's own unit — `offset: -1` on
 * `prepareTime` is one second sooner, per owned level. It exists only for stats
 * whose unit is well-defined ({@link attackStatOpsFor}), which is why the two
 * conventions can coexist without `add` meaning two things.
 */
export const ATTACK_STAT_OPS = ['add', 'mult', 'offset'] as const
export type AttackStatOp = (typeof ATTACK_STAT_OPS)[number]

/**
 * The stats an `offset` can move: those measured in a single, unambiguous unit.
 *
 * - `prepareTime` — seconds. Well-defined.
 * - `prepareCost` — *not* well-defined: an attack may cost several currencies, so
 *   a flat `-100` would have to be applied to each, arbitrarily.
 * - `power` — no unit at all: an attack's magnitude lives in a `fraction`, a flat
 *   `amount`, a `count`, or a debuff's distance from neutral, so `+1` would mean a
 *   different thing per effect the attack carries.
 */
const OFFSET_STATS: readonly AttackStat[] = ['prepareTime']

/**
 * The ops that are legal on `stat`. Enforced by the schema below (so a
 * hand-edited tree is rejected at load) and read by the `/dev.html` form, which
 * offers only these — the same "narrow the picker, don't just reject later"
 * treatment `attackStatsFor` gives the stat list itself.
 */
export function attackStatOpsFor(stat: AttackStat): readonly AttackStatOp[] {
  if (OFFSET_STATS.includes(stat)) return ATTACK_STAT_OPS
  return ATTACK_STAT_OPS.filter((op) => op !== 'offset')
}

/**
 * Schema for the `attackStat` effect's params.
 *
 * Scales one of an attack's numbers while the owning upgrade is held: how hard it
 * hits (`power`), what activating it costs (`prepareCost`), or how long the
 * strike takes to land (`prepareTime`). `op` picks how — `add` shifts the
 * multiplier, `mult` scales it, `offset` shifts the stat's own unit — and each
 * compounds with the owned count (`add × owned`, `mult ** owned`,
 * `offset × owned`) in `collectAttackParams`.
 *
 * Hosted on the *production-pipeline* hosts (mode + upgrade, the default), not on
 * the attacks themselves: a stat is something an upgrade grants, not something an
 * attack carries. `attack` names which attack to buff, or is omitted to buff
 * every attack in the mode (mirroring `EnemyCostOutput.id`), so "+20% to all
 * raids" is one authored node rather than one per attack.
 *
 * One effect with a `stat` enum rather than three near-identical effects, for the
 * same reasons as `batteryStat`: a closed enum rejects an authored typo at boot,
 * generates one editor form, and keeps the owned-count folding in a single place.
 *
 * `power` is likewise one stat rather than one per output kind. An attack's
 * magnitude lives in a different field depending on what it does (`fraction`,
 * `amount`, `count`, a debuff's distance from neutral), but an author thinks in
 * one currency — "this raid hits harder" — and the consumer knows the output kind
 * at the moment it applies the scale, so the per-kind arithmetic lives there.
 * An attack whose effects mix kinds (a steal *and* a debuff) has both scaled by
 * the same `power`, which is the intent.
 *
 * TODO: if an attack ever needs only *part* of its magnitude buffed (steal but
 * not debuff), split `power` into per-kind enum members — a compatible change,
 * since `power` keeps meaning "all of them".
 *
 * `value` is deliberately unconstrained beyond finiteness (zod rejects `NaN` and
 * the infinities): the meaningful range differs per `stat` and `op` (`mult` of
 * `0.5` is a *good* thing on `prepareTime` and a bad one on `power`), so a single
 * guard here would either be wrong for half the combinations or reject legitimate
 * authoring. `collectAttackParams` clamps the resolved multipliers to their
 * floors and `getAttackPrepareTimeSec` floors the offset delay at zero, so a
 * mis-authored value is inert rather than inverting the mechanic.
 */
const schema = z
  .strictObject({
    /** Which attack to buff, or absent for every attack in the mode. */
    attack: z.string().optional(),
    stat: z.enum(ATTACK_STATS),
    op: z.enum(ATTACK_STAT_OPS),
    value: z.number(),
  })
  // Applied object-level (like `guardModifierValue`) so the schema keeps its
  // `object` shape for the editor's form introspection.
  .superRefine((p, ctx) => {
    if (attackStatOpsFor(p.stat).includes(p.op)) return
    ctx.addIssue({
      code: 'custom',
      message: `op '${p.op}' does not apply to stat '${p.stat}' — an absolute offset needs a single unambiguous unit, which only ${OFFSET_STATS.join(', ')} has`,
      path: ['op'],
    })
  })

/** Params for the `attackStat` effect (inferred from its schema). */
export type AttackStatParams = z.infer<typeof schema>

/**
 * State-independent: echoes the authored adjustment as an
 * {@link AttackStatOutput}. The owned-count compounding, cross-upgrade stacking,
 * the per-attack filtering, and the clamping all happen in `collectAttackParams`,
 * which owns this output.
 */
function apply(p: AttackStatParams): AttackStatOutput {
  return {
    kind: 'attackStat',
    ...(p.attack !== undefined ? { attack: p.attack } : {}),
    stat: p.stat,
    op: p.op,
    value: p.value,
  }
}

export const attackStat: EffectDef<AttackStatParams> = { schema, apply }
