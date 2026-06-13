/**
 * Editor inspector — a static-field form for the selected node. Mutates the
 * node in place and calls `onChange` after each edit so the host can re-render
 * the canvas and mark the document dirty.
 *
 * Covers the data-only fields (id, cost, purchaseLimit, modifiers,
 * prerequisites, choice group). Schema-driven dynamic-effect forms are a later
 * sub-phase; existing `effects` on a node are preserved untouched.
 */

import type { TreeUpgradeNode } from '@game/shared'

export interface InspectorContext {
  readonly node: TreeUpgradeNode
  /** All node ids in the tree (for the prerequisite checklist). */
  readonly allIds: readonly string[]
  /** Selectable cost currencies (the tree's resources), with display labels. */
  readonly currencies: readonly Currency[]
  /** Called after any edit that changes the working tree. */
  readonly onChange: () => void
}

/** A selectable cost currency: the stable resource `key` plus a display `label`. */
export interface Currency {
  readonly key: string
  readonly label: string
}

type Prereq = NonNullable<TreeUpgradeNode['prerequisites']>
type ModifierStage = TreeUpgradeNode['modifiers'][number]['stage']

const MODIFIER_STAGES: readonly ModifierStage[] = ['additive', 'multiplicative', 'global']

// ─── Prerequisite representability ───────────────────────────────────
//
// The simple editor models "all/any of N upgrade ids". Anything richer
// (minLevel, nested groups) round-trips through a raw-JSON textarea instead.

interface SimplePrereq {
  readonly mode: 'all' | 'any'
  readonly ids: string[]
}

function asSimplePrereq(prereq: Prereq | undefined): SimplePrereq | null {
  if (!prereq) return { mode: 'all', ids: [] }
  if (prereq.type === 'upgrade') {
    return prereq.minLevel === undefined ? { mode: 'all', ids: [prereq.id] } : null
  }
  const flat = prereq.items.every((i) => i.type === 'upgrade' && i.minLevel === undefined)
  if (!flat) return null
  return { mode: prereq.type, ids: prereq.items.map((i) => (i as { id: string }).id) }
}

function fromSimplePrereq(simple: SimplePrereq): Prereq | undefined {
  if (simple.ids.length === 0) return undefined
  if (simple.ids.length === 1) return { type: 'upgrade', id: simple.ids[0] }
  return { type: simple.mode, items: simple.ids.map((id) => ({ type: 'upgrade', id })) }
}

// ─── DOM helpers ─────────────────────────────────────────────────────

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function field(label: string, control: HTMLElement): HTMLDivElement {
  const row = el('div', 'ed-field')
  row.append(el('label', 'ed-field-label', label), control)
  return row
}

// ─── Section builders ────────────────────────────────────────────────

function buildIdSection(ctx: InspectorContext): HTMLElement {
  const input = el('input', 'ed-input')
  input.type = 'text'
  input.value = ctx.node.id
  input.addEventListener('change', () => {
    const next = input.value.trim()
    if (next) {
      ctx.node.id = next
      ctx.onChange()
    } else {
      input.value = ctx.node.id
    }
  })
  const wrap = field('ID', input)
  wrap.append(el('p', 'ed-hint', 'Renaming does not rewrite prerequisite references.'))
  return wrap
}

function buildCostSection(ctx: InspectorContext): HTMLElement {
  const section = el('div', 'ed-section')
  section.append(el('h4', 'ed-section-title', 'Cost'))
  const rows = el('div', 'ed-rows')
  const add = el('button', 'ed-btn', '+ currency')
  add.type = 'button'

  // The cost map is the model; rows are rebuilt from it after any structural
  // change (currency picked, row added/removed) so each dropdown can exclude
  // currencies already chosen in sibling rows — preventing duplicate keys that
  // would otherwise silently merge on save.
  const render = (): void => {
    rows.replaceChildren()
    const used = new Set(Object.keys(ctx.node.cost))
    for (const [key, amount] of Object.entries(ctx.node.cost)) {
      // Offer this row's own currency plus any not used by another row.
      const available = ctx.currencies.filter((c) => c.key === key || !used.has(c.key))
      rows.append(buildCostRow(ctx, key, amount, available, render))
    }
    // Disable adding when every currency is already in use (or none exist).
    const free = ctx.currencies.filter((c) => !used.has(c.key))
    add.disabled = free.length === 0
  }

  add.addEventListener('click', () => {
    const free = ctx.currencies.find((c) => !(c.key in ctx.node.cost))
    if (!free) return
    ctx.node.cost = { ...ctx.node.cost, [free.key]: 0 }
    ctx.onChange()
    render()
  })

  render()
  section.append(rows, add)
  return section
}

