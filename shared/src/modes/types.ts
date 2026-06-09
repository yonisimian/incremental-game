import type { Modifier } from '../modifiers/types.js'
import type { EffectRef, Goal, GeneratorDefinition, UpgradeDefinition } from '../types.js'

// ─── Flavor Types ────────────────────────────────────────────────────

/** Display metadata for a single resource. */
export interface ResourceFlavor {
  /** Abstract resource key (e.g. 'r0', 'r1'). Matches keys in resources[]. */
  readonly key: string
  /** Human-readable name shown in UI (e.g. 'Wood', 'Gold'). */
  readonly displayName: string
  /** Emoji icon (e.g. '🪵', '💰'). */
  readonly icon: string
  /** Optional CSS class applied to the resource item (e.g., 'gold'). */
  readonly className?: string
}

/** Display metadata for a single upgrade. */
export interface UpgradeFlavor {
  /** Upgrade id (matches UpgradeDefinition.id). */
  readonly id: string
  /** Display name (e.g. '🪓 Sharpened Axes'). */
  readonly name: string
  /** Single-glyph icon shown on the upgrade-tree node (e.g. '🪓'). */
  readonly icon: string
  /** Display description (e.g. 'Highlight boost → 4×'). */
  readonly description: string
}

/** Display metadata for a single generator. */
export interface GeneratorFlavor {
  /** Generator id (matches GeneratorDefinition.id). */
  readonly id: string
  /** Display name (e.g. 'Woodcutter'). */
  readonly name: string
  /** Display icon (e.g. '🪓'). */
  readonly icon: string
}

/** Cosmetic skin for a mode — all display strings, icons, labels. */
export interface ModeFlavor {
  /** Human-readable mode name shown in UI (e.g. 'Clicker', 'Idler'). */
  readonly displayName: string
  /** CSS class applied to the playing-screen root (e.g. 'theme-medieval'). */
  readonly themeClass: string
  /** Label for the score in scoreboards/end screens (e.g. 'Score', 'Total'). */
  readonly scoreLabel: string
  /** Resource display metadata, ordered for the header bar. */
  readonly resources: readonly ResourceFlavor[]
  /** Whether to show click-based stats (Clicks, Peak CPS) on the end screen. */
  readonly showClickStats: boolean
  /** Upgrade display data, looked up by id via helpers. */
  readonly upgrades: readonly UpgradeFlavor[]
  /** Generator display data, looked up by id via helpers. */
  readonly generators: readonly GeneratorFlavor[]
}

// ─── Mode Definition ─────────────────────────────────────────────────

/** Full definition of a game mode — replaces ModeConfig. */
export interface ModeDefinition {
  /** Resource keys this mode uses (e.g., ['r0'] or ['r0', 'r1']). */
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
  /** Whether the mode supports highlight cycling (Tab key, set_highlight action). */
  readonly highlightEnabled: boolean
  /** If set, highlighting requires this upgrade to be purchased before it becomes active. */
  readonly highlightUnlockUpgrade?: string
  /** Starting resource balances for a new round. */
  readonly initialResources: Readonly<Record<string, number>>
  /** Starting mode-specific metadata (e.g., idler highlight). */
  readonly initialMeta: Readonly<Record<string, unknown>>
  /** Generator buildings available in this mode (may be empty). */
  readonly generators: readonly GeneratorDefinition[]
  /**
   * Declarative, state-derived effects applied to every player in this mode.
   * Each ref names a registered effect plus its params (see `shared/src/effects`).
   * Replaces the old `collectDynamic` closure with pure, serializable data.
   */
  readonly effects?: readonly EffectRef[]
  /** Cosmetic display data — names, icons, labels, theme class. */
  readonly flavor: ModeFlavor
}
