/**
 * Dev panel UI — DOM construction, event wiring, CSV export.
 */

import type { GameMode } from '@game/shared'
import {
  getModeDefinition,
  AVAILABLE_MODES,
  getUpgradeName,
  getUpgradeDescription,
  getGeneratorName,
} from '@game/shared'
import { IDLER_STRATEGIES, UPGRADE_ABBR } from './strategies.js'
import type { Strategy } from './strategies.js'
import { simulate } from './simulate.js'
import type { SimResult } from './simulate.js'
import { renderChart, updateChart } from './chart.js'
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
  const statsSection = root.querySelector<HTMLElement>('.dev-statistics')!
  const statsStrategySelect = root.querySelector<HTMLSelectElement>('#stats-strategy-select')!
  const statsContent = root.querySelector<HTMLDivElement>('#stats-content')!

  // ── Live pane elements ──
  const liveStatus = root.querySelector<HTMLDivElement>('#live-status')!
  const liveScoreChart = root.querySelector<HTMLDivElement>('#live-chart-score')!
  const liveIncomeChart = root.querySelector<HTMLDivElement>('#live-chart-income')!
  const liveResourceCharts = root.querySelector<HTMLDivElement>('#live-chart-resources')!
  const liveStatsSection = root.querySelector<HTMLElement>('#live-statistics')!
  const liveStatsContent = root.querySelector<HTMLDivElement>('#live-stats-content')!

  // ── Tab switching ──
  function switchTab(tab: 'simulation' | 'live'): void {
    tabs.forEach((btn) => btn.classList.toggle('active', btn.dataset.tab === tab))
    simPane.classList.toggle('hidden', tab !== 'simulation')
    livePane.classList.toggle('hidden', tab !== 'live')

    if (tab === 'live') {
      startLiveListener((state) => {
        renderLiveStatus(liveStatus, state)
        renderLiveCharts(state, liveScoreChart, liveIncomeChart, liveResourceCharts)
        renderLiveStatistics(state, liveStatsSection, liveStatsContent)
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

      // Show statistics section and populate strategy selector
      statsSection.classList.remove('hidden')
      statsStrategySelect.innerHTML = lastResults
        .map((r, i) => `<option value="${i}">${r.name}</option>`)
        .join('')
      renderStatistics(lastResults[0], mode, statsContent)

      runBtn.disabled = false
      runBtn.textContent = '▶ Run'
      csvBtn.disabled = false
    })
  })

  statsStrategySelect.addEventListener('change', () => {
    const idx = Number(statsStrategySelect.value)
    const mode = modeSelect.value as GameMode
    if (lastResults[idx]) {
      renderStatistics(lastResults[idx], mode, statsContent)
    }
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
      <section class="dev-statistics hidden">
        <h2>Statistics</h2>
        <label>
          Strategy:
          <select id="stats-strategy-select"></select>
        </label>
        <div id="stats-content"></div>
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
      <section class="dev-statistics hidden" id="live-statistics">
        <h2>Statistics</h2>
        <div id="live-stats-content"></div>
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

// ─── Statistics ──────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function renderStatistics(result: SimResult, mode: GameMode, container: HTMLDivElement): void {
  const modeDef = getModeDefinition(mode)
  const { finalState, purchaseLog } = result

  // ── Purchase timeline table ──
  let timelineHtml = `<h3>Purchase Timeline</h3>`
  if (purchaseLog.length === 0) {
    timelineHtml += `<p class="stats-empty">No purchases made.</p>`
  } else {
    timelineHtml += `<table class="stats-table"><thead><tr>
      <th>#</th><th>Time</th><th>Purchase</th><th>Description</th>
    </tr></thead><tbody>`
    timelineHtml += purchaseLog
      .map((p, i) => {
        const isGenerator = modeDef.generators.some((g) => g.id === p.id)
        const name = isGenerator
          ? escapeHtml(getGeneratorName(modeDef.flavor, p.id))
          : escapeHtml(getUpgradeName(modeDef.flavor, p.id))
        const desc = isGenerator ? '' : escapeHtml(getUpgradeDescription(modeDef.flavor, p.id))
        return `<tr>
          <td>${i + 1}</td>
          <td>${p.timeSec.toFixed(1)}s</td>
          <td>${name}</td>
          <td>${desc || '—'}</td>
        </tr>`
      })
      .join('')
    timelineHtml += `</tbody></table>`
  }

  // ── Income breakdown (upgrades + generators) ──
  let breakdownHtml = `<h3>Income Breakdown (End State)</h3>`
  const rows: { name: string; resource: string; rate: string; pct: string }[] = []

  // Native (base) income
  for (const mod of modeDef.nativeModifiers) {
    if (
      mod.stage === 'additive' &&
      mod.field !== 'clickIncome' &&
      mod.field !== 'globalMultiplier'
    ) {
      const resFlavor = modeDef.flavor.resources.find((r) => r.key === mod.field)
      rows.push({
        name: 'Base income',
        resource: resFlavor?.displayName ?? mod.field,
        rate: `${mod.value.toFixed(2)}/s`,
        pct: '', // computed below
      })
    }
  }

  // Upgrade contributions
  for (const upgrade of modeDef.upgrades) {
    const owned = finalState.upgrades[upgrade.id] ?? 0
    if (owned <= 0) continue
    for (const mod of upgrade.modifiers) {
      if (mod.field === 'clickIncome' || mod.field === 'globalMultiplier') continue
      const effectiveValue = upgrade.repeatable ? mod.value * owned : mod.value
      const resFlavor = modeDef.flavor.resources.find((r) => r.key === mod.field)
      const upgradeName = escapeHtml(getUpgradeName(modeDef.flavor, upgrade.id))
      const countSuffix = owned > 1 ? ` ×${owned}` : ''
      rows.push({
        name: `${upgradeName}${countSuffix}`,
        resource: resFlavor?.displayName ?? mod.field,
        rate:
          mod.stage === 'additive'
            ? `+${effectiveValue.toFixed(2)}/s`
            : `×${effectiveValue.toFixed(2)}`,
        pct: '',
      })
    }
  }

  // Generator contributions
  for (const gen of modeDef.generators) {
    const owned = finalState.generators[gen.id] ?? 0
    if (owned <= 0) continue
    const resFlavor = modeDef.flavor.resources.find((r) => r.key === gen.production.resource)
    const genName = escapeHtml(getGeneratorName(modeDef.flavor, gen.id))
    rows.push({
      name: `${genName} ×${owned}`,
      resource: resFlavor?.displayName ?? gen.production.resource,
      rate: `+${(gen.production.rate * owned).toFixed(2)}/s`,
      pct: '',
    })
  }

  // Compute % share from final income snapshot.
  // NOTE: share is relative to the post-multiplier total income; when global
  // multipliers are active the additive shares won't sum to 100%.
  const finalSnap = result.snapshots.at(-1)
  if (finalSnap) {
    for (const row of rows) {
      if (row.rate.startsWith('+')) {
        const resKey =
          modeDef.flavor.resources.find((r) => r.displayName === row.resource)?.key ?? row.resource
        const totalIncome = finalSnap.incomePerSec[resKey] ?? 0
        if (totalIncome > 0) {
          const rawRate = parseFloat(row.rate.slice(1))
          row.pct = `${((rawRate / totalIncome) * 100).toFixed(0)}%`
        }
      }
    }
  }

  if (rows.length === 0) {
    breakdownHtml += `<p class="stats-empty">No income sources.</p>`
  } else {
    breakdownHtml += `<table class="stats-table"><thead><tr>
      <th>Source</th><th>Resource</th><th>Rate</th><th>Share</th>
    </tr></thead><tbody>`
    breakdownHtml += rows
      .map(
        (r) => `<tr>
          <td>${r.name}</td>
          <td>${r.resource}</td>
          <td>${r.rate}</td>
          <td>${r.pct || '—'}</td>
        </tr>`,
      )
      .join('')
    breakdownHtml += `</tbody></table>`
  }

  container.innerHTML = timelineHtml + breakdownHtml
}

let lastLiveStatsRenderTime = 0

function renderLiveStatistics(
  state: Readonly<LiveState>,
  section: HTMLElement,
  container: HTMLDivElement,
): void {
  if (!state.mode || state.snapshots.length === 0) {
    section.classList.add('hidden')
    return
  }
  // Throttle to match live chart cadence
  const now = Date.now()
  if (state.status === 'recording' && now - lastLiveStatsRenderTime < LIVE_RENDER_INTERVAL_MS)
    return
  lastLiveStatsRenderTime = now

  section.classList.remove('hidden')
  const result = liveStateToSimResult(state)
  if (!result) return
  renderStatistics(result, state.mode, container)
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
/** Cached resource chart containers to avoid DOM teardown on each update. */
let liveResourceDivs = new Map<string, { income: HTMLDivElement; balance: HTMLDivElement }>()
let liveResourceMode: string | null = null

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

  const modeDef = getModeDefinition(state.mode)
  const xData = result.snapshots.map((s) => s.timeSec)

  // Score chart
  updateChart(scoreContainer, 'Score', xData, [
    { label: 'Live', data: result.snapshots.map((s) => s.score) },
  ])

  // Per-resource charts — create containers once, then reuse via updateChart
  if (liveResourceMode !== state.mode) {
    liveResourceMode = state.mode
    liveResourceDivs = new Map()
    resourceContainer.innerHTML = ''
    for (const resKey of modeDef.resources) {
      const incDiv = document.createElement('div')
      const balDiv = document.createElement('div')
      resourceContainer.appendChild(incDiv)
      resourceContainer.appendChild(balDiv)
      liveResourceDivs.set(resKey, { income: incDiv, balance: balDiv })
    }
  }

  for (const resKey of modeDef.resources) {
    const resFlavor = modeDef.flavor.resources.find((r) => r.key === resKey)
    const resName = resFlavor?.displayName ?? resKey
    const divs = liveResourceDivs.get(resKey)!

    updateChart(divs.income, `${resName} Income/sec`, xData, [
      { label: 'Live', data: result.snapshots.map((s) => s.incomePerSec[resKey] ?? 0) },
    ])

    updateChart(divs.balance, `${resName} Balance`, xData, [
      { label: 'Live', data: result.snapshots.map((s) => s.resources[resKey] ?? 0) },
    ])
  }

  // Score income chart
  updateChart(incomeContainer, 'Score Income/sec', xData, [
    {
      label: 'Live',
      data: result.snapshots.map((s) => s.incomePerSec[modeDef.scoreResource] ?? 0),
    },
  ])
}
