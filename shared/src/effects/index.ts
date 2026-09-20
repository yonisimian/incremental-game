import { registerEffect } from './registry.js'
import { accessEnemyData } from './seed/access-enemy-data.js'
import { attackAlert } from './seed/attack-alert.js'
import { attackSlots } from './seed/attack-slots.js'
import { attackStat } from './seed/attack-stat.js'
import { balancedGenerators } from './seed/balanced-generators.js'
import { batteryBand } from './seed/battery-band.js'
import { batteryStat } from './seed/battery-stat.js'
import { baseModifier } from './seed/base-modifier.js'
import { dominantGenerator } from './seed/dominant-generator.js'
import { enemyCostModifier } from './seed/enemy-cost-modifier.js'
import { enemyProductionModifier } from './seed/enemy-production-modifier.js'
import { enemyPurchaseLock } from './seed/enemy-purchase-lock.js'
import { generatorCost } from './seed/generator-cost.js'
import { generatorUnlock } from './seed/generator-unlock.js'
import { highlightMultiplier } from './seed/highlight-multiplier.js'
import { lowerTierBoost } from './seed/lower-tier-boost.js'
import { mirrorCostModifier } from './seed/mirror-cost-modifier.js'
import { mirrorStatModifier } from './seed/mirror-stat-modifier.js'
import { panelUnlock } from './seed/panel-unlock.js'
import { relativeModifier } from './seed/relative-modifier.js'
import { stealGenerator } from './seed/steal-generator.js'
import { stealResource } from './seed/steal-resource.js'
import { systemUnlock } from './seed/system-unlock.js'
import { timeFactorBoost } from './seed/time-factor-boost.js'
import { timeRetroactive } from './seed/time-retroactive.js'
import { timeScaledModifier } from './seed/time-scaled-modifier.js'
import { unlockAttack } from './seed/unlock-attack.js'
import { unlockPact } from './seed/unlock-pact.js'

// Register seed effects exactly once, at module load.
registerEffect('baseModifier', baseModifier)
registerEffect('highlightMultiplier', highlightMultiplier)
registerEffect('lowerTierBoost', lowerTierBoost)
registerEffect('dominantGenerator', dominantGenerator)
registerEffect('balancedGenerators', balancedGenerators)
registerEffect('generatorCost', generatorCost)
registerEffect('batteryStat', batteryStat)
registerEffect('batteryBand', batteryBand)
registerEffect('panelUnlock', panelUnlock)
registerEffect('generatorUnlock', generatorUnlock)
registerEffect('systemUnlock', systemUnlock)
registerEffect('accessEnemyData', accessEnemyData)
registerEffect('relativeModifier', relativeModifier)
registerEffect('unlockAttack', unlockAttack)
registerEffect('attackStat', attackStat)
registerEffect('attackSlots', attackSlots)
registerEffect('attackAlert', attackAlert)
registerEffect('unlockPact', unlockPact)
registerEffect('enemyProductionModifier', enemyProductionModifier)
registerEffect('enemyCostModifier', enemyCostModifier)
registerEffect('enemyPurchaseLock', enemyPurchaseLock)
registerEffect('mirrorCostModifier', mirrorCostModifier)
registerEffect('mirrorStatModifier', mirrorStatModifier)
registerEffect('stealResource', stealResource)
registerEffect('stealGenerator', stealGenerator)
registerEffect('timeScaledModifier', timeScaledModifier)
registerEffect('timeFactorBoost', timeFactorBoost)
registerEffect('timeRetroactive', timeRetroactive)

