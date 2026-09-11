export type {
  Modifier,
  ModifierContext,
  ModifierStage,
  LayerAccumulator,
  ResourceLayers,
} from './types.js'
export { MODIFIER_STAGES } from './types.js'
export { MIN_DEBUFF_FACTOR, scaleCostFactor, scaleDebuffValue } from './value-guard.js'
export {
  computeIncome,
  computeClickIncome,
  computePassiveRates,
  applyPassiveTick,
  creditResource,
} from './pipeline.js'
