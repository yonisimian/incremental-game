// @game/shared — barrel export
// Types and constants shared between client and server

export * from './types.js'
export * from './messages.js'
export * from './game-config.js'
export * from './generators.js'
export * from './flavor.js'
export * from './modifiers/index.js'
export * from './modes/index.js'
export * from './effects/index.js'
export * from './prerequisites.js'
export * from './upgrade-groups.js'
export * from './upgrade-costs.js'
export * from './balance/index.js'
export type {
  ModeDefinition,
  ModeFlavor,
  ResourceFlavor,
  UpgradeFlavor,
  GeneratorFlavor,
} from './modes/types.js'
