/**
 * Dev panel UI — DOM construction, event wiring, CSV export.
 */

import type { GameMode } from '@game/shared'
import { getModeDefinition, AVAILABLE_MODES } from '@game/shared'
import { IDLER_STRATEGIES, UPGRADE_ABBR } from './strategies.js'
import type { Strategy } from './strategies.js'
import { simulate } from './simulate.js'
import type { SimResult } from './simulate.js'
import { renderChart } from './chart.js'
import type { ChartMarker } from './chart.js'
import { startLiveListener, stopLiveListener, getLiveState, liveStateToSimResult } from './live.js'
import type { LiveState } from './live.js'

// ─── State ───────────────────────────────────────────────────────────

let lastResults: SimResult[] = []

// ─── Strategy registry per mode ──────────────────────────────────────

const STRATEGIES: Record<string, readonly Strategy[]> = {
  idler: IDLER_STRATEGIES,
  // clicker: [] — future
}

// ─── Init ────────────────────────────────────────────────────────────

export function initDevPanel(root: HTMLElement): void {
  root.innerHTML = buildLayout()

  const tabs = root.querySelectorAll<HTMLButtonElement>('.dev-tab')
  const simPane = root.querySelector<HTMLDivElement>('#pane-simulation')!
  const livePane = root.querySelector<HTMLDivElement>('#pane-live')!

  // ── Simulation pane wiring ──
  const modeSelect = root.querySelector<HTMLSelectElement>('#mode-select')!
  const runBtn = root.querySelector<HTMLButtonElement>('#run-btn')!
  const csvBtn = root.querySelector<HTMLButtonElement>('#csv-btn')!
  const selectAllBtn = root.querySelector<HTMLButtonElement>('#select-all-btn')!
  const strategyList = root.querySelector<HTMLDivElement>('#strategy-list')!
  const scoreChart = root.querySelector<HTMLDivElement>('#chart-score')!
  const incomeChart = root.querySelector<HTMLDivElement>('#chart-income')!
  const resourceCharts = root.querySelector<HTMLDivElement>('#chart-resources')!
  const summaryBody = root.querySelector<HTMLTableSectionElement>('#summary-body')!

  // ── Live pane elements ──
  const liveStatus = root.querySelector<HTMLDivElement>('#live-status')!
  const liveScoreChart = root.querySelector<HTMLDivElement>('#live-chart-score')!
  const liveIncomeChart = root.querySelector<HTMLDivElement>('#live-chart-income')!
  const liveResourceCharts = root.querySelector<HTMLDivElement>('#live-chart-resources')!

  // ── Tab switching ──
  function switchTab(tab: 'simulation' | 'live'): void {
    tabs.forEach((btn) => btn.classList.toggle('active', btn.dataset.tab === tab))
    simPane.classList.toggle('hidden', tab !== 'simulation')
    livePane.classList.toggle('hidden', tab !== 'live')

    if (tab === 'live') {
      startLiveListener((state) => {
        renderLiveStatus(liveStatus, state)
        renderLiveCharts(state, liveScoreChart, liveIncomeChart, liveResourceCharts)
      })
      // Render existing state (if any) now that the pane is visible
      const current = getLiveState()
      renderLiveStatus(liveStatus, current)
      renderLiveCharts(current, liveScoreChart, liveIncomeChart, liveResourceCharts)
    } else {
      stopLiveListener()
    }
  }

  tabs.forEach((btn) => {
    btn.addEventListener('click', () => {
      switchTab(btn.dataset.tab as 'simulation' | 'live')
    })
  })

  // Populate mode dropdown
  for (const mode of AVAILABLE_MODES) {
    const opt = document.createElement('option')
    opt.value = mode
    opt.textContent = getModeDefinition(mode).flavor.displayName
    if (!(mode in STRATEGIES)) opt.disabled = true
    modeSelect.appendChild(opt)
  }
  modeSelect.value = 'idler'

  // Populate strategies
  populateStrategies(strategyList, 'idler')

  modeSelect.addEventListener('change', () => {
    populateStrategies(strategyList, modeSelect.value)
  })

  selectAllBtn.addEventListener('click', () => {
    const boxes = strategyList.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
    const allChecked = Array.from(boxes).every((cb) => cb.checked)
    boxes.forEach((cb) => (cb.checked = !allChecked))
    selectAllBtn.textContent = allChecked ? 'Select All' : 'Deselect All'
  })

  csvBtn.disabled = true
  csvBtn.addEventListener('click', () => {
    exportCsv(lastResults)
  })

  runBtn.addEventListener('click', () => {
    const mode = modeSelect.value as GameMode
    const checked = getCheckedStrategies(strategyList, mode)
    if (checked.length === 0) return

    runBtn.disabled = true
    runBtn.textContent = '⏳ Running…'

    // Use requestAnimationFrame to let the UI update before blocking
    requestAnimationFrame(() => {
      lastResults = checked.map((s) => simulate(s, mode))
      renderResults(lastResults, mode, scoreChart, incomeChart, resourceCharts, summaryBody)
      runBtn.disabled = false
      runBtn.textContent = '▶ Run'
      csvBtn.disabled = false
    })
  })
}

