// @game/shared — tree (de)serialization barrel.
// The single validated boundary between on-disk tree data and the engine.

export { CURRENT_TREE_VERSION, TreeFileSchema } from './schema.js'
export type { TreeFile, TreeUpgradeNode } from './schema.js'
export { parseTree, parseTreeFile, serializeTree, toModeDefinition } from './codec.js'
