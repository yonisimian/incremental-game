/**
 * Queue Simulation tab — author a strategy as an ordered action queue (no
 * timestamps), run it through the shared `simulate()` engine, and chart the
 * result with action markers + a run report. See
 * docs/plans/23-timeline-strategy-simulation.md (phases 3–4).
 *
 * Strategies save/load to JSON files (phase 4); reference strategies under
 * `shared/strategies/<mode>/` are bundled and listed alongside session ones. The
 * envelope overlay (phase 5) is not wired here yet.
 */

import {
  MAX_CPS,
  ROUND_DURATION_SEC,
  getModeFlavor,
  simulate,
  validateStrategyForMode,
} from '@game/shared'
import type {
  GameMode,
  ModeDefinition,
  QueueStrategy,
  SimAction,
  SimGoal,
  SimResult,
} from '@game/shared'

import { renderChart } from './chart.js'
import type { ChartBand, ChartMarker, ChartPoint, ChartSeries } from './chart.js'
import { renderEnvelopeSection, envelopeBand } from './queue-envelope.js'
import { loadBundledStrategies, loadStrategyFromFile, saveStrategyToFile } from './strategy-io.js'
import {
  actionSummary,
  cloneStrategy,
  generatorOptions,
  makeEmptyStrategy,
  modeDefOf,
  moveAction,
  resourceOptions,
  upgradeOptions,
} from './queue-model.js'
import type { Option } from './queue-model.js'

const MODE: GameMode = 'idler'

// ─── Cross-tab import bridge ─────────────────────────────────────────
//
// The Live tab exports a recorded playthrough as a strategy and hands it here.
// The Queue tab mounts lazily, so an import that arrives before the first mount
// is buffered and drained on mount; later imports go straight to the live sink.

let queueImportSink: ((strategy: QueueStrategy) => void) | null = null
const pendingImports: QueueStrategy[] = []

/** Add a strategy to the Queue tab's session list (from another dev-panel tab). */
export function importStrategyToQueue(strategy: QueueStrategy): void {
  if (queueImportSink) queueImportSink(strategy)
  else pendingImports.push(strategy)
}

const ACTION_KINDS: { value: SimAction['kind']; label: string }[] = [
  { value: 'buy', label: 'Buy upgrade' },
  { value: 'buy_generator', label: 'Buy generator' },
  { value: 'set_highlight', label: 'Set highlight' },
  { value: 'set_click_rate', label: 'Set click rate' },
  { value: 'wait', label: 'Wait' },
]