// ─── Layout ──────────────────────────────────────────────────────────

function buildLayout(): string {
  return `
    <header class="dev-header">
      <h1>incremenTal — Dev Panel</h1>
    </header>
    <nav class="dev-tabs">
      <button class="dev-tab active" data-tab="simulation">Simulation</button>
      <button class="dev-tab" data-tab="live">Live</button>
    </nav>
    <div id="pane-simulation">
      <section class="dev-controls">
        <label>
          Mode:
          <select id="mode-select"></select>
        </label>
        <button id="run-btn">▶ Run</button>
        <button id="csv-btn" title="Download CSV">📥 CSV</button>
      </section>
      <section class="dev-strategies">
        <div class="dev-strategies-header">
          <h2>Strategies</h2>
          <button id="select-all-btn">Deselect All</button>
        </div>
        <div id="strategy-list" class="strategy-grid"></div>
      </section>
      <section class="dev-charts">
        <div id="chart-score"></div>
        <div id="chart-income"></div>
        <div id="chart-resources"></div>
      </section>
      <section class="dev-summary">
        <h2>Summary</h2>
        <table>
          <thead>
            <tr>
              <th>Strategy</th>
              <th>Score</th>
              <th>% Best</th>
              <th>Purchase Timeline</th>
            </tr>
          </thead>
          <tbody id="summary-body"></tbody>
        </table>
      </section>
    </div>
    <div id="pane-live" class="hidden">
      <section class="dev-live-info">
        <div id="live-status" class="live-status">
          <span class="live-dot waiting"></span>
          Waiting for game… Open the game with <code>?dev</code> in the URL.
        </div>
      </section>
      <section class="dev-charts">
        <div id="live-chart-score"></div>
        <div id="live-chart-income"></div>
        <div id="live-chart-resources"></div>
      </section>
    </div>
  `
}

// ─── Strategy checkboxes ─────────────────────────────────────────────

function populateStrategies(container: HTMLDivElement, mode: string): void {
  const strategies = STRATEGIES[mode] ?? []
  container.innerHTML = strategies
    .map(
      (s, i) => `
    <label class="strategy-item">
      <input type="checkbox" data-index="${i}" checked />
      ${s.name}
    </label>
  `,
    )
    .join('')
}

function getCheckedStrategies(container: HTMLDivElement, mode: GameMode): Strategy[] {
  const strategies = STRATEGIES[mode] ?? []
  const boxes = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
  const result: Strategy[] = []
  boxes.forEach((cb) => {
    if (cb.checked) {
      const idx = Number(cb.dataset.index)
      if (strategies[idx]) result.push(strategies[idx])
    }
  })
  return result
}

