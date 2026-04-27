import type { GameMode } from '@game/shared'
import type { PanelSlot } from './panels.js'
import { playPanel } from './panels/play-panel.js'
import { generatorsPanel } from './panels/generators-panel.js'

// ─── Types ───────────────────────────────────────────────────────────

/** Display configuration for a resource in the header bar. */
interface ResourceDisplay {
  /** Key in PlayerState.resources. */
  readonly key: string
  /** Emoji icon displayed before the value. */
  readonly icon: string
  /** Optional CSS class applied to the resource item (e.g., 'gold'). */
  readonly className?: string
}

/** Client-side UI configuration for a game mode. */
export interface ModeUI {
  /** Resources shown in the header bar (visible on all tabs). */
  readonly resources: readonly ResourceDisplay[]
  /** Panels available in this mode, with their tab-grid slot indices. */
  readonly panels: readonly PanelSlot[]
}

// ─── Mode UI Definitions ─────────────────────────────────────────────

const clickerUI: ModeUI = {
  resources: [{ key: 'currency', icon: '💰', className: 'gold' }],
  panels: [
    { index: 0, panel: playPanel },
    { index: 1, panel: generatorsPanel },
  ],
}

const idlerUI: ModeUI = {
  resources: [],
  panels: [
    { index: 0, panel: playPanel },
    { index: 1, panel: generatorsPanel },
  ],
}

const modeUIMap: Record<GameMode, ModeUI> = {
  clicker: clickerUI,
  idler: idlerUI,
}

// ─── Public API ──────────────────────────────────────────────────────

/** Get the client-side UI configuration for a game mode. */
export function getModeUI(mode: GameMode): ModeUI {
  return modeUIMap[mode]
}
