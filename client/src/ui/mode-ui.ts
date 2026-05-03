import type { GameMode } from '@game/shared'
import { getModeDefinition } from '@game/shared'
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

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Derive the client-side panel configuration from the mode definition.
 * Adding generators or tree-category upgrades to a new mode automatically
 * surfaces the corresponding panel — no hardcoded per-mode map needed.
 */
export function getModeUI(mode: GameMode): ModeUI {
  const modeDef = getModeDefinition(mode)
  const panels: PanelSlot[] = [{ index: 0, panel: playPanel }]

  if (modeDef.generators.length > 0) {
    panels.push({ index: panels.length, panel: generatorsPanel })
  }

  if (modeDef.upgrades.some((u) => u.category === 'tree')) {
    panels.push({ index: panels.length, panel: upgradeTreePanel })
  }

  return { panels }
}
