export type {
  Modifier,
  ModifierContext,
  ModifierStage,
  LayerAccumulator,
  ResourceLayers,
} from './types.js'
export {
  ALL_GENERATORS_FIELD,
  ALL_RESOURCES_FIELD,
  INCOMING_CLICK_INCOME_FIELD,
  MODIFIER_STAGES,
} from './types.js'
export {
  MAX_SCALED_STAT_VALUE,
  MIN_DEBUFF_FACTOR,
  guardScaledStatValue,
  scaleCostFactor,
  scaleDebuffValue,
} from './value-guard.js'
export type { ScaledStatOp, StatDirection } from './value-guard.js'
export {
  computeIncome,
  computeClickIncome,
  computePassiveRates,
  applyPassiveTick,
  creditResource,
} from './pipeline.js'
