// ─── Settings Modal ──────────────────────────────────────────────────
//
// A full-screen overlay accessible from the lobby via the gear icon.
// Manages number display preferences (notation + decimal separator).

import {
  type NotationMode,
  type DecimalSeparator,
  getNumberFormatSettings,
  setNotation,
  setDecimalSeparator,
  formatNumber,
  formatNumberAs,
} from './format-number.js'
import { openModal } from './modal.js'

// ─── Options ─────────────────────────────────────────────────────────

// A single sample value drives the notation chips, the decimal separator
// chips, and the preview, so every example shows the same number formatted
// consistently. Chosen in the 1e7 range with a non-round mantissa so every
// notation surfaces the decimal separator (e.g. 15.5M / 1.55e7 / 15.5e6).
const SAMPLE_VALUE = 15_500_000

const NOTATION_OPTIONS: { value: NotationMode; label: string }[] = [
  { value: 'name', label: 'Named' },
  { value: 'scientific', label: 'Scientific' },
  { value: 'engineering', label: 'Engineering' },
]

const DECIMAL_SEPARATOR_OPTIONS: { value: DecimalSeparator; label: string }[] = [
  { value: 'period', label: 'Period' },
  { value: 'comma', label: 'Comma' },
]

// ─── Render ──────────────────────────────────────────────────────────

function renderBody(): string {
  const settings = getNumberFormatSettings()
  const preview = formatNumber(SAMPLE_VALUE)

  return `
        <div class="modal-body">
          <section class="settings-section">
            <h3 class="settings-section-title">Number Notation</h3>
            <div class="settings-chips" id="notation-chips">
              ${NOTATION_OPTIONS.map(
                (opt) => `
                <button class="settings-chip${settings.notation === opt.value ? ' selected' : ''}"
                        data-notation="${opt.value}">
                  <span class="chip-label">${opt.label}</span>
                  <span class="chip-example">${formatNumberAs(SAMPLE_VALUE, opt.value, settings.decimalSeparator)}</span>
                </button>`,
              ).join('')}
            </div>
          </section>

          <section class="settings-section">
            <h3 class="settings-section-title">Decimal Separator</h3>
            <div class="settings-chips" id="decimal-chips">
              ${DECIMAL_SEPARATOR_OPTIONS.map(
                (opt) => `
                <button class="settings-chip${settings.decimalSeparator === opt.value ? ' selected' : ''}"
                        data-decimal="${opt.value}">
                  <span class="chip-label">${opt.label}</span>
                  <span class="chip-example">${formatNumberAs(SAMPLE_VALUE, settings.notation, opt.value)}</span>
                </button>`,
              ).join('')}
            </div>
          </section>

          <div class="settings-preview">
            <span class="preview-label">Preview</span>
            <span class="preview-value" id="settings-preview">${preview}</span>
          </div>
        </div>
  `
}

// ─── Public API ──────────────────────────────────────────────────────

export function openSettings(): void {
  const overlay = openModal('settings-overlay', 'Settings', renderBody())
  if (!overlay) return

  document.getElementById('notation-chips')!.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-notation]')
    if (!btn) return
    setNotation(btn.dataset.notation as NotationMode)
    refreshModal(overlay)
  })

  document.getElementById('decimal-chips')!.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-decimal]')
    if (!btn) return
    setDecimalSeparator(btn.dataset.decimal as DecimalSeparator)
    refreshModal(overlay)
  })
}

// ─── Internals ───────────────────────────────────────────────────────

function refreshModal(modal: HTMLElement): void {
  const settings = getNumberFormatSettings()
  const preview = formatNumber(SAMPLE_VALUE)

  // Update chip selection states
  for (const chip of modal.querySelectorAll<HTMLButtonElement>('[data-notation]')) {
    const notation = chip.dataset.notation as NotationMode
    chip.classList.toggle('selected', notation === settings.notation)
    // The example reflects the current decimal separator, so refresh it too.
    const example = chip.querySelector('.chip-example')
    if (example) {
      example.textContent = formatNumberAs(SAMPLE_VALUE, notation, settings.decimalSeparator)
    }
  }
  for (const chip of modal.querySelectorAll<HTMLButtonElement>('[data-decimal]')) {
    const separator = chip.dataset.decimal as DecimalSeparator
    chip.classList.toggle('selected', separator === settings.decimalSeparator)
    // The example reflects the current notation, so refresh it too.
    const example = chip.querySelector('.chip-example')
    if (example) {
      example.textContent = formatNumberAs(SAMPLE_VALUE, settings.notation, separator)
    }
  }

  // Update preview
  const previewEl = document.getElementById('settings-preview')
  if (previewEl) previewEl.textContent = preview
}
