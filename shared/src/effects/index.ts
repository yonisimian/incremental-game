import { registerEffect } from './registry.js'
import { accessEnemyData } from './seed/access-enemy-data.js'
import { balancedGenerators } from './seed/balanced-generators.js'
import { baseModifier } from './seed/base-modifier.js'
import { dominantGenerator } from './seed/dominant-generator.js'
import { generatorCost } from './seed/generator-cost.js'
import { generatorUnlock } from './seed/generator-unlock.js'
import { highlightMultiplier } from './seed/highlight-multiplier.js'
import { lowerTierBoost } from './seed/lower-tier-boost.js'
import { panelUnlock } from './seed/panel-unlock.js'
import { relativeModifier } from './seed/relative-modifier.js'
import { systemUnlock } from './seed/system-unlock.js'
import { unlockAttack } from './seed/unlock-attack.js'

// Register seed effects exactly once, at module load.
registerEffect('baseModifier', baseModifier)
registerEffect('highlightMultiplier', highlightMultiplier)
registerEffect('lowerTierBoost', lowerTierBoost)
registerEffect('dominantGenerator', dominantGenerator)
registerEffect('balancedGenerators', balancedGenerators)
registerEffect('generatorCost', generatorCost)
registerEffect('panelUnlock', panelUnlock)
registerEffect('generatorUnlock', generatorUnlock)
registerEffect('systemUnlock', systemUnlock)
registerEffect('accessEnemyData', accessEnemyData)
registerEffect('relativeModifier', relativeModifier)
registerEffect('unlockAttack', unlockAttack)

export type { EffectDef } from './types.js'
export type {
  EffectOutput,
  BaseModifierOutput,
  GeneratorCostOutput,
  PanelUnlockOutput,
  GeneratorUnlockOutput,
  SystemUnlockOutput,
  AttackUnlockOutput,
  EnemyDataAccessOutput,
} from './types.js'
export {
  applyEffect,
  prepareEffect,
  registerEffect,
  resolveEffect,
  listEffectTypes,
  normalizeEffectOutputs,
} from './registry.js'
export type { BaseModifierParams } from './seed/base-modifier.js'
export type { HighlightMultiplierParams } from './seed/highlight-multiplier.js'
export type { LowerTierBoostParams } from './seed/lower-tier-boost.js'
export type { DominantGeneratorParams } from './seed/dominant-generator.js'
export type { BalancedGeneratorsParams } from './seed/balanced-generators.js'
export type { GeneratorCostParams } from './seed/generator-cost.js'
export type { PanelUnlockParams } from './seed/panel-unlock.js'
export type { GeneratorUnlockParams } from './seed/generator-unlock.js'
export type { SystemUnlockParams } from './seed/system-unlock.js'
export type { AccessEnemyDataParams } from './seed/access-enemy-data.js'
export {
  ENEMY_DATA_RATE_SUFFIX,
  ENEMY_DATA_CPS_KEY,
  enemyDataKeysFor,
  enemyDataResourceKey,
} from './seed/access-enemy-data.js'
export type { RelativeModifierParams } from './seed/relative-modifier.js'
export type { UnlockAttackParams } from './seed/unlock-attack.js'
export type { AddressableField, AddressableFields } from './addressable.js'
export {
  addressableSources,
  addressableSourcesFor,
  addressableTargets,
  addressableTargetsFor,
  listAddressableFields,
  readSourceValue,
} from './addressable.js'
