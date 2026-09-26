/**
 * Resolved one-line previews of an effect ref, for the editor form.
 *
 * An `attackStat` ref is two abstractions away from the number an author cares
 * about: its `op` shapes a *multiplier* (or, for `offset`, a flat shift), and the
 * result only becomes concrete against the attack's own authored value and the
 * owned count. Printing the outcome at the first couple of levels is what keeps
 * `add: 5` on `prepareTime` from reading as "+5 seconds".
 *
 * Every number here comes from the shared resolvers (`collectAttackParams`,
 * `getAttackPrepareCost`, `getAttackPrepareTimeSec`) run over a synthetic
 * one-upgrade mode — never from a formula restated locally, which would be free
 * to drift from what the game actually does.
 *
 * Pure (no DOM), so it is unit-tested directly.
 */

import {
  ATTACK_STATS,
  collectAttackParams,
  getAttackDurationSec,
  getAttackPrepareCost,
  getAttackPrepareTimeSec,
  NEUTRAL_ATTACK_PARAMS,
} from '@game/shared'
import type {
  AttackDefinition,
  AttackParams,
  AttackStat,
  EffectRef,
  ModeDefinition,
  PlayerState,
  TreeFile,
} from '@game/shared'

/** Owned counts the preview reports, so per-level compounding is visible. */
const PREVIEW_LEVELS = [1, 2]

/** Id of the synthetic upgrade the previewed ref is hung on. */
const PREVIEW_UPGRADE = '__preview'

/** How each stat reads in the preview line. */
const STAT_LABELS: Readonly<Record<AttackStat, string>> = {
  power: 'magnitude',
  prepareCost: 'prepare cost',
  prepareTime: 'prepare time',
  duration: 'debuff duration',
}

/** Trim a resolved number to something readable (2 decimals, no trailing zeros). */
function num(value: number): string {
  return String(Math.round(value * 100) / 100)
}

/** A cost map as `1000 r0 + 250 r1`. */
function formatCost(cost: Readonly<Record<string, number>>): string {
  return (
    Object.entries(cost)
      .map(([currency, amount]) => `${num(amount)} ${currency}`)
      .join(' + ') || 'free'
  )
}

/**
 * The attack params this ref alone produces at `level` copies of its owning
 * upgrade.
 *
 * The mode is a shim: `collectAttackParams` reads only `effects`, `upgrades` and
 * the owned counts, so a full {@link ModeDefinition} (which would mean running
 * the whole tree through `toModeDefinition`, validation included, on every
 * keystroke) is not needed — and a mid-edit tree would fail that validation for
 * reasons that have nothing to do with this ref.
 */
function paramsAt(ref: EffectRef, attackId: string, level: number): AttackParams {
  const mode = {
    upgrades: [{ id: PREVIEW_UPGRADE, cost: {}, purchaseLimit: Infinity, effects: [ref] }],
    attacks: [],
  } as unknown as ModeDefinition
  const state = {
    score: 0,
    resources: {},
    upgrades: { [PREVIEW_UPGRADE]: level },
    generators: {},
    pendingAttacks: [],
    meta: {},
  } as PlayerState
  return collectAttackParams(state, mode, attackId)
}

/** Whether the stat resolves to a concrete figure on this attack, or just a factor. */
function hasAbsolute(stat: AttackStat, def: AttackDefinition): boolean {
  if (stat === 'prepareTime') return def.prepareTimeSec !== undefined
  if (stat === 'duration') return def.durationSec !== undefined
  if (stat === 'prepareCost') return Object.keys(def.prepareCost ?? {}).length > 0
  return false
}

/** One level's outcome: an absolute figure where the attack has one, else a factor. */
function describeLevel(stat: AttackStat, params: AttackParams, def: AttackDefinition): string {
  if (hasAbsolute(stat, def)) {
    if (stat === 'prepareTime') return `${num(getAttackPrepareTimeSec(def, params))}s`
    if (stat === 'duration') return `${num(getAttackDurationSec(def, params))}s`
    return formatCost(getAttackPrepareCost(def, params))
  }
  if (stat === 'power') return `×${num(params.power)}`
  if (stat === 'prepareCost') return `×${num(params.prepareCost)}`
  // A time stat with no authored seconds to resolve against: report the shape of
  // the change, factor and offset alike, since one ref can carry either.
  const [scale, offsetSec] =
    stat === 'duration'
      ? [params.duration, params.durationOffsetSec]
      : [params.prepareTime, params.prepareTimeOffsetSec]
  const factor = scale === 1 ? '' : `×${num(scale)}`
  const offset = offsetSec === 0 ? '' : `${offsetSec > 0 ? '+' : ''}${num(offsetSec)}s`
  return [factor, offset].filter(Boolean).join(' ') || 'no change'
}

/**
 * A resolved preview of `ref`, or `null` when there is nothing to say — a
 * non-`attackStat` ref, an attack the tree doesn't declare (the boot-time
 * validator reports it), or params the effect's own schema rejects (the form's
 * error line already reports those).
 */
export function describeEffectRef(tree: TreeFile, ref: EffectRef): string | null {
  if (ref.type !== 'attackStat') return null
  const rawStat = ref.stat
  const known: readonly string[] = ATTACK_STATS
  if (typeof rawStat !== 'string' || !known.includes(rawStat)) return null
  const stat = rawStat as AttackStat

  const def = tree.attacks.find((a) => a.id === ref.attack)
  if (!def) return null

  try {
    const levels = PREVIEW_LEVELS.map(
      (level) => `${describeLevel(stat, paramsAt(ref, def.id, level), def)} (L${level})`,
    )
    const baseline = hasAbsolute(stat, def)
      ? `${describeLevel(stat, NEUTRAL_ATTACK_PARAMS, def)} → `
      : ''
    return `${def.id} ${STAT_LABELS[stat]}: ${baseline}${levels.join(' · ')}`
  } catch {
    // Invalid params (the schema throws inside `applyEffect`) — the form's own
    // error line is the right place for that, not a half-resolved preview.
    return null
  }
}
