/**
 * The highlight battery: parameters and their collection.
 *
 * The battery charges while the highlight is released and drains while a
 * resource is held; while it holds charge it multiplies the highlight's own
 * factor (see plan 30). Unlike every other bonus in the game it is *stateful* —
 * a level that integrates over time — so it splits into three pieces:
 *
 *  1. **Parameters** (this module): capacity, rates, and peak factor, collected
 *     from owned upgrades' `batteryStat` effects on top of {@link
 *     BATTERY_DEFAULTS}.
 *  2. **The integrator** (later): advances the stored charge each tick.
 *  3. **The factor** (later): turns the current charge into a multiplier.
 *
 * Only (1) exists so far; nothing reads these parameters yet.
 */

import { applyEffect, normalizeEffectOutputs } from './effects/index.js'
import type { BatteryStatOutput, EffectOutput } from './effects/index.js'
import { BATTERY_STATS } from './effects/seed/battery-stat.js'
import type { BatteryStat } from './effects/seed/battery-stat.js'
import type { ModeDefinition } from './modes/types.js'
import type { EffectRef, PlayerState } from './types.js'

// Re-exported from the `batteryStat` seed (its schema owns the canonical stat
// list, so the enum and the load-time validation can't drift) — mirroring how
// `unlock-gates` re-exports `UNLOCKABLE_SYSTEMS`. This module is the sole
// re-exporter, so the shared barrel has exactly one path to it.
export { BATTERY_STATS } from './effects/seed/battery-stat.js'
export type { BatteryStat } from './effects/seed/battery-stat.js'

/**
 * The battery's fully-resolved parameters for one player.
 *
 * Capacity is in **charge units**, where one unit is one second of drain at
 * `drainRate: 1`. Capacity and drain are deliberately independent: capacity buys
 * duration, drain buys efficiency. (Were drain derived from capacity, the two
 * upgrades that raise them would be the same upgrade.)
 */
export interface BatteryParams {
  /** Peak multiplier applied on top of the highlight factor, at full charge. */
  readonly factor: number
  /** Capacity, in charge units. */
  readonly maxCharge: number
  /** Units gained per second while the highlight is released. */
  readonly chargeRate: number
  /** Units lost per second while a resource is highlighted. */
  readonly drainRate: number
}

/**
 * The battery a bare `systemUnlock` grants, before any `batteryStat` upgrade.
 *
 * Kept in code rather than authored on the unlocking upgrade so that node stays
 * a single unlock ref, and so "does the battery exist" is a separate question
 * from "how strong is it". Moving these onto authored `batteryStat` refs later is
 * additive — no consumer changes — if tuning wants them visible in the editor.
 */
export const BATTERY_DEFAULTS: BatteryParams = {
  factor: 1.5,
  maxCharge: 20,
  chargeRate: 1,
  drainRate: 1,
}

/**
 * Floors each stat is clamped to after collection. A mis-authored `mult` below
 * zero (or a large enough negative `add`) would otherwise invert the mechanic —
 * a negative `drainRate` charges while you hold the highlight, a `factor` under
 * `1` turns the reward into a penalty. Clamping keeps a bad ref merely useless.
 */
const FLOORS: Record<BatteryStat, number> = {
  factor: 1,
  // Not 0: a zero capacity would divide by zero when deriving the charge ratio.
  maxCharge: Number.EPSILON,
  chargeRate: 0,
  drainRate: 0,
}

/** Whether an effect output is a battery-stat adjustment. */
function isBatteryStatOutput(out: EffectOutput): out is BatteryStatOutput {
  return 'kind' in out && out.kind === 'batteryStat'
}

/**
 * Collect every owned upgrade's `batteryStat` effects into resolved parameters.
 *
 * Each output compounds with the owning upgrade's owned count the same way the
 * production pipeline does — `add` scales linearly (`× owned`), `mult` compounds
 * (`** owned`) — and **all adds are applied before any mult**, per stat, so the
 * result doesn't depend on the order the tree happens to be authored in.
 *
 * Mode-level refs are collected too (with `owned = 1`), so a mode can shift the
 * defaults without an upgrade.
 */
export function collectBatteryParams(
  state: Readonly<PlayerState>,
  mode: ModeDefinition,
): BatteryParams {
  // Keyed off BATTERY_STATS so adding a stat means adding a default and a floor,
  // not remembering to seed three more tables.
  const adds = {} as Record<BatteryStat, number>
  const mults = {} as Record<BatteryStat, number>
  for (const stat of BATTERY_STATS) {
    adds[stat] = 0
    mults[stat] = 1
  }

  const accumulate = (out: BatteryStatOutput, owned: number): void => {
    if (out.op === 'add') adds[out.stat] += out.value * owned
    else mults[out.stat] *= out.value ** owned
  }

  const collect = (refs: readonly EffectRef[] | undefined, owned: number): void => {
    for (const ref of refs ?? []) {
      // Skip non-battery effects without running them, matching
      // `collectGeneratorCostFactors`.
      if (ref.type !== 'batteryStat') continue
      for (const o of normalizeEffectOutputs(applyEffect(ref, state, mode))) {
        if (isBatteryStatOutput(o)) accumulate(o, owned)
      }
    }
  }

  collect(mode.effects, 1)
  for (const upgrade of mode.upgrades) {
    const owned = state.upgrades[upgrade.id] ?? 0
    if (owned > 0) collect(upgrade.effects, owned)
  }

  const resolved = {} as Record<BatteryStat, number>
  for (const stat of BATTERY_STATS) {
    resolved[stat] = Math.max(FLOORS[stat], (BATTERY_DEFAULTS[stat] + adds[stat]) * mults[stat])
  }
  return resolved
}
