import type { GameMode } from '@game/shared'
import { getModeDefinition, isPanelUnlocked } from '@game/shared'
import type { PanelSlot } from './panels.js'
import { playPanel } from './panels/play-panel.js'
import { generatorsPanel } from './panels/generators-panel.js'
import { upgradeTreePanel } from './panels/upgrade-tree-panel.js'
import { attackPanel } from './panels/attack-panel.js'
import { internationalRelationshipPanel } from './panels/international-relationship-panel.js'
import { espionagePanel } from './panels/espionage-panel.js'

// ─── Types ───────────────────────────────────────────────────────────

/** Client-side UI configuration for a game mode. */
export interface ModeUI {
  /** Panels available in this mode, with their tab-grid slot indices. */
  readonly panels: readonly PanelSlot[]
}

/** Every panel that can appear in a mode — the source list for the editor's `panelUnlock` picker. */
export const ALL_PANELS = [
  playPanel,
  upgradeTreePanel,
  generatorsPanel,
  attackPanel,
  internationalRelationshipPanel,
  espionagePanel,
] as const

/**
 * Panels that exist only when an upgrade unlocks them, in tab order. Each is
 * surfaced (gated, locked until its `panelUnlock` upgrade is owned) only in
 * modes whose tree actually unlocks it — see `getModeUI`.
 */
const UNLOCKABLE_PANELS = [attackPanel, internationalRelationshipPanel, espionagePanel] as const

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Derive the client-side panel configuration from the mode definition.
 * Adding generators or upgrades to a new mode automatically surfaces the
 * corresponding panel — no hardcoded per-mode map needed.
 */
export function getModeUI(mode: GameMode): ModeUI {
  const modeDef = getModeDefinition(mode)
  const panels: PanelSlot[] = [{ index: 0, panel: playPanel }]

  if (modeDef.upgrades.length > 0) {
    panels.push({ index: panels.length, panel: upgradeTreePanel })
  }

  if (modeDef.generators.length > 0) {
    panels.push({
      index: panels.length,
      panel: generatorsPanel,
      isUnlocked: (state) => isPanelUnlocked(state.player, modeDef, generatorsPanel.id),
    })
  }

  // Unlockable panels, in declared order — each locked until a `panelUnlock`
  // upgrade reveals it (panels no upgrade gates are always available).
  for (const panel of UNLOCKABLE_PANELS) {
    panels.push({
      index: panels.length,
      panel,
      isUnlocked: (state) => isPanelUnlocked(state.player, modeDef, panel.id),
    })
  }

  return { panels }
}
