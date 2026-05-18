/**
 * Manual Registry — structured feature descriptions used to generate MANUAL.md.
 *
 * If you add a new hotkey, screen, or game concept, add it here.
 * The CI will fail if the generated manual doesn't match the committed one.
 */

export { HOTKEYS, type HotkeyEntry } from './hotkeys.js'
export { SCREENS, type ScreenEntry } from './screens.js'
export { CONCEPTS, type ConceptEntry } from './concepts.js'
