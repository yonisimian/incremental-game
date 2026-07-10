// @game/shared — queue-strategy simulation barrel.

export {
  QueueStrategySchema,
  parseStrategy,
  serializeStrategy,
  validateStrategyForMode,
} from './strategy.js'
export type {
  QueueStrategy,
  SimAction,
  WaitCondition,
  BuyAction,
  BuyGeneratorAction,
  SetHighlightAction,
  SetClickRateAction,
  WaitAction,
} from './strategy.js'
export { applySimAction } from './apply.js'
export type { GameAction, SimApplyResult } from './apply.js'
export { simulate } from './simulate.js'
export type { SimResult, SimEvent, SimulateOptions, TickSnapshot, NotReached } from './simulate.js'
