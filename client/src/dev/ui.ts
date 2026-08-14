/**
 * Dev panel UI — DOM construction and event wiring.
 */

import type { GameMode } from '@game/shared'
import { getModeDefinition, getModeFlavor, liveActionsToStrategy } from '@game/shared'
import { updateChart } from './chart.js'
import { startLiveListener, stopLiveListener, getLiveState, liveStateToSimResult } from './live.js'
import type { LiveState } from './live.js'
import { initEditor } from './editor/index.js'
import { initQueueSim, importStrategyToQueue } from './queue-sim.js'
import { saveStrategyToFile } from './strategy-io.js'

// ─── Init ────────────────────────────────────────────────────

export function initDevPanel(root: HTMLElement): void {
  root.innerHTML = buildLayout()

  const tabs = root.querySelectorAll<HTMLButtonElement>('.dev-tab')
  const livePane = root.querySelector<HTMLDivElement>('#pane-live')!
  const editorPane = root.querySelector<HTMLDivElement>('#pane-editor')!
  const queuePane = root.querySelector<HTMLDivElement>('#pane-queue')!

  // ── Live pane elements ──
  const liveStatus = root.querySelector<HTMLDivElement>('#live-status')!
  const liveScoreChart = root.querySelector<HTMLDivElement>('#live-chart-score')!
  const liveIncomeChart = root.querySelector<HTMLDivElement>('#live-chart-income')!
  const liveResourceCharts = root.querySelector<HTMLDivElement>('#live-chart-resources')!
  const liveExportBtn = root.querySelector<HTMLButtonElement>('#live-export-btn')!
  const liveExportStatus = root.querySelector<HTMLSpanElement>('#live-export-status')!

  // Export the recorded playthrough as a strategy: save it to a file and hand a
  // copy to the Queue tab so it can be compared against other strategies.
  liveExportBtn.addEventListener('click', () => {
    const state = getLiveState()
    if (!state.mode || state.actions.length === 0) {
      liveExportStatus.textContent = 'Nothing recorded yet.'
      return
    }
    const name = `Live ${state.mode} ${new Date().toLocaleTimeString()}`
    const strategy = liveActionsToStrategy(state.actions, state.mode as GameMode, name)
    importStrategyToQueue(strategy)
    saveStrategyToFile(strategy).catch((err: unknown) => {
      liveExportStatus.textContent = `Save failed: ${err instanceof Error ? err.message : String(err)}`
    })
    liveExportStatus.textContent = `Exported "${name}" (${strategy.actions.length} actions) → Queue tab.`
  })

  // ── Tab switching ──
  // The editor is mounted lazily on first entry and torn down on leave (it owns
  // pan/zoom listeners); `editorTeardown` is non-null only while it is mounted.
  let editorTeardown: (() => void) | null = null
  // The queue editor is mounted once, lazily, on first entry.
  let queueMounted = false

  function switchTab(tab: 'live' | 'editor' | 'queue'): void {
    tabs.forEach((btn) => btn.classList.toggle('active', btn.dataset.tab === tab))
    livePane.classList.toggle('hidden', tab !== 'live')
    editorPane.classList.toggle('hidden', tab !== 'editor')
    queuePane.classList.toggle('hidden', tab !== 'queue')

    if (tab === 'live') {
      startLiveListener((state) => {
        renderLiveStatus(liveStatus, state)
        renderLiveCharts(state, liveScoreChart, liveIncomeChart, liveResourceCharts)
        liveExportBtn.disabled = state.actions.length === 0
      })
      // Render existing state (if any) now that the pane is visible
      const current = getLiveState()
      renderLiveStatus(liveStatus, current)
      renderLiveCharts(current, liveScoreChart, liveIncomeChart, liveResourceCharts)
      liveExportBtn.disabled = current.actions.length === 0
    } else {
      stopLiveListener()
    }

    if (tab === 'editor') {
      // Mount only once the pane is visible so pan/zoom sees real dimensions.
      editorTeardown ??= initEditor(editorPane)
    } else if (editorTeardown) {
      editorTeardown()
      editorTeardown = null
    }

    if (tab === 'queue' && !queueMounted) {
      queueMounted = true
      initQueueSim(queuePane)
    }
  }

  tabs.forEach((btn) => {
    btn.addEventListener('click', () => {
      switchTab(btn.dataset.tab as 'live' | 'editor' | 'queue')
    })
  })

  // Open the Queue tab by default.
  switchTab('queue')
}

// ─── Layout ──────────────────────────────────────────────────────────

function buildLayout(): string {
  return `
    <header class="dev-header">
      <h1>incremenTal — Dev Panel</h1>
    </header>
    <nav class="dev-tabs">
      <button class="dev-tab" data-tab="queue">Queue</button>
      <button class="dev-tab" data-tab="live">Live</button>
      <button class="dev-tab" data-tab="editor">Editor</button>
    </nav>
    <div id="pane-live" class="hidden">
      <section class="dev-live-info">
        <div id="live-status" class="live-status">
          <span class="live-dot waiting"></span>
          Waiting for game… Open the game with <code>?dev</code> in the URL.
        </div>
        <div class="live-export">
          <button id="live-export-btn" disabled>⤓ Export as strategy</button>
          <span id="live-export-status" class="live-export-status"></span>
        </div>
      </section>
      <section class="dev-charts">
        <div id="live-chart-score"></div>
        <div id="live-chart-income"></div>
        <div id="live-chart-resources"></div>
      </section>
    </div>
    <div id="pane-editor" class="hidden"></div>
    <div id="pane-queue" class="hidden"></div>
  `
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

  const modeDef = getModeDefinition(state.mode as GameMode)
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
    const resFlavor = getModeFlavor(modeDef).resources.find((r) => r.key === resKey)
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
