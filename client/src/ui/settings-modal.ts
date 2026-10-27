// ─── Settings Modal ──────────────────────────────────────────────────
//
// A full-screen overlay accessible from the lobby via the gear icon. Hosts the
// shared settings sections; in a match the same sections live in the Settings
// panel instead.

import { openModal } from './modal.js'
import { bindSettingsSections, renderSettingsSections } from './settings-sections.js'

export function openSettings(): void {
  const overlay = openModal(
    'settings-overlay',
    'Settings',
    `<div class="modal-body">${renderSettingsSections()}</div>`,
  )
  if (!overlay) return
  bindSettingsSections(overlay)
}
