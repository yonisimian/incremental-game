import { registerEffect } from './registry.js'
import { balancedGenerators } from './seed/balanced-generators.js'
import { dominantGenerator } from './seed/dominant-generator.js'
import { generatorCost } from './seed/generator-cost.js'
import { highlightMultiplier } from './seed/highlight-multiplier.js'
import { lowerTierBoost } from './seed/lower-tier-boost.js'
import { panelUnlock } from './seed/panel-unlock.js'
import { peakCpsClickBonus } from './seed/peak-cps-click-bonus.js'

// Register seed effects exactly once, at module load.
registerEffect('highlightMultiplier', highlightMultiplier)
registerEffect('lowerTierBoost', lowerTierBoost)
registerEffect('dominantGenerator', dominantGenerator)
registerEffect('balancedGenerators', balancedGenerators)
registerEffect('generatorCost', generatorCost)
registerEffect('panelUnlock', panelUnlock)
registerEffect('peakCpsClickBonus', peakCpsClickBonus)

export type { EffectDef } from './types.js'
export type { EffectOutput, GeneratorCostOutput, PanelUnlockOutput } from './types.js'
export {
  applyEffect,
  prepareEffect,
  registerEffect,
  resolveEffect,
  listEffectTypes,
  normalizeEffectOutputs,
} from './registry.js'
export type { HighlightMultiplierParams } from './seed/highlight-multiplier.js'
export type { LowerTierBoostParams } from './seed/lower-tier-boost.js'
export type { DominantGeneratorParams } from './seed/dominant-generator.js'
export type { BalancedGeneratorsParams } from './seed/balanced-generators.js'
export type { GeneratorCostParams } from './seed/generator-cost.js'
export type { PanelUnlockParams } from './seed/panel-unlock.js'
export type { PeakCpsClickBonusParams } from './seed/peak-cps-click-bonus.js'
