// ─── Settings Modal ──────────────────────────────────────────────────
//
// A full-screen overlay accessible from the lobby via the gear icon.
// Manages number display preferences (notation + grouping).

import {
  type NotationMode,
  type DigitGrouping,
  getNumberFormatSettings,
  setNotation,
  setGrouping,
  formatNumber,
} from './format-number.js'

// ─── Options ─────────────────────────────────────────────────────────

const NOTATION_OPTIONS: { value: NotationMode; label: string; example: string }[] = [
  { value: 'standard', label: 'Standard', example: '123,456' },
  { value: 'name', label: 'Named', example: '123.5K' },
  { value: 'scientific', label: 'Scientific', example: '1.23e5' },
  { value: 'engineering', label: 'Engineering', example: '123.5e3' },
]

const GROUPING_OPTIONS: { value: DigitGrouping; label: string; example: string }[] = [
  { value: 'comma', label: 'Comma', example: '1,234,567' },
  { value: 'period', label: 'Period', example: '1.234.567' },
  { value: 'space', label: 'Space', example: '1\u2009234\u2009567' },
  { value: 'none', label: 'None', example: '1234567' },
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

          <section class="settings-section${settings.notation !== 'standard' ? ' disabled' : ''}">
            <h3 class="settings-section-title">Digit Grouping</h3>
            ${settings.notation !== 'standard' ? '<p class="settings-hint">Only applies to Standard notation</p>' : ''}
            <div class="settings-chips" id="grouping-chips">
              ${GROUPING_OPTIONS.map(
                (opt) => `
                <button class="settings-chip${settings.grouping === opt.value ? ' selected' : ''}"
                        data-grouping="${opt.value}"
                        ${settings.notation !== 'standard' ? 'disabled' : ''}>
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

  document.getElementById('grouping-chips')!.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-grouping]')
    if (!btn) return
    setGrouping(btn.dataset.grouping as DigitGrouping)
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
  // Update grouping section disabled state
  const groupingSection = modal.querySelector('#grouping-chips')?.closest('.settings-section')
  if (groupingSection) {
    groupingSection.classList.toggle('disabled', settings.notation !== 'standard')
    const hint = groupingSection.querySelector('.settings-hint')
    if (settings.notation !== 'standard' && !hint) {
      groupingSection
        .querySelector('.settings-section-title')!
        .insertAdjacentHTML(
          'afterend',
          '<p class="settings-hint">Only applies to Standard notation</p>',
        )
    } else if (settings.notation === 'standard' && hint) {
      hint.remove()
    }
  }
  for (const chip of modal.querySelectorAll<HTMLButtonElement>('[data-grouping]')) {
    chip.classList.toggle('selected', chip.dataset.grouping === settings.grouping)
    chip.disabled = settings.notation !== 'standard'
  }

  // Update preview
  const previewEl = document.getElementById('settings-preview')
  if (previewEl) previewEl.textContent = preview
}