export function initQueueSim(pane: HTMLElement): void {
  const mode = modeDefOf(MODE)

  // ── Session state ──
  // Seed with bundled reference strategies for this mode; fall back to one
  // empty scratch strategy so the editor always has a selection.
  const bundled = loadBundledStrategies(MODE)
  const strategies: QueueStrategy[] = bundled.length
    ? bundled
    : [makeEmptyStrategy('Strategy 1', MODE)]
  let selected = 0
  const runChecked = new Set<number>(strategies.map((_, i) => i))
  let editingRow: number | null = null
  // Titles of charts the user has collapsed — persisted across re-runs.
  const collapsedCharts = new Set<string>()

  pane.innerHTML = layout()

  const listEl = pane.querySelector<HTMLDivElement>('#q-list')!
  const nameInput = pane.querySelector<HTMLInputElement>('#q-name')!
  const tableBody = pane.querySelector<HTMLTableSectionElement>('#q-rows')!
  const kindSelect = pane.querySelector<HTMLSelectElement>('#q-kind')!
  const paramsEl = pane.querySelector<HTMLDivElement>('#q-params')!
  const addBtn = pane.querySelector<HTMLButtonElement>('#q-add')!
  const cancelEditBtn = pane.querySelector<HTMLButtonElement>('#q-cancel-edit')!
  const formError = pane.querySelector<HTMLDivElement>('#q-form-error')!
  const chartsEl = pane.querySelector<HTMLDivElement>('#q-charts')!
  const reportEl = pane.querySelector<HTMLDivElement>('#q-report')!
  const envelopeEl = pane.querySelector<HTMLDivElement>('#q-envelope')!
  const ioStatus = pane.querySelector<HTMLSpanElement>('#q-io-status')!
  const goalSelect = pane.querySelector<HTMLSelectElement>('#q-goal')!
  const goalTimeInput = pane.querySelector<HTMLInputElement>('#q-goal-time')!
  const goalScoreInput = pane.querySelector<HTMLInputElement>('#q-goal-score')!

  // Seed the goal inputs from the mode's own authored goals, so changing a
  // mode's default duration / target score (in its tree JSON) is the single
  // source that flows through here too. Fall back to the generic round length /
  // the mode's timed target when a goal type isn't authored.
  const timedGoalDef = mode.goals.find((g) => g.type === 'timed')
  const scoreGoalDef = mode.goals.find((g) => g.type === 'target-score')
  const defaultGoalSeconds =
    timedGoalDef?.type === 'timed' ? timedGoalDef.durationSec : ROUND_DURATION_SEC
  const defaultGoalScore = scoreGoalDef?.type === 'target-score' ? scoreGoalDef.target : 1000
  goalTimeInput.value = String(defaultGoalSeconds)
  goalScoreInput.value = String(defaultGoalScore)

  // Name the actual goal upgrade in the race hint (falls back to generic text).
  const goalUpgrade = mode.upgrades.find((u) => u.goalType === 'buy-upgrade')
  if (goalUpgrade) {
    const goalName =
      getModeFlavor(mode).upgrades.find((u) => u.id === goalUpgrade.id)?.name ?? goalUpgrade.id
    pane.querySelector<HTMLSpanElement>('#q-goal-race-hint')!.textContent =
      `Ends when ${goalName} can be bought (even if it isn't in the queue).`
  }

  // Show only the input relevant to the selected goal kind.
  function syncGoalFields(): void {
    const kind = goalSelect.value
    pane.querySelector('#q-goal-time-wrap')!.classList.toggle('hidden', kind !== 'timed')
    pane.querySelector('#q-goal-score-wrap')!.classList.toggle('hidden', kind !== 'score')
    pane.querySelector('#q-goal-race-hint')!.classList.toggle('hidden', kind !== 'race_to_buy')
  }
  goalSelect.addEventListener('change', syncGoalFields)
  syncGoalFields()

  function buildGoal(): SimGoal {
    switch (goalSelect.value) {
      case 'score': {
        const target = Number(goalScoreInput.value)
        return { kind: 'score', target: target > 0 ? target : defaultGoalScore }
      }
      case 'race_to_buy':
        return { kind: 'race_to_buy' }
      default: {
        const durationSec = Number(goalTimeInput.value)
        return { kind: 'timed', durationSec: durationSec > 0 ? durationSec : defaultGoalSeconds }
      }
    }
  }

  // Populate the kind dropdown + params once.
  kindSelect.innerHTML = ACTION_KINDS.map(
    (k) => `<option value="${k.value}">${k.label}</option>`,
  ).join('')
  renderParams()

  // ── Renders ──
  function current(): QueueStrategy {
    return strategies[selected]
  }

  function renderList(): void {
    listEl.innerHTML = ''
    strategies.forEach((s, i) => {
      const item = document.createElement('div')
      item.className = `q-list-item${i === selected ? ' selected' : ''}`
      const cb = document.createElement('input')
      cb.type = 'checkbox'
      cb.checked = runChecked.has(i)
      cb.title = 'Include in run'
      cb.addEventListener('change', () => {
        if (cb.checked) runChecked.add(i)
        else runChecked.delete(i)
      })
      const name = document.createElement('button')
      name.className = 'q-list-name'
      name.textContent = `${s.name} (${s.actions.length})`
      name.addEventListener('click', () => {
        selected = i
        editingRow = null
        renderAll()
      })
      item.append(
        cb,
        name,
        rowBtn('↑', i === 0, () => {
          reorderStrategy(i, i - 1)
        }),
        rowBtn('↓', i === strategies.length - 1, () => {
          reorderStrategy(i, i + 1)
        }),
      )
      listEl.appendChild(item)
    })
  }

  function renderEditor(): void {
    nameInput.value = current().name
    tableBody.innerHTML = ''
    const actions = current().actions
    actions.forEach((action, i) => {
      const { kind, target, params } = actionSummary(action, mode)
      const tr = document.createElement('tr')
      if (i === editingRow) tr.className = 'editing'
      tr.innerHTML = `
        <td>${i + 1}</td>
        <td>${kind}</td>
        <td>${target}</td>
        <td>${params}</td>`
      const controls = document.createElement('td')
      controls.className = 'q-row-controls'
      controls.append(
        rowBtn('↑', i === 0, () => {
          reorder(i, i - 1)
        }),
        rowBtn('↓', i === actions.length - 1, () => {
          reorder(i, i + 1)
        }),
        rowBtn('✎', false, () => {
          beginEdit(i)
        }),
        rowBtn('🗑', false, () => {
          deleteRow(i)
        }),
      )
      tr.appendChild(controls)
      tableBody.appendChild(tr)
    })
    if (actions.length === 0) {
      tableBody.innerHTML =
        '<tr><td colspan="5" class="q-empty">No actions yet — add one below.</td></tr>'
    }
    addBtn.textContent = editingRow === null ? 'Add action' : 'Update action'
    cancelEditBtn.classList.toggle('hidden', editingRow === null)
  }

  function renderParams(): void {
    const kind = kindSelect.value as SimAction['kind']
    paramsEl.innerHTML = paramsHtml(kind, mode)
    // wait needs a nested toggle between its two condition kinds
    const condSelect = paramsEl.querySelector<HTMLSelectElement>('#q-wait-cond')
    if (condSelect) {
      condSelect.addEventListener('change', () => {
        const secWrap = paramsEl.querySelector<HTMLElement>('#q-wait-seconds-wrap')!
        const resWrap = paramsEl.querySelector<HTMLElement>('#q-wait-res-wrap')!
        const isSeconds = condSelect.value === 'seconds'
        secWrap.classList.toggle('hidden', !isSeconds)
        resWrap.classList.toggle('hidden', isSeconds)
      })
    }
  }

  function renderAll(): void {
    renderList()
    renderEditor()
  }

  // ── Row helpers ──
  function rowBtn(text: string, disabled: boolean, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button')
    b.className = 'q-row-btn'
    b.textContent = text
    b.disabled = disabled
    b.addEventListener('click', onClick)
    return b
  }

  function reorder(from: number, to: number): void {
    moveAction(current(), from, to)
    if (editingRow === from) editingRow = to
    else if (editingRow === to) editingRow = from
    renderEditor()
  }

  // Swap two strategies in the list, keeping the selection and the run
  // checkboxes attached to their strategies (both are index-based).
  function reorderStrategy(from: number, to: number): void {
    if (to < 0 || to >= strategies.length) return
    ;[strategies[from], strategies[to]] = [strategies[to], strategies[from]]
    if (selected === from) selected = to
    else if (selected === to) selected = from
    const hadFrom = runChecked.has(from)
    const hadTo = runChecked.has(to)
    runChecked.delete(from)
    runChecked.delete(to)
    if (hadTo) runChecked.add(from)
    if (hadFrom) runChecked.add(to)
    renderAll()
  }

  function deleteRow(i: number): void {
    current().actions.splice(i, 1)
    if (editingRow === i) editingRow = null
    else if (editingRow !== null && editingRow > i) editingRow -= 1
    renderAll()
  }

  function beginEdit(i: number): void {
    editingRow = i
    loadActionIntoForm(current().actions[i])
    renderEditor()
  }

  function loadActionIntoForm(action: SimAction): void {
    kindSelect.value = action.kind
    renderParams()
    const set = (id: string, value: string): void => {
      const el = paramsEl.querySelector<HTMLInputElement | HTMLSelectElement>(id)
      if (el) el.value = value
    }
    switch (action.kind) {
      case 'buy':
        set('#q-upgrade', action.upgradeId)
        set('#q-count', String(action.count ?? 1))
        break
      case 'buy_generator':
        set('#q-generator', action.generatorId)
        set('#q-count', String(action.count ?? 1))
        break
      case 'set_highlight':
        set('#q-resource', action.highlight)
        break
      case 'set_click_rate':
        set('#q-resource', action.resource ?? '')
        set('#q-cps', String(action.cps))
        break
      case 'wait':
        set('#q-wait-cond', action.until.kind)
        paramsEl
          .querySelector<HTMLSelectElement>('#q-wait-cond')!
          .dispatchEvent(new Event('change'))
        if (action.until.kind === 'seconds') set('#q-wait-seconds', String(action.until.seconds))
        else {
          set('#q-wait-res', action.until.resource)
          set('#q-wait-amount', String(action.until.amount))
        }
        break
    }
  }

  // ── Build an action from the form; returns null + sets error on invalid ──
  function buildAction(): SimAction | null {
    formError.textContent = ''
    const kind = kindSelect.value as SimAction['kind']
    const val = (id: string): string =>
      paramsEl.querySelector<HTMLInputElement | HTMLSelectElement>(id)?.value ?? ''
    const fail = (msg: string): null => {
      formError.textContent = msg
      return null
    }

    switch (kind) {
      case 'buy':
      case 'buy_generator': {
        const count = Number(val('#q-count'))
        if (!Number.isInteger(count) || count < 1) return fail('Count must be a positive integer.')
        const id = kind === 'buy' ? val('#q-upgrade') : val('#q-generator')
        if (!id) return fail('Select a target.')
        return kind === 'buy' ? { kind, upgradeId: id, count } : { kind, generatorId: id, count }
      }
      case 'set_highlight': {
        const res = val('#q-resource')
        if (!res) return fail('Select a resource.')
        return { kind, highlight: res }
      }
      case 'set_click_rate': {
        const cps = Number(val('#q-cps'))
        if (!Number.isFinite(cps) || cps < 0 || cps > MAX_CPS)
          return fail(`cps must be 0–${MAX_CPS}.`)
        const res = val('#q-resource')
        return { kind, cps, ...(res ? { resource: res } : {}) }
      }
      case 'wait': {
        if (val('#q-wait-cond') === 'seconds') {
          const seconds = Number(val('#q-wait-seconds'))
          if (!(seconds > 0)) return fail('Seconds must be positive.')
          return { kind, until: { kind: 'seconds', seconds } }
        }
        const amount = Number(val('#q-wait-amount'))
        const resource = val('#q-wait-res')
        if (!resource) return fail('Select a resource.')
        if (!(amount > 0)) return fail('Amount must be positive.')
        return { kind, until: { kind: 'resource_at_least', resource, amount } }
      }
    }
  }

  // ── Wiring ──
  kindSelect.addEventListener('change', renderParams)

  nameInput.addEventListener('input', () => {
    current().name = nameInput.value
    renderList()
  })

  addBtn.addEventListener('click', () => {
    const action = buildAction()
    if (!action) return
    if (editingRow === null) current().actions.push(action)
    else {
      current().actions[editingRow] = action
      editingRow = null
    }
    renderAll()
  })

  cancelEditBtn.addEventListener('click', () => {
    editingRow = null
    renderEditor()
  })

  pane.querySelector<HTMLButtonElement>('#q-new')!.addEventListener('click', () => {
    strategies.push(makeEmptyStrategy(`Strategy ${strategies.length + 1}`, MODE))
    selected = strategies.length - 1
    runChecked.add(selected)
    editingRow = null
    renderAll()
  })

  pane.querySelector<HTMLButtonElement>('#q-dup')!.addEventListener('click', () => {
    strategies.push(cloneStrategy(current(), `${current().name} (copy)`))
    selected = strategies.length - 1
    runChecked.add(selected)
    editingRow = null
    renderAll()
  })

  pane.querySelector<HTMLButtonElement>('#q-del')!.addEventListener('click', () => {
    if (strategies.length === 1) return // keep at least one
    strategies.splice(selected, 1)
    runChecked.clear()
    strategies.forEach((_, i) => runChecked.add(i))
    selected = Math.max(0, selected - 1)
    editingRow = null
    renderAll()
  })

  function setStatus(msg: string, isError = false): void {
    ioStatus.textContent = msg
    ioStatus.classList.toggle('error', isError)
  }

  pane.querySelector<HTMLButtonElement>('#q-save')!.addEventListener('click', () => {
    const strategy = current()
    setStatus('')
    saveStrategyToFile(strategy).then(
      () => {
        setStatus(`Saved "${strategy.name}".`)
      },
      (err: unknown) => {
        setStatus(`Save failed: ${errText(err)}`, true)
      },
    )
  })

  pane.querySelector<HTMLButtonElement>('#q-load')!.addEventListener('click', () => {
    setStatus('')
    loadStrategyFromFile().then(
      (loaded) => {
        if (!loaded) return // cancelled
        // Compare as strings: `GameMode` is a single-member union today, so a
        // typed `!==` would be flagged as an always-false comparison.
        const loadedMode: string = loaded.mode
        if (loadedMode !== (MODE as string)) {
          setStatus(`Strategy is for mode "${loadedMode}"; this panel runs "${MODE}".`, true)
          return
        }
        strategies.push(loaded)
        selected = strategies.length - 1
        runChecked.add(selected)
        editingRow = null
        renderAll()
        const issues = validateStrategyForMode(loaded, mode)
        setStatus(
          issues.length
            ? `Loaded "${loaded.name}" with ${issues.length} issue(s) — see Run report.`
            : `Loaded "${loaded.name}".`,
          issues.length > 0,
        )
      },
      (err: unknown) => {
        setStatus(`Load failed: ${errText(err)}`, true)
      },
    )
  })

  pane.querySelector<HTMLButtonElement>('#q-run')!.addEventListener('click', () => {
    const toRun = strategies.filter((_, i) => runChecked.has(i))
    if (toRun.length === 0) return
    runStrategies(toRun, mode, buildGoal(), chartsEl, reportEl, envelopeEl, collapsedCharts)
  })

  // Accept strategies handed over from other tabs (e.g. Live export): append,
  // select, and check it for the next run. Drain anything buffered before mount.
  const acceptImport = (strategy: QueueStrategy): void => {
    strategies.push(strategy)
    selected = strategies.length - 1
    runChecked.add(selected)
    editingRow = null
    renderAll()
  }
  pendingImports.splice(0).forEach(acceptImport)
  queueImportSink = acceptImport

  renderAll()
}