export type { EffectDef, EffectHost } from './types.js'
export type {
  EffectOutput,
  BaseModifierOutput,
  BatteryStatOutput,
  BatteryBandOutput,
  GeneratorCostOutput,
  PanelUnlockOutput,
  GeneratorUnlockOutput,
  SystemUnlockOutput,
  AttackUnlockOutput,
  AttackStatOutput,
  AttackSlotsOutput,
  AttackAlertOutput,
  PactUnlockOutput,
  EnemyDataAccessOutput,
  EnemyModifierOutput,
  EnemyCostOutput,
  EnemyPurchaseLockOutput,
  MirrorCostOutput,
  MirrorModifierOutput,
  ResourceStealOutput,
  GeneratorStealOutput,
  TimeFactorBoostOutput,
  TimeRetroactiveOutput,
} from './types.js'
export {
  applyEffect,
  prepareEffect,
  registerEffect,
  resolveEffect,
  listEffectTypes,
  normalizeEffectOutputs,
  DEFAULT_EFFECT_HOSTS,
  effectHosts,
  isDynamicEffect,
  isEffectAllowedOn,
} from './registry.js'
export type { BaseModifierParams } from './seed/base-modifier.js'
export type { HighlightMultiplierParams } from './seed/highlight-multiplier.js'
export type { LowerTierBoostParams } from './seed/lower-tier-boost.js'
export type { DominantGeneratorParams } from './seed/dominant-generator.js'
export type { BalancedGeneratorsParams } from './seed/balanced-generators.js'
export type { GeneratorCostParams } from './seed/generator-cost.js'
// Only the params type here; `highlight-battery` is the sole re-exporter of the
// stat/op enums (mirroring `unlock-gates` for `UNLOCKABLE_SYSTEMS`), so the
// shared barrel has exactly one path to each.
export type { BatteryStatParams } from './seed/battery-stat.js'
export type { BatteryBandParams } from './seed/battery-band.js'
export type { PanelUnlockParams } from './seed/panel-unlock.js'
export type { GeneratorUnlockParams } from './seed/generator-unlock.js'
export type { SystemUnlockParams } from './seed/system-unlock.js'
export type { TimeScaledModifierParams } from './seed/time-scaled-modifier.js'
export type { TimeFactorBoostParams } from './seed/time-factor-boost.js'
export type { TimeRetroactiveParams } from './seed/time-retroactive.js'
export type { AccessEnemyDataParams } from './seed/access-enemy-data.js'
export {
  ENEMY_DATA_RATE_SUFFIX,
  ENEMY_DATA_CPS_KEY,
  ENEMY_DATA_PURCHASES_KEY,
  ENEMY_DATA_PURCHASE_KIND_KEY,
  ENEMY_DATA_PURCHASE_UPGRADE_KEY,
  ENEMY_DATA_PURCHASE_GENERATOR_KEY,
  NON_RESOURCE_INTEL_KEYS,
  enemyDataKeysFor,
  enemyDataResourceKey,
} from './seed/access-enemy-data.js'
export type { RelativeModifierParams } from './seed/relative-modifier.js'
export type { UnlockAttackParams } from './seed/unlock-attack.js'
// Params type only; `attacks.ts` is the sole re-exporter of the stat/op enums
// (mirroring `highlight-battery` for the battery's), so the shared barrel has
// exactly one path to each.
export type { AttackStatParams } from './seed/attack-stat.js'
export type { AttackSlotsParams } from './seed/attack-slots.js'
export type { AttackAlertParams } from './seed/attack-alert.js'
export type { UnlockPactParams } from './seed/unlock-pact.js'
export type { EnemyProductionModifierParams } from './seed/enemy-production-modifier.js'
export type { EnemyCostModifierParams } from './seed/enemy-cost-modifier.js'
export type { EnemyPurchaseLockParams } from './seed/enemy-purchase-lock.js'
export { purchaseLockScopesFor } from './seed/enemy-purchase-lock.js'
export type { MirrorCostModifierParams } from './seed/mirror-cost-modifier.js'
export type { MirrorStatModifierParams } from './seed/mirror-stat-modifier.js'
export type { StealResourceParams } from './seed/steal-resource.js'
export type { StealGeneratorParams } from './seed/steal-generator.js'
export type { AddressableField, AddressableFields } from './addressable.js'
export {
  addressableSources,
  addressableSourcesFor,
  addressableTargets,
  addressableTargetsFor,
  ALL_GENERATORS_TARGET,
  ALL_UPGRADES_TARGET,
  enemyCostTargets,
  enemyCostTargetsFor,
  enemyDebuffTargets,
  enemyDebuffTargetsFor,
  HIGHLIGHT_FACTOR_TARGET,
  listAddressableFields,
  parseEnemyCostTarget,
  readSourceValue,
  RESERVED_TARGET_KEYS,
} from './addressable.js'
export type { PartnerSnapshot } from './enemy-stats.js'
export {
  ENEMY_STAT_SCORE_KEY,
  enemyStatKeys,
  enemyStatKeysFor,
  readEnemyStat,
} from './enemy-stats.js'
