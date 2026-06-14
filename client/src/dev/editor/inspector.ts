/**
 * Editor inspector — a static-field form for the selected node. Mutates the
 * node in place and calls `onChange` after each edit so the host can re-render
 * the canvas and mark the document dirty.
 *
 * Covers the data-only fields (id, cost, purchaseLimit, modifiers,
 * prerequisites, choice group) plus dynamic `effects`, whose forms are
 * generated from each registered effect's zod param schema.
 */

import { listEffectTypes, resolveEffect, type TreeUpgradeNode } from '@game/shared'

import {
  defaultParamsForEffect,
  defaultParamsForVariant,
  describeEffectSchema,
  matchVariant,
  type EffectFormSpec,
  type FieldSpec,
} from './effect-schema.js'

export interface InspectorContext {
  readonly node: TreeUpgradeNode
  /** All node ids in the tree (for the prerequisite checklist). */
  readonly allIds: readonly string[]
  /** Selectable cost currencies (the tree's resources), with display labels. */
  readonly currencies: readonly Currency[]
  /** The node's current layout parent id, or `null` if it's a root. */
  readonly parentId: string | null
  /** Ids that can't be the node's parent (itself + its descendants). */
  readonly descendantIds: readonly string[]
  /** Re-parent the node (or make it a root when `null`). */
  readonly onReparent: (parentId: string | null) => void
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
type EffectEntry = NonNullable<TreeUpgradeNode['effects']>[number]

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

function buildParentSection(ctx: InspectorContext): HTMLElement {
  const select = el('select', 'ed-input')
  const root = el('option', undefined, '(root)')
  root.value = ''
  if (ctx.parentId === null) root.selected = true
  select.append(root)

  // Exclude the node itself and its descendants — those would make a cycle.
  const excluded = new Set(ctx.descendantIds)
  for (const id of ctx.allIds) {
    if (excluded.has(id)) continue
    const opt = el('option', undefined, id)
    opt.value = id
    if (id === ctx.parentId) opt.selected = true
    select.append(opt)
  }

  select.addEventListener('change', () => {
    ctx.onReparent(select.value === '' ? null : select.value)
  })

  const wrap = field('Parent', select)
  wrap.append(
    el('p', 'ed-hint', 'Reparenting keeps the node in place; it then moves with its parent.'),
  )
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

// ─── Effects ─────────────────────────────────────────────────────────
//
// Each registered effect carries a zod param schema; its form is generated
// from that schema. Only registered effect types are offered or editable.

/** zod's `safeParse` is all this section needs from a resolved effect schema. */
interface ScalarSchema {
  safeParse(value: unknown): { success: boolean; error?: { issues: { message: string }[] } }
}

function paramsOf(ref: EffectEntry): Record<string, unknown> {
  return Object.fromEntries(Object.entries(ref).filter(([key]) => key !== 'type'))
}

function buildEffectField(
  spec: FieldSpec,
  current: unknown,
  onChange: () => void,
): { row: HTMLElement; read: () => unknown } {
  const label = spec.optional ? `${spec.key} (optional)` : spec.key
  if (spec.kind === 'boolean') {
    const input = el('input', 'ed-input ed-effect-check')
    input.type = 'checkbox'
    input.checked = current === true || (current === undefined && spec.defaultValue === true)
    input.addEventListener('change', onChange)
    return { row: field(label, input), read: () => input.checked }
  }
  const input = el('input', 'ed-input')
  input.type = spec.kind === 'number' ? 'number' : 'text'
  const initial = current ?? spec.defaultValue
  if (typeof initial === 'number' || typeof initial === 'string' || typeof initial === 'boolean') {
    input.value = String(initial)
  }
  input.addEventListener('change', onChange)
  const read = (): unknown => {
    const raw = input.value.trim()
    if (raw === '') return undefined
    return spec.kind === 'number' ? Number(raw) : raw
  }
  return { row: field(label, input), read }
}

function buildEffectBlock(
  ctx: InspectorContext,
  ref: EffectEntry,
  index: number,
  setEffects: (next: EffectEntry[]) => void,
  rerender: () => void,
): HTMLElement {
  const block = el('div', 'ed-effect')
  const header = el('div', 'ed-effect-header ed-row')
  header.append(el('strong', 'ed-effect-type', ref.type))
  const remove = el('button', 'ed-btn ed-btn-remove', '✕')
  remove.type = 'button'
  remove.addEventListener('click', () => {
    setEffects((ctx.node.effects ?? []).filter((_, j) => j !== index))
    rerender()
  })
  header.append(remove)
  block.append(header)

  const def = resolveEffect(ref.type)
  if (!def) {
    block.append(el('p', 'ed-hint', 'Unknown effect type — not editable.'))
    return block
  }
  let spec: EffectFormSpec
  try {
    spec = describeEffectSchema(def.schema)
  } catch {
    block.append(el('p', 'ed-hint', 'Effect schema not editable.'))
    return block
  }
  const schema: ScalarSchema = def.schema

  let params = paramsOf(ref)
  let variant = matchVariant(spec, params)
  const fieldsWrap = el('div', 'ed-fields')
  const error = el('p', 'ed-error')

  const writeFrom = (values: Record<string, unknown>, silent = false): void => {
    const result = schema.safeParse(values)
    if (!result.success) {
      error.textContent = silent ? '' : (result.error?.issues[0]?.message ?? 'Invalid params')
      return
    }
    error.textContent = ''
    setEffects(
      (ctx.node.effects ?? []).map((r, j) => (j === index ? { type: ref.type, ...values } : r)),
    )
  }

  const buildFields = (): void => {
    fieldsWrap.replaceChildren()
    const reads = new Map<string, () => unknown>()
    const collect = (): Record<string, unknown> => {
      const out: Record<string, unknown> = {}
      for (const [key, read] of reads) {
        const value = read()
        if (value !== undefined) out[key] = value
      }
      return out
    }
    for (const fieldSpec of variant.fields) {
      const { row, read } = buildEffectField(fieldSpec, params[fieldSpec.key], () => {
        writeFrom(collect())
      })
      reads.set(fieldSpec.key, read)
      fieldsWrap.append(row)
    }
  }
  buildFields()

  if (spec.variants.length > 1) {
    const variantSelect = el('select', 'ed-input')
    for (const option of spec.variants) {
      const opt = el('option', undefined, option.label)
      opt.value = String(option.index)
      if (option.index === variant.index) opt.selected = true
      variantSelect.append(opt)
    }
    variantSelect.addEventListener('change', () => {
      const picked = spec.variants.find((v) => v.index === Number(variantSelect.value))
      if (!picked) return
      variant = picked
      params = defaultParamsForVariant(picked)
      buildFields()
      // Seeded defaults for a stricter variant (e.g. an empty required id) may
      // not parse yet; persist if valid but don't flash an error before the
      // user has touched the new fields.
      writeFrom(params, true)
    })
    block.append(field('Shape', variantSelect))
  }

  block.append(fieldsWrap, error)
  return block
}

function buildEffectsSection(ctx: InspectorContext): HTMLElement {
  const section = el('div', 'ed-section')
  section.append(el('h4', 'ed-section-title', 'Effects'))
  const rows = el('div', 'ed-rows')

  const setEffects = (next: EffectEntry[]): void => {
    ctx.node.effects = next.length > 0 ? next : undefined
    ctx.onChange()
  }

  const render = (): void => {
    rows.replaceChildren()
    const effects = ctx.node.effects ?? []
    effects.forEach((ref, index) => {
      rows.append(buildEffectBlock(ctx, ref, index, setEffects, render))
    })
  }
  render()

  const types = listEffectTypes()
  const addSelect = el('select', 'ed-input')
  for (const type of types) {
    const opt = el('option', undefined, type)
    opt.value = type
    addSelect.append(opt)
  }
  const add = el('button', 'ed-btn', '+ effect')
  add.type = 'button'
  add.disabled = types.length === 0
  add.addEventListener('click', () => {
    const def = resolveEffect(addSelect.value)
    if (!def) return
    let spec: EffectFormSpec
    try {
      spec = describeEffectSchema(def.schema)
    } catch {
      return
    }
    const schema: ScalarSchema = def.schema
    const params = defaultParamsForEffect(spec, (p) => schema.safeParse(p).success)
    setEffects([...(ctx.node.effects ?? []), { type: addSelect.value, ...params }])
    render()
  })

  const addRow = el('div', 'ed-row')
  addRow.append(addSelect, add)
  section.append(rows, addRow)
  return section
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
    buildParentSection(ctx),
    buildCostSection(ctx),
    buildPurchaseLimitSection(ctx),
    buildModifiersSection(ctx),
    buildPrerequisitesSection(ctx),
    buildEffectsSection(ctx),
    buildChoiceSection(ctx),
  )
}

/** Render an empty-state placeholder when no node is selected. */
export function renderInspectorEmpty(container: HTMLElement): void {
  container.innerHTML = '<p class="ed-empty">Select a node to edit it.</p>'
}