// ─── Run + render ────────────────────────────────────────────────────

function runStrategies(
  toRun: QueueStrategy[],
  mode: ModeDefinition,
  goal: SimGoal,
  chartsEl: HTMLDivElement,
  reportEl: HTMLDivElement,
  envelopeEl: HTMLDivElement,
  collapsed: Set<string>,
): void {
  const results: SimResult[] = []
  const problems: { name: string; issues: string[] }[] = []
  for (const s of toRun) {
    const issues = validateStrategyForMode(s, mode)
    if (issues.length > 0) {
      problems.push({ name: s.name, issues })
      continue
    }
    results.push(simulate(s, { modeDef: mode, goal }))
  }

  renderCharts(results, mode, chartsEl, collapsed, envelopeBand(MODE, goal))
  renderReport(results, goal, problems, reportEl)
  renderEnvelopeSection(MODE, results, goal, envelopeEl)
}

function markersFor(result: SimResult): ChartMarker[] {
  return result.events
    .filter((e) => e.kind === 'buy' || e.kind === 'buy_generator' || e.kind === 'set_highlight')
    .map((e) => ({ x: e.timeSec, label: e.label }))
}

/** Cumulative count of upgrade/generator purchases at each snapshot time. */
function cumulativePurchases(result: SimResult, xData: number[]): number[] {
  const times = result.events
    .filter((e) => e.kind === 'buy' || e.kind === 'buy_generator')
    .map((e) => e.timeSec)
    .sort((a, b) => a - b)
  let idx = 0
  return xData.map((x) => {
    while (idx < times.length && times[idx] <= x) idx++
    return idx
  })
}