/**
 * A single cost row (currency dropdown + amount). Mutates `ctx.node.cost` in
 * place; structural edits (currency change, removal) call `rerender` so sibling
 * rows can refresh their available currencies.
 */
function buildCostRow(
  ctx: InspectorContext,
  key: string,
  amount: number,
  available: readonly Currency[],
  rerender: () => void,
): HTMLDivElement {
  const row = el('div', 'ed-cost-row ed-row')
  const keySelect = buildCurrencySelect(available, key)
  keySelect.classList.add('ed-cost-key')
  const amountInput = el('input', 'ed-input ed-cost-amount')
  amountInput.type = 'number'
  amountInput.value = String(amount)
  const remove = el('button', 'ed-btn ed-btn-remove', '✕')
  remove.type = 'button'

  // Renaming a currency: drop the old key, set the new one, then rebuild rows.
  keySelect.addEventListener('change', () => {
    const next: Record<string, number> = {}
    for (const [k, v] of Object.entries(ctx.node.cost)) next[k === key ? keySelect.value : k] = v
    ctx.node.cost = next
    ctx.onChange()
    rerender()
  })
  amountInput.addEventListener('change', () => {
    ctx.node.cost = { ...ctx.node.cost, [key]: Number(amountInput.value) }
    ctx.onChange()
  })
  remove.addEventListener('click', () => {
    ctx.node.cost = Object.fromEntries(Object.entries(ctx.node.cost).filter(([k]) => k !== key))
    ctx.onChange()
    rerender()
  })

  row.append(keySelect, amountInput, remove)
  return row
}

/**
 * A `<select>` of the given currencies. If `value` isn't among them (e.g. a
 * cost referencing a since-removed resource), it's added as an option so the
 * existing value is preserved rather than silently dropped.
 */
function buildCurrencySelect(currencies: readonly Currency[], value: string): HTMLSelectElement {
  const select = el('select', 'ed-input')
  const known = currencies.some((c) => c.key === value)
  const options = known || value === '' ? currencies : [{ key: value, label: value }, ...currencies]
  for (const { key, label } of options) {
    const opt = el('option', undefined, label)
    opt.value = key
    if (key === value) opt.selected = true
    select.append(opt)
  }
  return select
}

function buildPurchaseLimitSection(ctx: InspectorContext): HTMLElement {
  const unlimited = el('input')
  unlimited.type = 'checkbox'
  unlimited.checked = ctx.node.purchaseLimit === null
  const number = el('input', 'ed-input')
  number.type = 'number'
  number.min = '1'
  number.value = String(ctx.node.purchaseLimit ?? 1)
  number.disabled = unlimited.checked

  const sync = (): void => {
    ctx.node.purchaseLimit = unlimited.checked ? null : Math.max(1, Number(number.value) || 1)
    number.disabled = unlimited.checked
    ctx.onChange()
  }
  unlimited.addEventListener('change', sync)
  number.addEventListener('change', sync)

  const control = el('div', 'ed-row')
  const unlimitedLabel = el('label', 'ed-checkbox')
  unlimitedLabel.append(unlimited, document.createTextNode(' unlimited'))
  control.append(number, unlimitedLabel)
  return field('Purchase limit', control)
}

function buildModifiersSection(ctx: InspectorContext): HTMLElement {
  const section = el('div', 'ed-section')
  section.append(el('h4', 'ed-section-title', 'Modifiers'))
  const rows = el('div', 'ed-rows')

  const sync = (): void => {
    const next: TreeUpgradeNode['modifiers'] = []
    for (const row of rows.querySelectorAll<HTMLDivElement>('.ed-mod-row')) {
      const stage = row.querySelector<HTMLSelectElement>('.ed-mod-stage')!.value as ModifierStage
      const fieldName = row.querySelector<HTMLInputElement>('.ed-mod-field')!.value.trim()
      const value = Number(row.querySelector<HTMLInputElement>('.ed-mod-value')!.value)
      if (fieldName) next.push({ stage, field: fieldName, value })
    }
    ctx.node.modifiers = next
    ctx.onChange()
  }

  const addRow = (stage: ModifierStage, fieldName: string, value: number): void => {
    const row = el('div', 'ed-mod-row ed-row')
    const stageSelect = el('select', 'ed-input ed-mod-stage')
    for (const s of MODIFIER_STAGES) {
      const opt = el('option', undefined, s)
      opt.value = s
      if (s === stage) opt.selected = true
      stageSelect.append(opt)
    }
    const fieldInput = el('input', 'ed-input ed-mod-field')
    fieldInput.type = 'text'
    fieldInput.placeholder = 'field'
    fieldInput.value = fieldName
    const valueInput = el('input', 'ed-input ed-mod-value')
    valueInput.type = 'number'
    valueInput.value = String(value)
    const remove = el('button', 'ed-btn ed-btn-remove', '✕')
    remove.type = 'button'
    remove.addEventListener('click', () => {
      row.remove()
      sync()
    })
    stageSelect.addEventListener('change', sync)
    fieldInput.addEventListener('change', sync)
    valueInput.addEventListener('change', sync)
    row.append(stageSelect, fieldInput, valueInput, remove)
    rows.append(row)
  }

  for (const m of ctx.node.modifiers) addRow(m.stage, m.field, m.value)

  const add = el('button', 'ed-btn', '+ modifier')
  add.type = 'button'
  add.addEventListener('click', () => {
    addRow('additive', '', 0)
  })
  section.append(rows, add)
  return section
}

