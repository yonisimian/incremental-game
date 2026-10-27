// ─── Settings Sections ───────────────────────────────────────────────
//
// The player preferences shared by the lobby's settings modal and the in-match
// Settings panel: audio volumes, number display (notation + decimal separator)
// and how much of the upgrade tree is shown. Markup is scoped to its root — no
// ids — so the two hosts can never collide.

import {
  type NotationMode,
  type DecimalSeparator,
  getNumberFormatSettings,
  setNotation,
  setDecimalSeparator,
  formatNumber,
  formatNumberAs,
} from './format-number.js'
import { getAudioSettings, setMusicVolume, setSfxVolume } from './audio-settings.js'
import { type TreeVisibility, getTreeVisibility, setTreeVisibility } from './tree-visibility.js'

// ─── Options ─────────────────────────────────────────────────────────

// A single sample value drives the notation chips, the decimal separator
// chips, and the preview, so every example shows the same number formatted
// consistently. Chosen in the 1e7 range with a non-round mantissa so every
// notation surfaces the decimal separator (e.g. 15.5M / 1.55e7 / 15.5e6).
const SAMPLE_VALUE = 15_500_000

type VolumeChannel = 'music' | 'sfx'

const VOLUME_OPTIONS: { value: VolumeChannel; label: string; set: (v: number) => void }[] = [
  { value: 'music', label: 'Music', set: setMusicVolume },
  { value: 'sfx', label: 'Sound Effects', set: setSfxVolume },
]

const NOTATION_OPTIONS: { value: NotationMode; label: string }[] = [
  { value: 'name', label: 'Named' },
  { value: 'scientific', label: 'Scientific' },
  { value: 'engineering', label: 'Engineering' },
]

const DECIMAL_SEPARATOR_OPTIONS: { value: DecimalSeparator; label: string }[] = [
  { value: 'period', label: 'Period' },
  { value: 'comma', label: 'Comma' },
]

const TREE_VISIBILITY_OPTIONS: { value: TreeVisibility; label: string; example: string }[] = [
  { value: 'full', label: 'Full', example: 'Every upgrade' },
  { value: 'hidden', label: 'Hidden', example: 'Only what you can reach' },
  { value: 'peek', label: 'Peek', example: 'Reachable + one step ahead' },
]

// ─── Render ──────────────────────────────────────────────────────────

/** Every settings section, ready to drop into a host container. */
export function renderSettingsSections(): string {
  const settings = getNumberFormatSettings()
  const audio = getAudioSettings()
  const treeVisibility = getTreeVisibility()

  return `
          <section class="settings-section">
            <h3 class="settings-section-title">Audio</h3>
            <div class="settings-sliders">
              ${VOLUME_OPTIONS.map(
                (opt) => `
                <label class="settings-slider">
                  <span class="slider-label">${opt.label}</span>
                  <input type="range" min="0" max="100" step="1" value="${audio[opt.value]}"
                         data-volume="${opt.value}" aria-valuetext="${audio[opt.value]}%">
                  <span class="slider-value" data-volume-readout="${opt.value}">${audio[opt.value]}%</span>
                </label>`,
              ).join('')}
            </div>
          </section>

          <section class="settings-section">
            <h3 class="settings-section-title">Number Notation</h3>
            <div class="settings-chips">
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
            <div class="settings-chips">
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
            <span class="preview-value">${formatNumber(SAMPLE_VALUE)}</span>
          </div>

          <section class="settings-section">
            <h3 class="settings-section-title">Upgrade Tree</h3>
            <div class="settings-chips">
              ${TREE_VISIBILITY_OPTIONS.map(
                (opt) => `
                <button class="settings-chip${treeVisibility === opt.value ? ' selected' : ''}"
                        data-tree-visibility="${opt.value}">
                  <span class="chip-label">${opt.label}</span>
                  <span class="chip-example chip-text">${opt.example}</span>
                </button>`,
              ).join('')}
            </div>
          </section>
  `
}

/** Wire the sections rendered inside `root` to the stored settings. */
export function bindSettingsSections(root: HTMLElement): void {
  root.addEventListener('click', (e) => {
    const target = e.target as HTMLElement
    const notation = target.closest<HTMLButtonElement>('[data-notation]')
    const decimal = target.closest<HTMLButtonElement>('[data-decimal]')
    const treeVisibility = target.closest<HTMLButtonElement>('[data-tree-visibility]')
    if (notation) setNotation(notation.dataset.notation as NotationMode)
    else if (decimal) setDecimalSeparator(decimal.dataset.decimal as DecimalSeparator)
    else if (treeVisibility)
      setTreeVisibility(treeVisibility.dataset.treeVisibility as TreeVisibility)
    else return
    refreshSections(root)
  })

  root.addEventListener('input', (e) => {
    const slider = (e.target as HTMLElement).closest<HTMLInputElement>('input[data-volume]')
    if (!slider) return
    const channel = slider.dataset.volume as VolumeChannel
    VOLUME_OPTIONS.find((opt) => opt.value === channel)?.set(Number(slider.value))
    const volume = getAudioSettings()[channel]
    slider.setAttribute('aria-valuetext', `${volume}%`)
    const readout = root.querySelector(`[data-volume-readout="${channel}"]`)
    if (readout) readout.textContent = `${volume}%`
  })
}

// ─── Internals ───────────────────────────────────────────────────────

function refreshSections(root: HTMLElement): void {
  const settings = getNumberFormatSettings()

  // Update chip selection states
  for (const chip of root.querySelectorAll<HTMLButtonElement>('[data-notation]')) {
    const notation = chip.dataset.notation as NotationMode
    chip.classList.toggle('selected', notation === settings.notation)
    // The example reflects the current decimal separator, so refresh it too.
    const example = chip.querySelector('.chip-example')
    if (example) {
      example.textContent = formatNumberAs(SAMPLE_VALUE, notation, settings.decimalSeparator)
    }
  }
  for (const chip of root.querySelectorAll<HTMLButtonElement>('[data-decimal]')) {
    const separator = chip.dataset.decimal as DecimalSeparator
    chip.classList.toggle('selected', separator === settings.decimalSeparator)
    // The example reflects the current notation, so refresh it too.
    const example = chip.querySelector('.chip-example')
    if (example) {
      example.textContent = formatNumberAs(SAMPLE_VALUE, settings.notation, separator)
    }
  }

  const treeVisibility = getTreeVisibility()
  for (const chip of root.querySelectorAll<HTMLButtonElement>('[data-tree-visibility]')) {
    chip.classList.toggle('selected', chip.dataset.treeVisibility === treeVisibility)
  }

  // Update preview
  const previewEl = root.querySelector('.preview-value')
  if (previewEl) previewEl.textContent = formatNumber(SAMPLE_VALUE)
}
