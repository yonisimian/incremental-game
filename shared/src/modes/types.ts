import type { Modifier } from '../modifiers/types.js'
import type { Goal, UpgradeDefinition } from '../types.js'

/** Full definition of a game mode — replaces ModeConfig. */
export interface ModeDefinition {
  /** Resource keys this mode uses (e.g., ['currency'] or ['wood', 'ale']). */
  readonly resources: readonly string[]
  /** Which resource counts toward the score. */
  readonly scoreResource: string
  /** Upgrade definitions for this mode (with modifier data). */
  readonly upgrades: readonly UpgradeDefinition[]
  /** Available win conditions for this mode. */
  readonly goals: readonly Goal[]
  /** Base modifiers applied to every player in this mode (e.g., base income rates). */
  readonly nativeModifiers: readonly Modifier[]
  /** Whether manual clicks are allowed. */
  readonly clicksEnabled: boolean
}
