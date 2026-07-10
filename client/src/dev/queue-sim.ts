/**
 * Queue Simulation tab — author a strategy as an ordered action queue (no
 * timestamps), run it through the shared `simulate()` engine, and chart the
 * result with action markers + a run report. See
 * docs/plans/23-timeline-strategy-simulation.md (phase 3).
 *
 * Save/load to files (phase 4) and the envelope overlay (phase 5) are not wired
 * here yet — strategies live in memory for the session.
 */

import { MAX_CPS, getModeFlavor, simulate, validateStrategyForMode } from '@game/shared'
import type { GameMode, ModeDefinition, QueueStrategy, SimAction, SimResult } from '@game/shared'

import { renderChart } from './chart.js'
import type { ChartMarker } from './chart.js'
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
  const strategies: QueueStrategy[] = [makeEmptyStrategy('Strategy 1', MODE)]
  let selected = 0
  const runChecked = new Set<number>([0])
  let editingRow: number | null = null

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
      item.append(cb, name)
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

  pane.querySelector<HTMLButtonElement>('#q-run')!.addEventListener('click', () => {
    const toRun = strategies.filter((_, i) => runChecked.has(i))
    if (toRun.length === 0) return
    runStrategies(toRun, mode, chartsEl, reportEl)
  })

  renderAll()
}

// ─── Run + render ────────────────────────────────────────────────────

function runStrategies(
  toRun: QueueStrategy[],
  mode: ModeDefinition,
  chartsEl: HTMLDivElement,
  reportEl: HTMLDivElement,
): void {
  const results: SimResult[] = []
  const problems: { name: string; issues: string[] }[] = []
  for (const s of toRun) {
    const issues = validateStrategyForMode(s, mode)
    if (issues.length > 0) {
      problems.push({ name: s.name, issues })
      continue
    }
    results.push(simulate(s, { modeDef: mode }))
  }

  renderCharts(results, mode, chartsEl)
  renderReport(results, problems, reportEl)
}

function markersFor(result: SimResult): ChartMarker[] {
  return result.events
    .filter((e) => e.kind === 'buy' || e.kind === 'buy_generator' || e.kind === 'set_highlight')
    .map((e) => ({ x: e.timeSec, label: e.label }))
}

function renderCharts(results: SimResult[], mode: ModeDefinition, container: HTMLDivElement): void {
  container.innerHTML = ''
  if (results.length === 0) return
  const xData = results[0].snapshots.map((s) => s.timeSec)

  const scoreDiv = document.createElement('div')
  container.appendChild(scoreDiv)
  renderChart(
    scoreDiv,
    'Score',
    xData,
    results.map((r) => ({
      label: r.name,
      data: r.snapshots.map((s) => s.score),
      markers: markersFor(r),
    })),
  )

  for (const resKey of mode.resources) {
    const resName =
      getModeFlavor(mode).resources.find((r) => r.key === resKey)?.displayName ?? resKey
    const balDiv = document.createElement('div')
    container.appendChild(balDiv)
    renderChart(
      balDiv,
      `${resName} Balance`,
      xData,
      results.map((r) => ({
        label: r.name,
        data: r.snapshots.map((s) => s.resources[resKey] ?? 0),
        markers: markersFor(r),
      })),
    )
  }
}

function renderReport(
  results: SimResult[],
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

  if (results.length > 0) {
    const best = Math.max(...results.map((r) => r.finalScore))
    html += `
      <table class="q-report-table">
        <thead>
          <tr><th>Strategy</th><th>Score</th><th>% Best</th><th>Actions fired</th><th>Not reached</th></tr>
        </thead>
        <tbody>`
    for (const r of [...results].sort((a, b) => b.finalScore - a.finalScore)) {
      const pct = best > 0 ? ((r.finalScore / best) * 100).toFixed(0) : '0'
      const notReached =
        r.notReached.length === 0
          ? '—'
          : r.notReached.map((n) => `#${n.index + 1} ${n.action.kind} (${n.reason})`).join(', ')
      html += `
        <tr>
          <td>${escapeHtml(r.name)}</td>
          <td>${r.finalScore.toFixed(1)}</td>
          <td>${pct}%</td>
          <td>${r.events.length}</td>
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
    blank + opts.map((o) => `<option value="${o.value}">${escapeHtml(o.label)}</option>`).join('')
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
      <button id="q-run">▶ Run</button>
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
  `
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
