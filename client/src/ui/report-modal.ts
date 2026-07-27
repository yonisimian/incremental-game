// ─── Report a Bug Modal ──────────────────────────────────────────────
//
// A small overlay opened from the end screen's "!" button. Tells the player
// how to reach us and lets them export the round's log to attach to a report.

import { liveActionsToStrategy } from '@game/shared'
import { getRecordedRound } from '../dev-recorder.js'
import { saveStrategyToFile } from '../strategy-file.js'

// Replace with the real invite before publishing.
const DISCORD_URL = 'https://discord.gg/your-invite'

let overlayEl: HTMLElement | null = null

export function openReportModal(): void {
  if (overlayEl) return // already open

  document.body.insertAdjacentHTML('beforeend', renderContent())
  overlayEl = document.getElementById('report-overlay')!

  requestAnimationFrame(() => overlayEl?.classList.add('visible'))

  document.getElementById('report-close')!.addEventListener('click', closeReportModal)
  overlayEl.addEventListener('click', (e) => {
    if (e.target === overlayEl) closeReportModal()
  })
  document.addEventListener('keydown', handleEscape)

  const exportBtn = document.getElementById('report-export-btn') as HTMLButtonElement
  if (!getRecordedRound()) {
    exportBtn.disabled = true
    exportBtn.title = 'Nothing was recorded this round.'
  }
  exportBtn.addEventListener('click', () => {
    const round = getRecordedRound()
    if (!round) return
    const strategy = liveActionsToStrategy(round.actions, round.mode, timestampName())
    void saveStrategyToFile(strategy)
  })
}

// A filesystem-friendly `MM-DD-YYYY-HH-MM-SS` timestamp (24-hour clock), used
// as the log's name so the saved file defaults to that plus `.json`.
function timestampName(): string {
  const now = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return [
    now.getFullYear(),
    p(now.getMonth() + 1),
    p(now.getDate()),
    p(now.getHours()),
    p(now.getMinutes()),
    p(now.getSeconds()),
  ].join('-')
}

function renderContent(): string {
  return `
    <div class="report-overlay" id="report-overlay">
      <div class="report-modal" role="dialog" aria-modal="true" aria-label="Report a bug">
        <header class="report-header">
          <h2>Found a bug?</h2>
          <button class="report-close" id="report-close" aria-label="Close">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M5 5L15 15M15 5L5 15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
          </button>
        </header>
        <div class="report-body">
          <p>
            Want to report an issue? Reach us on our
            <a href="${DISCORD_URL}" target="_blank" rel="noopener noreferrer">Discord server</a>.
          </p>
          <p>
            We recommend attaching the game's log; it'll help us identify and fix the bug faster.
          </p>
          <button id="report-export-btn" class="report-export-btn">⤓ Export log</button>
        </div>
      </div>
    </div>
  `
}

function closeReportModal(): void {
  if (!overlayEl) return
  overlayEl.classList.remove('visible')
  overlayEl.addEventListener('transitionend', () => {
    overlayEl?.remove()
    overlayEl = null
  })
  document.removeEventListener('keydown', handleEscape)
}

function handleEscape(e: KeyboardEvent): void {
  if (e.key === 'Escape') closeReportModal()
}
