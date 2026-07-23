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
} from './format-number.js'

// ─── Options ─────────────────────────────────────────────────────────

const NOTATION_OPTIONS: { value: NotationMode; label: string; example: string }[] = [
  { value: 'name', label: 'Named', example: '123.5K' },
  { value: 'scientific', label: 'Scientific', example: '1.23e5' },
  { value: 'engineering', label: 'Engineering', example: '123.5e3' },
]

const DECIMAL_SEPARATOR_OPTIONS: { value: DecimalSeparator; label: string; example: string }[] = [
  { value: 'period', label: 'Period', example: '1.23e5' },
  { value: 'comma', label: 'Comma', example: '1,23e5' },
]

// ─── State ───────────────────────────────────────────────────────────

let overlayEl: HTMLElement | null = null

// ─── Render ──────────────────────────────────────────────────────────

function renderContent(): string {
  const settings = getNumberFormatSettings()
  const preview = formatNumber(123456.78, 2)

  return `
    <div class="settings-overlay" id="settings-overlay">
      <div class="settings-modal">
        <header class="settings-header">
          <h2>Settings</h2>
          <button class="settings-close" id="settings-close" aria-label="Close">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M5 5L15 15M15 5L5 15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
          </button>
        </header>

        <div class="settings-body">
          <section class="settings-section">
            <h3 class="settings-section-title">Number Notation</h3>
            <div class="settings-chips" id="notation-chips">
              ${NOTATION_OPTIONS.map(
                (opt) => `
                <button class="settings-chip${settings.notation === opt.value ? ' selected' : ''}"
                        data-notation="${opt.value}">
                  <span class="chip-label">${opt.label}</span>
                  <span class="chip-example">${opt.example}</span>
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
                  <span class="chip-example">${opt.example}</span>
                </button>`,
              ).join('')}
            </div>
          </section>

          <div class="settings-preview">
            <span class="preview-label">Preview</span>
            <span class="preview-value" id="settings-preview">${preview}</span>
          </div>
        </div>
      </div>
    </div>
  `
}

// ─── Public API ──────────────────────────────────────────────────────

export function openSettings(): void {
  if (overlayEl) return // already open

  document.body.insertAdjacentHTML('beforeend', renderContent())
  overlayEl = document.getElementById('settings-overlay')!

  // Animate in
  requestAnimationFrame(() => overlayEl?.classList.add('visible'))

  // Bind events
  document.getElementById('settings-close')!.addEventListener('click', closeSettings)
  overlayEl.addEventListener('click', (e) => {
    if (e.target === overlayEl) closeSettings()
  })

  document.getElementById('notation-chips')!.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-notation]')
    if (!btn) return
    setNotation(btn.dataset.notation as NotationMode)
    refreshModal()
  })

  document.getElementById('decimal-chips')!.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-decimal]')
    if (!btn) return
    setDecimalSeparator(btn.dataset.decimal as DecimalSeparator)
    refreshModal()
  })

  // Escape key closes
  document.addEventListener('keydown', handleEscape)
}

function closeSettings(): void {
  if (!overlayEl) return
  overlayEl.classList.remove('visible')
  overlayEl.addEventListener('transitionend', () => {
    overlayEl?.remove()
    overlayEl = null
  })
  document.removeEventListener('keydown', handleEscape)
}

// ─── Internals ───────────────────────────────────────────────────────

function handleEscape(e: KeyboardEvent): void {
  if (e.key === 'Escape') closeSettings()
}

function refreshModal(): void {
  if (!overlayEl) return
  const modal = overlayEl.querySelector('.settings-modal')
  if (!modal) return

  const settings = getNumberFormatSettings()
  const preview = formatNumber(123456.78, 2)

  // Update chip selection states
  for (const chip of modal.querySelectorAll<HTMLButtonElement>('[data-notation]')) {
    chip.classList.toggle('selected', chip.dataset.notation === settings.notation)
  }
  for (const chip of modal.querySelectorAll<HTMLButtonElement>('[data-decimal]')) {
    chip.classList.toggle('selected', chip.dataset.decimal === settings.decimalSeparator)
  }

  // Update preview
  const previewEl = document.getElementById('settings-preview')
  if (previewEl) previewEl.textContent = preview
}