// ─── Render results ──────────────────────────────────────────────────

function renderResults(
  results: SimResult[],
  mode: GameMode,
  scoreContainer: HTMLDivElement,
  incomeContainer: HTMLDivElement,
  resourceContainer: HTMLDivElement,
  summaryBody: HTMLTableSectionElement,
): void {
  if (results.length === 0) return

  const modeDef = getModeDefinition(mode)
  const xData = results[0].snapshots.map((s) => s.timeSec)

  // ── Score chart ──
  const scoreSeries = results.map((r) => ({
    label: r.name,
    data: r.snapshots.map((s) => s.score),
    markers: r.purchaseLog.map(
      (p): ChartMarker => ({ x: p.timeSec, label: UPGRADE_ABBR[p.id] ?? p.id }),
    ),
  }))
  renderChart(scoreContainer, 'Score', xData, scoreSeries)

  // ── Income chart (per resource, stacked vertically) ──
  resourceContainer.innerHTML = ''
  for (const resKey of modeDef.resources) {
    const resFlavor = modeDef.flavor.resources.find((r) => r.key === resKey)
    const resName = resFlavor?.displayName ?? resKey

    // Income/sec chart for this resource
    const incomeSeries = results.map((r) => ({
      label: r.name,
      data: r.snapshots.map((s) => s.incomePerSec[resKey] ?? 0),
      markers: r.purchaseLog.map(
        (p): ChartMarker => ({ x: p.timeSec, label: UPGRADE_ABBR[p.id] ?? p.id }),
      ),
    }))
    const incDiv = document.createElement('div')
    resourceContainer.appendChild(incDiv)
    renderChart(incDiv, `${resName} Income/sec`, xData, incomeSeries)

    // Resource balance chart
    const balanceSeries = results.map((r) => ({
      label: r.name,
      data: r.snapshots.map((s) => s.resources[resKey] ?? 0),
      markers: r.purchaseLog.map(
        (p): ChartMarker => ({ x: p.timeSec, label: UPGRADE_ABBR[p.id] ?? p.id }),
      ),
    }))
    const balDiv = document.createElement('div')
    resourceContainer.appendChild(balDiv)
    renderChart(balDiv, `${resName} Balance`, xData, balanceSeries)
  }

  // ── Main income chart (total score income) — use score resource ──
  const totalIncomeSeries = results.map((r) => ({
    label: r.name,
    data: r.snapshots.map((s) => s.incomePerSec[modeDef.scoreResource] ?? 0),
    markers: r.purchaseLog.map(
      (p): ChartMarker => ({ x: p.timeSec, label: UPGRADE_ABBR[p.id] ?? p.id }),
    ),
  }))
  renderChart(incomeContainer, 'Score Income/sec', xData, totalIncomeSeries)

  // ── Summary table ──
  const bestScore = Math.max(...results.map((r) => r.finalScore))
  summaryBody.innerHTML = results
    .slice()
    .sort((a, b) => b.finalScore - a.finalScore)
    .map((r) => {
      const pct = ((r.finalScore / bestScore) * 100).toFixed(0)
      const timeline = r.purchaseLog
        .map((p) => `${UPGRADE_ABBR[p.id] ?? p.id}@${p.timeSec.toFixed(1)}s`)
        .join(' → ')
      return `
        <tr>
          <td>${r.name}</td>
          <td>${r.finalScore.toFixed(1)}</td>
          <td>${pct}%</td>
          <td class="timeline">${timeline || '—'}</td>
        </tr>
      `
    })
    .join('')
}

// ─── CSV export ──────────────────────────────────────────────────────

