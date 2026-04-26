import { registerPanel } from '../panels.js'
import { playPanel } from './play-panel.js'
import { generatorsPanel } from './generators-panel.js'

/** Register all panels. Call once at startup. */
export function initPanels(): void {
  registerPanel(0, playPanel)
  registerPanel(1, generatorsPanel)
}
