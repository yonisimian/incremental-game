import type { Modifier } from '../modifiers/types.js'
import type { GameMode, Goal, PlayerState } from '../types.js'
import type { ModeDefinition } from './types.js'
import { clickerMode } from './clicker.js'
import { idlerMode, collectIdlerDynamic } from './idler.js'

// ─── Registry ────────────────────────────────────────────────────────

const MODE_REGISTRY: Record<GameMode, ModeDefinition> = {
  clicker: clickerMode,
  idler: idlerMode,
}

/** Look up the mode definition for a GameMode. */
export function getModeDefinition(mode: GameMode): ModeDefinition {
  return MODE_REGISTRY[mode]
}

/** Get the default goal for a mode (first in the goals array). */
export function getDefaultGoal(mode: GameMode): Goal {
  return MODE_REGISTRY[mode].goals[0]
}

// ─── Initial State ───────────────────────────────────────────────────

/** Initial player state at the start of each round. */
export const INITIAL_PLAYER_STATE = {
  score: 0,
  currency: 0,
  upgrades: {
    'auto-clicker': false,
    'double-click': false,
    multiplier: false,
    'sharpened-axes': false,
    'lumber-mill': false,
    'tavern-recruits': 0,
  },
} as const satisfies PlayerState

// ─── Modifier Collection ─────────────────────────────────────────────

/**
 * Collect all active modifiers for a player: native + owned upgrades + state-derived.
 * This is the bridge between game domain types and the pure pipeline.
 */
export function collectModifiers(state: Readonly<PlayerState>, mode: ModeDefinition): Modifier[] {
  const modifiers: Modifier[] = []

  // Native modifiers (base income rates for this mode)
  modifiers.push(...mode.nativeModifiers)

  // Upgrade modifiers
  for (const upgrade of mode.upgrades) {
    const owned = state.upgrades[upgrade.id]
    if (!owned) continue

    if (upgrade.repeatable) {
      // Repeatable: scale modifier values by the owned count
      const count = Number(owned) || 0
      if (count <= 0) continue
      for (const mod of upgrade.modifiers) {
        modifiers.push({ stage: mod.stage, field: mod.field, value: mod.value * count })
      }
    } else {
      // Boolean upgrade: emit modifiers as-is
      modifiers.push(...upgrade.modifiers)
    }
  }

  // Dynamic (state-derived) modifiers — mode-specific
  if (mode === idlerMode) {
    modifiers.push(...collectIdlerDynamic(state))
  }

  return modifiers
}

// ─── Backward-Compat Re-exports ──────────────────────────────────────

/** Clicker upgrade definitions (convenience alias for tests / existing code). */
export const CLICKER_UPGRADES = clickerMode.upgrades

/** Idler upgrade definitions (convenience alias for tests / existing code). */
export const IDLER_UPGRADES = idlerMode.upgrades