/**
 * One labeled dot per purchase, sitting on the cumulative line (y = the running
 * count after that buy). The label is the bought upgrade/generator's flavor
 * name (falling back to its id).
 */
function purchasePoints(result: SimResult, mode: ModeDefinition): ChartPoint[] {
  const flavor = getModeFlavor(mode)
  const upName = new Map(flavor.upgrades.map((u) => [u.id, u.name]))
  const genName = new Map(flavor.generators.map((g) => [g.id, g.name]))
  return result.events
    .filter((e) => e.kind === 'buy' || e.kind === 'buy_generator')
    .sort((a, b) => a.timeSec - b.timeSec)
    .map((e, i) => {
      const id = e.label.replace(/^[^:]*:/, '')
      const name = e.kind === 'buy' ? (upName.get(id) ?? id) : (genName.get(id) ?? id)
      return { x: e.timeSec, y: i + 1, label: name }
    })
}

function renderCharts(
  results: SimResult[],
  mode: ModeDefinition,
  container: HTMLDivElement,
  collapsed: Set<string>,
  scoreBand?: ChartBand,
): void {
  container.innerHTML = ''
  if (results.length === 0) return
  // The x-axis must span the LONGEST-running strategy (uPlot sizes every series
  // to xData's length), otherwise shorter-first ordering would clip the others.
  const longest = results.reduce((a, b) => (b.snapshots.length > a.snapshots.length ? b : a))
  const xData = longest.snapshots.map((s) => s.timeSec)
  const cards: HTMLElement[] = []

  // "Collapse all / Expand all" toolbar.
  const toolbar = document.createElement('section')
  toolbar.className = 'q-charts-toolbar'
  const collapseAllBtn = document.createElement('button')
  collapseAllBtn.className = 'q-collapse-all'
  toolbar.appendChild(collapseAllBtn)
  container.appendChild(toolbar)

  const syncCollapseAll = (): void => {
    const allCollapsed = cards.length > 0 && cards.every((c) => c.classList.contains('collapsed'))
    collapseAllBtn.textContent = allCollapsed ? '▸ Expand all' : '▾ Collapse all'
  }

  // Build one collapsible chart card. The chart is rendered while visible so
  // uPlot measures the right width; collapse is applied afterward.
  const addCard = (title: string, series: ChartSeries[], band?: ChartBand): void => {
    const card = document.createElement('section')
    card.className = 'q-chart-card'
    card.dataset.title = title

    const head = document.createElement('button')
    head.className = 'q-chart-head'
    head.innerHTML = '<span class="q-caret" aria-hidden="true">▾</span>'
    head.append(document.createTextNode(` ${title}`))

    const body = document.createElement('div')
    body.className = 'q-chart-body'

    card.append(head, body)
    container.appendChild(card)
    cards.push(card)

    renderChart(body, title, xData, series, band)

    const setCollapsed = (v: boolean): void => {
      card.classList.toggle('collapsed', v)
      head.setAttribute('aria-expanded', String(!v))
      if (v) collapsed.add(title)
      else collapsed.delete(title)
      syncCollapseAll()
    }
    setCollapsed(collapsed.has(title))
    head.addEventListener('click', () => {
      setCollapsed(!card.classList.contains('collapsed'))
    })
  }

  collapseAllBtn.addEventListener('click', () => {
    const shouldCollapse = !cards.every((c) => c.classList.contains('collapsed'))
    for (const card of cards) {
      const title = card.dataset.title ?? ''
      card.classList.toggle('collapsed', shouldCollapse)
      card.querySelector('.q-chart-head')?.setAttribute('aria-expanded', String(!shouldCollapse))
      if (shouldCollapse) collapsed.add(title)
      else collapsed.delete(title)
    }
    syncCollapseAll()
  })

  const flavorRes = getModeFlavor(mode).resources
  const resName = (key: string): string => flavorRes.find((r) => r.key === key)?.displayName ?? key

  addCard(
    'Score',
    results.map((r) => ({
      label: r.name,
      data: r.snapshots.map((s) => s.score),
      markers: markersFor(r),
    })),
    scoreBand,
  )

  // Cumulative upgrade/generator purchases over time. The step line shows the
  // pace of buying; each labeled dot marks a specific purchase (hover to see
  // what was bought and when).
  addCard(
    'Purchases',
    results.map((r) => ({
      label: r.name,
      data: cumulativePurchases(r, xData),
      points: purchasePoints(r, mode),
    })),
  )

  for (const resKey of mode.resources) {
    addCard(
      `${resName(resKey)} Balance`,
      results.map((r) => ({
        label: r.name,
        data: r.snapshots.map((s) => s.resources[resKey] ?? 0),
        markers: markersFor(r),
      })),
    )
    addCard(
      `${resName(resKey)}/sec`,
      results.map((r) => ({
        label: r.name,
        data: r.snapshots.map((s) => s.incomePerSec[resKey] ?? 0),
        markers: markersFor(r),
      })),
    )
  }

  syncCollapseAll()
}

