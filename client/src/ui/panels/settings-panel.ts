import type { Panel } from '../panels.js'
import {
  type NotationMode,
  type DigitGrouping,
  getNumberFormatSettings,
  setNotation,
  setGrouping,
  formatNumber,
} from '../format-number.js'

// ─── Settings Panel ──────────────────────────────────────────────────

const NOTATION_OPTIONS: { value: NotationMode; label: string; example: string }[] = [
  { value: 'standard', label: 'Standard', example: '123456' },
  { value: 'name', label: 'Named', example: '123.46K' },
  { value: 'scientific', label: 'Scientific', example: '1.23e5' },
  { value: 'engineering', label: 'Engineering', example: '123.46e3' },
]

const GROUPING_OPTIONS: { value: DigitGrouping; label: string; example: string }[] = [
  { value: 'comma', label: 'Comma', example: '1,234,567' },
  { value: 'period', label: 'Period', example: '1.234.567' },
  { value: 'space', label: 'Space', example: '1\u2009234\u2009567' },
  { value: 'none', label: 'None', example: '1234567' },
]

function renderSettings(): string {
  const settings = getNumberFormatSettings()
  const preview = formatNumber(123456.78, 2)

  return `
    <div class="settings-panel">
      <h2 class="settings-heading">Display Settings</h2>

      <fieldset class="settings-group">
        <legend>Number Notation</legend>
        <div class="settings-options">
          ${NOTATION_OPTIONS.map(
            (opt) => `
            <label class="settings-option${settings.notation === opt.value ? ' active' : ''}">
              <input type="radio" name="notation" value="${opt.value}"
                ${settings.notation === opt.value ? 'checked' : ''}>
              <span class="option-label">${opt.label}</span>
              <span class="option-example">${opt.example}</span>
            </label>`,
          ).join('')}
        </div>
      </fieldset>

      <fieldset class="settings-group">
        <legend>Digit Grouping</legend>
        <div class="settings-options">
          ${GROUPING_OPTIONS.map(
            (opt) => `
            <label class="settings-option${settings.grouping === opt.value ? ' active' : ''}">
              <input type="radio" name="grouping" value="${opt.value}"
                ${settings.grouping === opt.value ? 'checked' : ''}>
              <span class="option-label">${opt.label}</span>
              <span class="option-example">${opt.example}</span>
            </label>`,
          ).join('')}
        </div>
      </fieldset>

      <div class="settings-preview">
        <span class="preview-label">Preview:</span>
        <span class="preview-value" id="settings-preview">${preview}</span>
      </div>
    </div>
  `
}

export const settingsPanel: Panel = {
  label: 'Settings',
  icon: '⚙️',

  render(container) {
    container.innerHTML = renderSettings()
  },

  bind(_state) {
    const container = document.querySelector('.settings-panel')
    if (!container) return

    container.addEventListener('change', (e) => {
      const target = e.target as HTMLInputElement
      if (target.name === 'notation') {
        setNotation(target.value as NotationMode)
        // Re-render to update active states and preview
        const panel = document.querySelector('.settings-panel')?.parentElement
        if (panel) {
          panel.innerHTML = renderSettings()
          settingsPanel.bind!(_state)
        }
      } else if (target.name === 'grouping') {
        setGrouping(target.value as DigitGrouping)
        const panel = document.querySelector('.settings-panel')?.parentElement
        if (panel) {
          panel.innerHTML = renderSettings()
          settingsPanel.bind!(_state)
        }
      }
    })
  },
}
