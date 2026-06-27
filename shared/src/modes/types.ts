import type { Modifier } from '../modifiers/types.js'
import type {
  AttackDefinition,
  EffectRef,
  Goal,
  GeneratorDefinition,
  UpgradeDefinition,
} from '../types.js'

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

/** Display metadata for a single attack. */
export interface AttackFlavor {
  /** Attack id (matches AttackDefinition.id). */
  readonly id: string
  /** Display name (e.g. 'Raid'). */
  readonly name: string
  /** Display icon (e.g. '⚔️'). */
  readonly icon: string
  /** Display description (shown under the attack in the panel). */
  readonly description: string
}

/**
 * Display metadata for a single non-resource espionage intel key (e.g. peak
 * clicks-per-second). Resource intel reuses {@link ResourceFlavor}; keys that
 * name no resource carry their own label/icon here.
 */
export interface IntelFlavor {
  /** Intel key (e.g. 'peakCps'); matches an `accessEnemyData` non-resource key. */
  readonly key: string
  /** Display name shown in the espionage panel (e.g. 'Max CPS'). */
  readonly displayName: string
  /** Emoji icon (e.g. '🖱️'). */
  readonly icon: string
}

/** Cosmetic skin for a mode — all display strings, icons, labels. */
export interface ModeFlavor {
  /** Stable flavor key, unique within the mode (e.g. 'medieval', 'scifi'). */
  readonly id: string
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
  /** Attack display data, looked up by id via helpers. */
  readonly attacks: readonly AttackFlavor[]
  /** Non-resource espionage intel display data, looked up by key via helpers. */
  readonly intel: readonly IntelFlavor[]
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
  /** Starting resource balances for a new round. */
  readonly initialResources: Readonly<Record<string, number>>
  /** Starting mode-specific metadata (e.g., idler highlight). */
  readonly initialMeta: Readonly<Record<string, unknown>>
  /** Generator buildings available in this mode (may be empty). */
  readonly generators: readonly GeneratorDefinition[]
  /** Attacks available in this mode (may be empty). No behavior yet — unlock-gated. */
  readonly attacks: readonly AttackDefinition[]
  /**
   * Declarative, state-derived effects applied to every player in this mode.
   * Each ref names a registered effect plus its params (see `shared/src/effects`).
   * Replaces the old `collectDynamic` closure with pure, serializable data.
   */
  readonly effects?: readonly EffectRef[]
  /**
   * Cosmetic display data — names, icons, labels, theme class. A mode ships one
   * or more flavors (at least one); all describe the same mechanics (keyed by
   * stable ids), so players can pick different flavors and still compete in the
   * same match. Resolve the active one with `getModeFlavor`.
   */
  readonly flavors: readonly ModeFlavor[]
}