function buildPrerequisitesSection(ctx: InspectorContext): HTMLElement {
  const section = el('div', 'ed-section')
  section.append(el('h4', 'ed-section-title', 'Prerequisites'))

  const simple = asSimplePrereq(ctx.node.prerequisites)
  if (!simple) {
    section.append(buildPrereqJsonFallback(ctx))
    return section
  }

  const modeSelect = el('select', 'ed-input')
  for (const mode of ['all', 'any'] as const) {
    const opt = el('option', undefined, mode === 'all' ? 'all of' : 'any of')
    opt.value = mode
    if (mode === simple.mode) opt.selected = true
    modeSelect.append(opt)
  }
  const checklist = el('div', 'ed-checklist')

  const sync = (): void => {
    const ids: string[] = []
    for (const box of checklist.querySelectorAll<HTMLInputElement>('input:checked')) {
      ids.push(box.value)
    }
    ctx.node.prerequisites = fromSimplePrereq({ mode: modeSelect.value as 'all' | 'any', ids })
    ctx.onChange()
  }
  modeSelect.addEventListener('change', sync)

  const selected = new Set(simple.ids)
  for (const id of ctx.allIds) {
    if (id === ctx.node.id) continue
    const item = el('label', 'ed-checklist-item')
    const box = el('input')
    box.type = 'checkbox'
    box.value = id
    box.checked = selected.has(id)
    box.addEventListener('change', sync)
    item.append(box, document.createTextNode(` ${id}`))
    checklist.append(item)
  }

  section.append(field('Require', modeSelect), checklist)
  return section
}

function buildPrereqJsonFallback(ctx: InspectorContext): HTMLElement {
  const wrap = el('div')
  wrap.append(el('p', 'ed-hint', 'Advanced prerequisite (nested or min-level) — edit as JSON.'))
  const textarea = el('textarea', 'ed-input ed-json')
  textarea.rows = 5
  textarea.value = JSON.stringify(ctx.node.prerequisites, null, 2)
  const error = el('p', 'ed-error')
  textarea.addEventListener('change', () => {
    try {
      ctx.node.prerequisites = JSON.parse(textarea.value) as Prereq
      error.textContent = ''
      ctx.onChange()
    } catch {
      error.textContent = 'Invalid JSON'
    }
  })
  wrap.append(textarea, error)
  return wrap
}

function buildChoiceSection(ctx: InspectorContext): HTMLElement {
  const section = el('div', 'ed-section')
  section.append(el('h4', 'ed-section-title', 'Choice group'))

  const groupInput = el('input', 'ed-input')
  groupInput.type = 'text'
  groupInput.placeholder = 'group id (optional)'
  groupInput.value = ctx.node.choiceGroup ?? ''
  const labelInput = el('input', 'ed-input')
  labelInput.type = 'text'
  labelInput.placeholder = 'label (optional)'
  labelInput.value = ctx.node.choiceLabel ?? ''

  const sync = (): void => {
    const group = groupInput.value.trim()
    const label = labelInput.value.trim()
    if (group) ctx.node.choiceGroup = group
    else delete ctx.node.choiceGroup
    if (label) ctx.node.choiceLabel = label
    else delete ctx.node.choiceLabel
    ctx.onChange()
  }
  groupInput.addEventListener('change', sync)
  labelInput.addEventListener('change', sync)

  section.append(field('Group', groupInput), field('Label', labelInput))
  return section
}

// ─── Entry point ─────────────────────────────────────────────────────

/** Render the inspector for the selected node into `container`. */
export function renderInspector(container: HTMLElement, ctx: InspectorContext): void {
  container.innerHTML = ''
  container.append(
    buildIdSection(ctx),
    buildCostSection(ctx),
    buildPurchaseLimitSection(ctx),
    buildModifiersSection(ctx),
    buildPrerequisitesSection(ctx),
    buildChoiceSection(ctx),
  )
}

/** Render an empty-state placeholder when no node is selected. */
export function renderInspectorEmpty(container: HTMLElement): void {
  container.innerHTML = '<p class="ed-empty">Select a node to edit it.</p>'
}
