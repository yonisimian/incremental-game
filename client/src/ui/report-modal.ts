// ─── Report a Bug Modal ──────────────────────────────────────────────
//
// A small overlay opened from the end screen's "!" button. Tells the player
// how to reach us and lets them export the round's log to attach to a report.

import { liveActionsToStrategy } from '@game/shared'
import { getRecordedRound } from '../dev-recorder.js'
import { saveStrategyToFile } from '../strategy-file.js'
import { openModal } from './modal.js'

// Replace with the real invite before publishing.
const DISCORD_URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'

export function openReportModal(): void {
  if (!openModal('report-overlay', 'Found a bug?', renderBody())) return

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

function renderBody(): string {
  return `
    <div class="modal-body report-body">
      <p>
        Want to report an issue? Reach us on our
        <a href="${DISCORD_URL}" target="_blank" rel="noopener noreferrer">Discord server</a>.
      </p>
      <p>
        We recommend attaching the game's log; it'll help us identify and fix the bug faster.
      </p>
      <button id="report-export-btn" class="report-export-btn">⤓ Export log</button>
    </div>
  `
}
