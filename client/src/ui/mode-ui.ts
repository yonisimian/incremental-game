import type { GameMode } from '@game/shared'
import { getModeDefinition, isPanelUnlocked } from '@game/shared'
import type { PanelSlot } from './panels.js'
import { playPanel } from './panels/play-panel.js'
import { generatorsPanel } from './panels/generators-panel.js'
import { upgradeTreePanel } from './panels/upgrade-tree-panel.js'

// ─── Types ───────────────────────────────────────────────────────────

/** Client-side UI configuration for a game mode. */
export interface ModeUI {
  /** Panels available in this mode, with their tab-grid slot indices. */
  readonly panels: readonly PanelSlot[]
}

/** Every panel that can appear in a mode — the source list for the editor's `panelUnlock` picker. */
export const ALL_PANELS = [playPanel, upgradeTreePanel, generatorsPanel] as const

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

  return { panels }
}