function exportCsv(results: SimResult[]): void {
  if (results.length === 0) return

  const resourceKeys = Object.keys(results[0].snapshots[0].resources)
  const incomeKeys = Object.keys(results[0].snapshots[0].incomePerSec)

  const resCols = resourceKeys.map((k) => `res_${k}`)
  const incCols = incomeKeys.map((k) => `income_${k}`)

  const header = ['strategy', 'tick', 'time_sec', 'score', ...resCols, ...incCols, 'event'].join(
    ',',
  )

  const rows: string[] = [header]
  for (const r of results) {
    for (const s of r.snapshots) {
      const resVals = resourceKeys.map((k) => (s.resources[k] ?? 0).toFixed(2))
      const incVals = incomeKeys.map((k) => (s.incomePerSec[k] ?? 0).toFixed(2))
      rows.push(
        [
          `"${r.name}"`,
          s.tick,
          s.timeSec.toFixed(3),
          s.score.toFixed(2),
          ...resVals,
          ...incVals,
          `"${s.event}"`,
        ].join(','),
      )
    }
  }

  const blob = new Blob([rows.join('\n')], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'simulation-results.csv'
  a.click()
  URL.revokeObjectURL(url)
}

// ─── Live mode ───────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  waiting: 'Waiting for game… Open the game with <code>?dev</code> in the URL.',
  recording: '🔴 Recording live data…',
  ended: '✅ Round ended.',
}

const DOT_CLASS: Record<string, string> = {
  waiting: 'waiting',
  recording: 'recording',
  ended: 'ended',
}

function renderLiveStatus(container: HTMLDivElement, state: Readonly<LiveState>): void {
  const dotClass = DOT_CLASS[state.status] ?? 'waiting'
  const label = STATUS_LABELS[state.status] ?? ''
  const extra =
    state.status === 'recording'
      ? ` (${state.snapshots.length} ticks, score: ${state.snapshots.at(-1)?.score.toFixed(1) ?? '—'})`
      : state.status === 'ended'
        ? ` Final score: ${state.finalScore?.toFixed(1) ?? '—'}`
        : ''
  container.innerHTML = `<span class="live-dot ${dotClass}"></span> ${label}${extra}`
}

/** Throttle interval for live chart re-renders (ms). */
const LIVE_RENDER_INTERVAL_MS = 500
let lastLiveRenderTime = 0

function renderLiveCharts(
  state: Readonly<LiveState>,
  scoreContainer: HTMLDivElement,
  incomeContainer: HTMLDivElement,
  resourceContainer: HTMLDivElement,
): void {
  // Throttle re-renders to avoid perf issues
  const now = Date.now()
  if (state.status === 'recording' && now - lastLiveRenderTime < LIVE_RENDER_INTERVAL_MS) return
  lastLiveRenderTime = now

  const result = liveStateToSimResult(state)
  if (!result || !state.mode) return

  const modeDef = getModeDefinition(state.mode as GameMode)
  const xData = result.snapshots.map((s) => s.timeSec)

  // Score chart
  renderChart(scoreContainer, 'Score', xData, [
    { label: 'Live', data: result.snapshots.map((s) => s.score) },
  ])

  // Per-resource charts
  resourceContainer.innerHTML = ''
  for (const resKey of modeDef.resources) {
    const resFlavor = modeDef.flavor.resources.find((r) => r.key === resKey)
    const resName = resFlavor?.displayName ?? resKey

    const incDiv = document.createElement('div')
    resourceContainer.appendChild(incDiv)
    renderChart(incDiv, `${resName} Income/sec`, xData, [
      { label: 'Live', data: result.snapshots.map((s) => s.incomePerSec[resKey] ?? 0) },
    ])

    const balDiv = document.createElement('div')
    resourceContainer.appendChild(balDiv)
    renderChart(balDiv, `${resName} Balance`, xData, [
      { label: 'Live', data: result.snapshots.map((s) => s.resources[resKey] ?? 0) },
    ])
  }

  // Score income chart
  renderChart(incomeContainer, 'Score Income/sec', xData, [
    {
      label: 'Live',
      data: result.snapshots.map((s) => s.incomePerSec[modeDef.scoreResource] ?? 0),
    },
  ])
}
