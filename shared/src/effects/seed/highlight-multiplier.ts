import type { Modifier } from '../../modifiers/types.js'
import type { EffectRef, PlayerState } from '../../types.js'
import type { EffectDef } from '../types.js'

/** Params for the `highlightMultiplier` effect. */
export interface HighlightMultiplierParams {
  /** Upgrade that must be owned before the highlight boost applies. */
  readonly unlockUpgradeId: string
  /** Multiplier applied to the currently highlighted resource. */
  readonly multiplier: number
  /**
   * Optional upgrade that, when owned, raises the multiplier to `boostedMultiplier`.
   * `boostUpgradeId` and `boostedMultiplier` are present together or not at all.
   */
  readonly boostUpgradeId?: string
  readonly boostedMultiplier?: number
}

function parse(raw: EffectRef): HighlightMultiplierParams {
  const { unlockUpgradeId, multiplier, boostUpgradeId, boostedMultiplier } = raw
  if (typeof unlockUpgradeId !== 'string' || unlockUpgradeId.length === 0) {
    throw new Error('highlightMultiplier: `unlockUpgradeId` must be a non-empty string')
  }
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
    return { unlockUpgradeId, multiplier, boostUpgradeId, boostedMultiplier }
  }
  return { unlockUpgradeId, multiplier }
}

function apply(p: HighlightMultiplierParams, state: Readonly<PlayerState>): Modifier | null {
  if ((state.upgrades[p.unlockUpgradeId] ?? 0) === 0) return null
  // `?? 'r0'` mirrors the prior idler default when no resource is highlighted.
  const highlight = (state.meta.highlight as string | undefined) ?? 'r0'
  const boosted = p.boostUpgradeId !== undefined && (state.upgrades[p.boostUpgradeId] ?? 0) > 0
  const value = boosted ? p.boostedMultiplier! : p.multiplier
  return { stage: 'multiplicative', field: highlight, value }
}

export const highlightMultiplier: EffectDef<HighlightMultiplierParams> = { parse, apply }