function renderReport(
  results: SimResult[],
  goal: SimGoal,
  problems: { name: string; issues: string[] }[],
  container: HTMLDivElement,
): void {
  let html = ''

  if (problems.length > 0) {
    html += '<div class="q-problems">'
    for (const p of problems) {
      html += `<div>⚠️ <strong>${escapeHtml(p.name)}</strong>: ${p.issues.map(escapeHtml).join('; ')}</div>`
    }
    html += '</div>'
  }

  const endSec = (r: SimResult): number => r.snapshots.at(-1)?.timeSec ?? 0

  if (results.length > 0) {
    const best = Math.max(...results.map((r) => r.finalScore))
    // Timed: rank by score. Score/race: goal-reachers first, then fastest time.
    const sorted = [...results].sort((a, b) => {
      if (goal.kind === 'timed') return b.finalScore - a.finalScore
      if (a.goalReached !== b.goalReached) return a.goalReached ? -1 : 1
      return endSec(a) - endSec(b)
    })
    html += `
      <table class="q-report-table">
        <thead>
          <tr><th>Strategy</th><th>Score</th><th>% Best</th><th>Time (s)</th><th>Actions fired</th><th>Not reached</th></tr>
        </thead>
        <tbody>`
    for (const r of sorted) {
      const pct = best > 0 ? ((r.finalScore / best) * 100).toFixed(0) : '0'
      const time = r.goalReached ? endSec(r).toFixed(1) : `${endSec(r).toFixed(1)} (cap)`
      const notReached =
        r.notReached.length === 0
          ? '—'
          : r.notReached.map((n) => `#${n.index + 1} ${n.action.kind} (${n.reason})`).join(', ')
      // Count distinct queue rows that fired, not per-unit events (a `count: N`
      // buy emits N events but is one authored action).
      const actionsFired = new Set(r.events.map((e) => e.index)).size
      html += `
        <tr>
          <td>${escapeHtml(r.name)}</td>
          <td>${r.finalScore.toFixed(1)}</td>
          <td>${pct}%</td>
          <td>${escapeHtml(time)}</td>
          <td>${actionsFired}</td>
          <td class="q-notreached">${escapeHtml(notReached)}</td>
        </tr>`
    }
    html += '</tbody></table>'
  }

  container.innerHTML = html || '<p class="q-hint">Select strategies and press Run.</p>'
}

