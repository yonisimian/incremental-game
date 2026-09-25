export type {
  Modifier,
  ModifierContext,
  ModifierStage,
  LayerAccumulator,
  ResourceLayers,
} from './types.js'
export { INCOMING_CLICK_INCOME_FIELD, MODIFIER_STAGES } from './types.js'
export {
  computeIncome,
  computeClickIncome,
  computePassiveRates,
  applyPassiveTick,
  creditResource,
} from './pipeline.js'
