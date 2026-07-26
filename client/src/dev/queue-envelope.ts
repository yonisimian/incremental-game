/**
 * Envelope verdict for the Queue tab — resolves the target envelope for the
 * active mode + goal, projects the run's scores onto its checkpoints, and renders
 * a PASS/FAIL verdict with a per-strategy breakdown.
 *
 * Perfect-timing only: the shared `simulate()` has no highlight-delay variant, so
 * both arms of `validateEnvelope` receive the same projection — the verdict
 * reflects ideal play. Score / race goals resolve to a `PacingEnvelope`; until
 * that is evaluated they fall through to the empty state.
 */

import {
  envelopeFor,
  goalTypeOf,
  isPacingEnvelope,
  simResultsToScores,
  validateEnvelope,
  validatePacing,
} from '@game/shared'
import type { GameMode, PacingEnvelope, SimGoal, SimResult, TargetEnvelope } from '@game/shared'

import type { ChartBand } from './chart.js'

/** Render the envelope verdict for a completed run into `container`. */
export function renderEnvelopeSection(
  mode: GameMode,
  results: SimResult[],
  goal: SimGoal,
  container: HTMLElement,
): void {
  container.innerHTML = envelopeSectionHtml(mode, results, goal)
}

/** Build the envelope-section HTML (pure — the empty states, duration guard, or verdict). */
export function envelopeSectionHtml(mode: GameMode, results: SimResult[], goal: SimGoal): string {
  const envelope = envelopeFor(mode, goalTypeOf(goal))

  if (!envelope) {
    return '<p class="envelope-none">No envelope for this goal.</p>'
  }

  if (results.length === 0) {
    return '<p class="envelope-none">Run a strategy to see the envelope verdict.</p>'
  }

  // Pacing (score / race) envelopes are goal-terminated — no duration guard.
  if (isPacingEnvelope(envelope)) {
    return pacingReportHtml(envelope, results)
  }

  const lastCheckpoint = envelope.checkpoints.at(-1)
  if (!lastCheckpoint) {
    return '<p class="envelope-none">Envelope has no checkpoints.</p>'
  }

  // Duration guard: projecting past the run's end would read the final snapshot
  // for later checkpoints and understate scores → a spurious FAIL. Only render
  // the verdict when the run actually reaches the final checkpoint.
  const runDurationSec = Math.max(...results.map((r) => r.snapshots.at(-1)?.timeSec ?? 0))
  if (runDurationSec + 0.001 < lastCheckpoint.timeSec) {
    return `<p class="envelope-none">Run ≥ ${lastCheckpoint.timeSec}s to evaluate this envelope (ran ${runDurationSec.toFixed(0)}s).</p>`
  }

  return envelopeReportHtml(envelope, results)
}

/** Build the verdict banner + per-strategy table + exploit warnings (perfect-timing only). */
function envelopeReportHtml(envelope: TargetEnvelope, results: SimResult[]): string {
  const scores = simResultsToScores(results, envelope)
  // D1: perfect-timing only — the same projection is both arms of the validator.
  const report = validateEnvelope(envelope, scores, scores)

  const icon = report.pass ? '✅' : '❌'
  const spreadText =
    report.spreadRatio !== null ? report.spreadRatio.toFixed(3) : 'N/A (< 2 viable)'

  let html = `
    <div class="envelope-verdict ${report.pass ? 'pass' : 'fail'}">
      ${icon} <strong>${report.pass ? 'PASS' : 'FAIL'}</strong>
      — ${report.viableCount}/${envelope.minViableStrategies} viable required,
      spread: ${spreadText} (max: ${envelope.maxStrategySpread})
      <em>· perfect-timing only</em>
    </div>
    <table class="envelope-table">
      <thead>
        <tr><th>Strategy</th><th>Score</th><th>Viable</th><th>Status</th></tr>
      </thead>
      <tbody>`

  for (const s of report.strategies) {
    const viableIcon = s.viable ? '🟢' : '🔴'
    const lastStatus = s.checkpointStatuses.at(-1) ?? 'below'
    html += `
        <tr class="envelope-row-${lastStatus}">
          <td>${escapeHtml(s.name)}</td>
          <td>${s.perfectScore.toFixed(1)}</td>
          <td>${viableIcon}</td>
          <td>${lastStatus}</td>
        </tr>`
  }

  html += '</tbody></table>'

  if (report.exploitWarnings.length > 0) {
    html += `
      <div class="envelope-warnings">
        ⚠️ <strong>Exploit warnings:</strong> ${report.exploitWarnings.map(escapeHtml).join(', ')}
        (exceeded maxScore at one or more checkpoints)
      </div>`
  }

  return html
}

/** Build the pacing verdict banner + per-strategy time table + exploit warnings. */
function pacingReportHtml(envelope: PacingEnvelope, results: SimResult[]): string {
  const report = validatePacing(envelope, results)

  const icon = report.pass ? '✅' : '❌'
  const spreadText =
    report.spreadRatio !== null ? report.spreadRatio.toFixed(3) : 'N/A (< 2 viable)'

  let html = `
    <div class="envelope-verdict ${report.pass ? 'pass' : 'fail'}">
      ${icon} <strong>${report.pass ? 'PASS' : 'FAIL'}</strong>
      — ${report.viableCount}/${envelope.minViableStrategies} viable required,
      spread: ${spreadText} (max: ${envelope.maxTimeSpread})
      <em>· time-to-milestone</em>
    </div>
    <table class="envelope-table">
      <thead>
        <tr><th>Strategy</th><th>Time</th><th>Viable</th><th>Status</th></tr>
      </thead>
      <tbody>`

  for (const s of report.strategies) {
    const viableIcon = s.viable ? '🟢' : '🔴'
    const lastStatus = s.milestoneStatuses.at(-1) ?? 'above'
    const timeText = s.timeSec === null ? '—' : `${s.timeSec.toFixed(1)}s`
    html += `
        <tr class="envelope-row-${lastStatus}">
          <td>${escapeHtml(s.name)}</td>
          <td>${timeText}</td>
          <td>${viableIcon}</td>
          <td>${lastStatus}</td>
        </tr>`
  }

  html += '</tbody></table>'

  if (report.exploitWarnings.length > 0) {
    html += `
      <div class="envelope-warnings">
        ⚠️ <strong>Exploit warnings:</strong> ${report.exploitWarnings.map(escapeHtml).join(', ')}
        (reached a milestone suspiciously fast)
      </div>`
  }

  return html
}

/**
 * The score-chart band for the active goal — the target envelope's
 * `[minScore, maxScore]` corridor over its checkpoint times. Only timed
 * (`TargetEnvelope`) goals have a score band; pacing/absent envelopes return
 * `undefined` (no band drawn).
 */
export function envelopeBand(mode: GameMode, goal: SimGoal): ChartBand | undefined {
  const envelope = envelopeFor(mode, goalTypeOf(goal))
  if (!envelope || isPacingEnvelope(envelope) || envelope.checkpoints.length === 0) return undefined
  return {
    xs: envelope.checkpoints.map((cp) => cp.timeSec),
    mins: envelope.checkpoints.map((cp) => cp.minScore),
    maxs: envelope.checkpoints.map((cp) => cp.maxScore),
    label: 'Target envelope',
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&':
        return '&amp;'
      case '<':
        return '&lt;'
      case '>':
        return '&gt;'
      case '"':
        return '&quot;'
      default:
        return '&#39;'
    }
  })
}