// ─── Static markup ───────────────────────────────────────────────────

function optionsHtml(opts: Option[], includeBlank?: string): string {
  const blank = includeBlank ? `<option value="">${includeBlank}</option>` : ''
  return (
    blank +
    opts
      .map((o) => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</option>`)
      .join('')
  )
}

function paramsHtml(kind: SimAction['kind'], mode: ModeDefinition): string {
  switch (kind) {
    case 'buy':
      return `
        <label>Upgrade <select id="q-upgrade">${optionsHtml(upgradeOptions(mode))}</select></label>
        <label>Count <input id="q-count" type="number" min="1" step="1" value="1" /></label>`
    case 'buy_generator':
      return `
        <label>Generator <select id="q-generator">${optionsHtml(generatorOptions(mode))}</select></label>
        <label>Count <input id="q-count" type="number" min="1" step="1" value="1" /></label>`
    case 'set_highlight':
      return `<label>Resource <select id="q-resource">${optionsHtml(resourceOptions(mode))}</select></label>`
    case 'set_click_rate':
      return `
        <label>Resource <select id="q-resource">${optionsHtml(resourceOptions(mode), 'score (default)')}</select></label>
        <label>cps <input id="q-cps" type="number" min="0" max="${MAX_CPS}" step="1" value="10" /></label>`
    case 'wait':
      return `
        <label>Until
          <select id="q-wait-cond">
            <option value="seconds">seconds elapsed</option>
            <option value="resource_at_least">resource ≥ amount</option>
          </select>
        </label>
        <span id="q-wait-seconds-wrap"><label>Seconds <input id="q-wait-seconds" type="number" min="0" step="0.5" value="5" /></label></span>
        <span id="q-wait-res-wrap" class="hidden">
          <label>Resource <select id="q-wait-res">${optionsHtml(resourceOptions(mode))}</select></label>
          <label>Amount <input id="q-wait-amount" type="number" min="0" step="1" value="100" /></label>
        </span>`
  }
}

function layout(): string {
  return `
    <section class="dev-controls">
      <button id="q-new">＋ New</button>
      <button id="q-dup">⧉ Duplicate</button>
      <button id="q-del">🗑 Delete</button>
      <button id="q-save">💾 Save</button>
      <button id="q-load">📂 Load</button>
      <label class="q-goal-label">Goal
        <select id="q-goal">
          <option value="race_to_buy" selected>Race to buy</option>
          <option value="timed">Timed</option>
          <option value="score">Score</option>
        </select>
      </label>
      <label class="q-goal-field" id="q-goal-time-wrap">Seconds
        <input id="q-goal-time" type="number" min="1" step="1" />
      </label>
      <label class="q-goal-field hidden" id="q-goal-score-wrap">Score
        <input id="q-goal-score" type="number" min="1" step="1" />
      </label>
      <span class="q-goal-hint hidden" id="q-goal-race-hint">Ends when the goal upgrade can be bought.</span>
      <button id="q-run">▶ Run</button>
      <span id="q-io-status" class="q-io-status"></span>
    </section>
    <div class="q-layout">
      <aside class="q-sidebar">
        <h3>Strategies</h3>
        <div id="q-list"></div>
      </aside>
      <div class="q-editor">
        <label class="q-name-label">Name <input id="q-name" type="text" /></label>
        <table class="q-table">
          <thead>
            <tr><th>#</th><th>Kind</th><th>Target</th><th>Params</th><th></th></tr>
          </thead>
          <tbody id="q-rows"></tbody>
        </table>
        <div class="q-form">
          <select id="q-kind"></select>
          <div id="q-params" class="q-params"></div>
          <button id="q-add">Add action</button>
          <button id="q-cancel-edit" class="hidden">Cancel</button>
          <div id="q-form-error" class="q-form-error"></div>
        </div>
      </div>
    </div>
    <section class="dev-charts" id="q-charts"></section>
    <section class="dev-report"><h2>Run Report</h2><div id="q-report"></div></section>
    <section class="dev-envelope"><h2>Balance Envelope</h2><div id="q-envelope"></div></section>
  `
}

/** Concise message from an unknown thrown value (ZodError, SyntaxError, …). */
function errText(err: unknown): string {
  if (err instanceof Error) return err.message.split('\n')[0]
  return String(err)
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
