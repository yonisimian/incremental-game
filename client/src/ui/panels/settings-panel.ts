import type { Panel } from '../panels.js'
import { getState, resignMatch } from '../../game.js'
import { renderResignButton, syncResignButton } from '../components.js'
import { bindSettingsSections, renderSettingsSections } from '../settings-sections.js'

// ─── Resign confirmation ─────────────────────────────────────────────
//
// Resigning ends the match, so it takes two clicks: the first arms the button
// ("Confirm resign?") for CONFIRM_WINDOW_MS, the second resigns. Re-rendering
// the panel (switching tabs) disarms it.

const CONFIRM_WINDOW_MS = 3000
const CONFIRM_LABEL = 'Confirm resign?'

let confirmTimer: ReturnType<typeof setTimeout> | null = null

function disarm(): void {
  if (confirmTimer) {
    clearTimeout(confirmTimer)
    confirmTimer = null
  }
}

function onResignClick(e: MouseEvent): void {
  const btn = e.currentTarget as HTMLButtonElement
  if (getState().resigning) return
  if (confirmTimer) {
    disarm()
    btn.classList.remove('confirming')
    resignMatch()
    return
  }
  btn.classList.add('confirming')
  btn.textContent = CONFIRM_LABEL
  // Armed by a pointer: drop focus, so a Space meant for the click hotkey can't
  // land on the button and confirm. Keyboard arming (detail 0) keeps it.
  if (e.detail > 0) btn.blur()
  confirmTimer = setTimeout(() => {
    confirmTimer = null
    // The match may have ended, or a resign gone out, while armed.
    if (!btn.isConnected || getState().resigning) return
    btn.classList.remove('confirming')
    btn.textContent = 'Resign'
  }, CONFIRM_WINDOW_MS)
}

// ─── Panel ───────────────────────────────────────────────────────────

export const settingsPanel: Panel = {
  id: 'settings',
  label: 'Settings',
  icon: '⚙️',

  render(container, state) {
    disarm()
    container.innerHTML = `
      <div class="settings-panel" id="settings-panel">
        <section class="settings-section settings-match">
          <h3 class="settings-section-title">Match</h3>
          ${renderResignButton(state)}
        </section>
        ${renderSettingsSections()}
      </div>
    `
  },

  bind() {
    const root = document.getElementById('settings-panel')
    if (!root) return
    bindSettingsSections(root)
    document.getElementById('resign-btn')?.addEventListener('click', onResignClick)
  },

  update(state) {
    syncResignButton(state)
  },
}
