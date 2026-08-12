/**
 * The highlight battery: parameters and their collection.
 *
 * The battery charges while the highlight is released and drains while a
 * resource is held; while it holds charge it multiplies the highlight's own
 * factor (see plan 30). Unlike every other bonus in the game it is *stateful* —
 * a level that integrates over time — so it splits into three pieces:
 *
 *  1. **Parameters**: capacity, rates, and peak factor, collected from owned
 *     upgrades' `batteryStat` effects on top of {@link BATTERY_DEFAULTS}.
 *  2. **The integrator** ({@link advanceHighlightBattery}): advances the stored
 *     charge each tick.
 *  3. **The factor** (later): turns the current charge into a multiplier.
 *
 * (1) and (2) exist; nothing reads the charge yet, so the battery is still
 * inert — it fills and empties without paying out.
 */

import { applyEffect, normalizeEffectOutputs } from './effects/index.js'
import type { BatteryStatOutput, EffectOutput } from './effects/index.js'
import { BATTERY_STATS } from './effects/seed/battery-stat.js'
import type { BatteryStat } from './effects/seed/battery-stat.js'
import { readHighlight } from './highlight.js'
import { isHighlightBatteryActive } from './modes/index.js'
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

// ─── Charge state ────────────────────────────────────────────────────

/**
 * `meta` key holding the battery's stored charge, in the same units as
 * {@link BatteryParams.maxCharge}.
 *
 * Absent until the battery unlocks, which is what lets {@link
 * advanceHighlightBattery} tell "never had a battery" from "ran it down to 0" and
 * seed the opening charge only once. Lives in `meta` (like `gameSec` and
 * `peakCps`), so it rides the existing state broadcast with no wire change.
 */
export const BATTERY_CHARGE_KEY = 'hlCharge'

/**
 * The battery's stored charge, or `null` when it has none yet (locked, or
 * unlocked but not yet seeded). A non-finite stored value reads as `null` so a
 * corrupt snapshot re-seeds rather than poisoning every later tick.
 */
export function readBatteryCharge(state: Readonly<PlayerState>): number | null {
  const raw = state.meta[BATTERY_CHARGE_KEY]
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null
}

/**
 * Advance the battery's stored charge by one tick of `tickSec` seconds.
 *
 * Charges while the highlight is released, drains while a resource is held,
 * clamped to `[0, maxCharge]`. A no-op while the battery is locked, so a mode
 * without one never grows the `meta` key.
 *
 * On the tick the battery unlocks, charge is seeded to **half of capacity** —
 * the opening position is a deliberate middle, not a full tank (which would make
 * the first burst free) or an empty one (which would make the unlock feel like a
 * downgrade). Seeding here rather than in `initialMeta` keeps the seed correct
 * when the unlock is bought mid-round, and keeps modes that have no battery from
 * carrying a meaningless initial value.
 *
 * **Call once per tick, before `collectModifiers`.** The factor is derived from
 * the charge, and the tick loops build their modifier list *before* applying
 * income — so advancing afterwards would pay out this tick against last tick's
 * charge, and in particular would grant one extra boosted tick after the battery
 * hit empty.
 */
export function advanceHighlightBattery(
  state: PlayerState,
  mode: ModeDefinition,
  tickSec: number,
): void {
  if (!isHighlightBatteryActive(state, mode)) return

  const { maxCharge, chargeRate, drainRate } = collectBatteryParams(state, mode)
  const stored = readBatteryCharge(state)
  // First tick with a battery: open at half capacity.
  const current = stored ?? maxCharge / 2
  const held = readHighlight(state) !== null
  const delta = (held ? -drainRate : chargeRate) * tickSec

  // Clamping also handles a capacity that *shrank* (a mis-authored `mult` below
  // 1), which would otherwise leave the stored charge stuck above the new cap.
  state.meta[BATTERY_CHARGE_KEY] = Math.min(maxCharge, Math.max(0, current + delta))
}
