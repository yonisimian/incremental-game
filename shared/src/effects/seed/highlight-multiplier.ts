import type { Modifier } from '../../modifiers/types.js'
import type { EffectRef, PlayerState } from '../../types.js'
import type { EffectDef } from '../types.js'

/** Params for the `highlightMultiplier` effect. */
export interface HighlightMultiplierParams {
  /** Upgrade that must be owned before the boost applies. */
  readonly unlockUpgradeId: string
  /** Multiplier applied to the currently highlighted resource. */
  readonly multiplier: number
}

function parse(raw: EffectRef): HighlightMultiplierParams {
  const { unlockUpgradeId, multiplier } = raw
  if (typeof unlockUpgradeId !== 'string' || unlockUpgradeId.length === 0) {
    throw new Error('highlightMultiplier: `unlockUpgradeId` must be a non-empty string')
  }
  if (typeof multiplier !== 'number' || !Number.isFinite(multiplier)) {
    throw new Error('highlightMultiplier: `multiplier` must be a finite number')
  }
  return { unlockUpgradeId, multiplier }
}

function apply(p: HighlightMultiplierParams, state: Readonly<PlayerState>): Modifier | null {
  if ((state.upgrades[p.unlockUpgradeId] ?? 0) === 0) return null
  // `?? 'r0'` mirrors the prior idler default when no resource is highlighted.
  const highlight = (state.meta.highlight as string | undefined) ?? 'r0'
  return { stage: 'multiplicative', field: highlight, value: p.multiplier }
}

export const highlightMultiplier: EffectDef<HighlightMultiplierParams> = { parse, apply }
