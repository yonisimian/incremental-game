import { registerEffect } from './registry.js'
import { balancedGenerators } from './seed/balanced-generators.js'
import { dominantGenerator } from './seed/dominant-generator.js'
import { generatorCost } from './seed/generator-cost.js'
import { generatorUnlock } from './seed/generator-unlock.js'
import { highlightMultiplier } from './seed/highlight-multiplier.js'
import { lowerTierBoost } from './seed/lower-tier-boost.js'
import { panelUnlock } from './seed/panel-unlock.js'
import { systemUnlock } from './seed/system-unlock.js'

// Register seed effects exactly once, at module load.
registerEffect('highlightMultiplier', highlightMultiplier)
registerEffect('lowerTierBoost', lowerTierBoost)
registerEffect('dominantGenerator', dominantGenerator)
registerEffect('balancedGenerators', balancedGenerators)
registerEffect('generatorCost', generatorCost)
registerEffect('panelUnlock', panelUnlock)
registerEffect('generatorUnlock', generatorUnlock)
registerEffect('systemUnlock', systemUnlock)

export type { EffectDef } from './types.js'
export type {
  EffectOutput,
  GeneratorCostOutput,
  PanelUnlockOutput,
  GeneratorUnlockOutput,
  SystemUnlockOutput,
} from './types.js'
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
export type { GeneratorUnlockParams } from './seed/generator-unlock.js'
export type { SystemUnlockParams } from './seed/system-unlock.js'
