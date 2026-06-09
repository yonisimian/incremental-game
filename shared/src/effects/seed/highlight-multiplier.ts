import type { Modifier } from '../../modifiers/types.js'
import type { EffectRef, PlayerState } from '../../types.js'
import type { EffectDef } from '../types.js'

/**
 * Params for the `highlightMultiplier` effect.
 *
 * Either a flat `multiplier`, or a `multiplier` plus a boost tier: owning
 * `boostUpgradeId` raises the value to `boostedMultiplier`. The two boost fields
 * are a discriminated pair — present together or not at all, so `apply` never
 * has to assert their presence.
 *
 * The effect does not gate itself: as a per-upgrade effect it runs only when its
 * host upgrade is owned; as a mode-level effect it always runs.
 */
export type HighlightMultiplierParams =
  | { readonly multiplier: number }
  | {
      readonly multiplier: number
      readonly boostUpgradeId: string
      readonly boostedMultiplier: number
    }

function parse(raw: EffectRef): HighlightMultiplierParams {
  const { multiplier, boostUpgradeId, boostedMultiplier } = raw
  if (typeof multiplier !== 'number' || !Number.isFinite(multiplier)) {
    throw new Error('highlightMultiplier: `multiplier` must be a finite number')
  }
  const hasBoostId = boostUpgradeId !== undefined
  const hasBoostValue = boostedMultiplier !== undefined
  if (hasBoostId !== hasBoostValue) {
    throw new Error(
      'highlightMultiplier: `boostUpgradeId` and `boostedMultiplier` must be set together',
    )
  }
  if (hasBoostId) {
    if (typeof boostUpgradeId !== 'string' || boostUpgradeId.length === 0) {
      throw new Error('highlightMultiplier: `boostUpgradeId` must be a non-empty string')
    }
    if (typeof boostedMultiplier !== 'number' || !Number.isFinite(boostedMultiplier)) {
      throw new Error('highlightMultiplier: `boostedMultiplier` must be a finite number')
    }
    return { multiplier, boostUpgradeId, boostedMultiplier }
  }
  return { multiplier }
}

function apply(p: HighlightMultiplierParams, state: Readonly<PlayerState>): Modifier | null {
  // `?? 'r0'` mirrors the prior idler default when no resource is highlighted.
  const highlight = (state.meta.highlight as string | undefined) ?? 'r0'
  const value =
    'boostUpgradeId' in p && (state.upgrades[p.boostUpgradeId] ?? 0) > 0
      ? p.boostedMultiplier
      : p.multiplier
  return { stage: 'multiplicative', field: highlight, value }
}

export const highlightMultiplier: EffectDef<HighlightMultiplierParams> = { parse, apply }
