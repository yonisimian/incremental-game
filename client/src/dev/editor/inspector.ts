/**
 * Editor inspector — a static-field form for the selected node. Mutates the
 * node in place and calls `onChange` after each edit so the host can re-render
 * the canvas and mark the document dirty.
 *
 * Covers the data-only fields (id, cost, purchaseLimit, prerequisites, choice
 * group) plus dynamic `effects`, whose forms are generated from each registered
 * effect's zod param schema (production bonuses are the `baseModifier` effect).
 */

import { type CostEntry, type TreeFile, type TreeUpgradeNode } from '@game/shared'

import { buildEffectsSection } from './effects-editor.js'
import { findNode, nodeFlavor, renameNode, setNodeFlavor } from './model.js'

export interface InspectorContext {
  readonly tree: TreeFile
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

// ─── Prerequisite representability ───────────────────────────────────
//
// The simple editor models "all/any of N upgrade ids", each with an optional
// minimum level. Anything richer (nested groups) round-trips through a
// raw-JSON textarea instead.

/** A single required upgrade. `minLevel` of 1 (or omitted) means "owned". */
interface SimplePrereqItem {
  readonly id: string
  readonly minLevel?: number
}

export interface SimplePrereq {
  readonly mode: 'all' | 'any'
  readonly items: SimplePrereqItem[]
}

export function asSimplePrereq(prereq: Prereq | undefined): SimplePrereq | null {
  if (!prereq) return { mode: 'all', items: [] }
  if (prereq.type === 'upgrade') {
    return { mode: 'all', items: [{ id: prereq.id, minLevel: prereq.minLevel }] }
  }
  const flat = prereq.items.every((i) => i.type === 'upgrade')
  if (!flat) return null
  return {
    mode: prereq.type,
    items: prereq.items.map((i) => {
      const u = i as { id: string; minLevel?: number }
      return { id: u.id, minLevel: u.minLevel }
    }),
  }
}

export function fromSimplePrereq(simple: SimplePrereq): Prereq | undefined {
  // A minLevel of 1 is the default ("owned"), so drop it to keep the JSON terse.
  const toExpr = (item: SimplePrereqItem): Prereq =>
    item.minLevel !== undefined && item.minLevel > 1
      ? { type: 'upgrade', id: item.id, minLevel: item.minLevel }
      : { type: 'upgrade', id: item.id }
  if (simple.items.length === 0) return undefined
  if (simple.items.length === 1) return toExpr(simple.items[0])
  return { type: simple.mode, items: simple.items.map(toExpr) }
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
    if (next !== ctx.node.id && renameNode(ctx.tree, ctx.node.id, next)) {
      ctx.onChange()
    } else {
      input.value = ctx.node.id
    }
  })
  return field('ID', input)
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

function buildCostSection(ctx: InspectorContext): { element: HTMLElement; refresh: () => void } {
  const section = el('div', 'ed-section')
  section.append(el('h4', 'ed-section-title', 'Cost'))
  const rows = el('div', 'ed-rows')
  const add = el('button', 'ed-btn', '+ currency')
  add.type = 'button'

  // Column titles aligned with the cost-row controls below (shared grid).
  const header = el('div', 'ed-cost-row ed-cost-header')
  header.append(
    el('span', 'ed-cost-th', 'Currency'),
    el('span', 'ed-cost-th', 'Cost'),
    el('span', 'ed-cost-th', 'Scaling'),
    el('span', 'ed-cost-th', 'Factor'),
    el('span', 'ed-cost-th'),
  )

  // The cost map is the model; rows are rebuilt from it after any structural
  // change (currency picked, row added/removed) so each dropdown can exclude
  // currencies already chosen in sibling rows — preventing duplicate keys that
  // would otherwise silently merge on save.
  const render = (): void => {
    rows.replaceChildren()
    const used = new Set(Object.keys(ctx.node.cost))
    if (used.size > 0) rows.append(header)
    for (const [key, entry] of Object.entries(ctx.node.cost)) {
      // Offer this row's own currency plus any not used by another row.
      const available = ctx.currencies.filter((c) => c.key === key || !used.has(c.key))
      rows.append(buildCostRow(ctx, key, entry, available, render))
    }
    // Disable adding when every currency is already in use (or none exist).
    const free = ctx.currencies.filter((c) => !used.has(c.key))
    add.disabled = free.length === 0
  }

  add.addEventListener('click', () => {
    const free = ctx.currencies.find((c) => !(c.key in ctx.node.cost))
    if (!free) return
    ctx.node.cost = { ...ctx.node.cost, [free.key]: { baseCost: 0 } }
    ctx.onChange()
    render()
  })

  render()
  section.append(rows, add)
  section.append(
    el(
      'p',
      'ed-hint',
      'Each currency has an optional per-level scaling: Flat (constant), Linear (baseCost + factor·level), or Exponential (baseCost·factor^level). Level-0 price is the base above. One-shot upgrades (purchase limit 1) ignore scaling.',
    ),
  )
  return { element: section, refresh: render }
}

/**
 * A single cost row: currency dropdown + level-0 base + per-currency scaling
 * (Flat/Linear/Exponential) + growth factor. Mutates the currency's
 * {@link CostEntry} in `ctx.node.cost` in place; structural edits (currency
 * change, removal) call `rerender` so sibling rows refresh available currencies.
 *
 * "Flat" writes an entry with no scaling; its factor box is disabled.
 * A one-shot upgrade (`purchaseLimit === 1`) is only ever bought at level 0, so
 * its scaling controls are disabled; the purchase-limit control normalizes such
 * entries to flat, so a one-shot row never renders stale scaling.
 */
function buildCostRow(
  ctx: InspectorContext,
  key: string,
  entry: CostEntry,
  available: readonly Currency[],
  rerender: () => void,
): HTMLDivElement {
  // Scaling is meaningless for one-shot upgrades (only bought once, at level 0).
  const oneShot = ctx.node.purchaseLimit === 1
  const row = el('div', 'ed-cost-row')
  const keySelect = buildCurrencySelect(available, key)
  keySelect.classList.add('ed-cost-key')
  const amountInput = el('input', 'ed-input ed-cost-amount')
  amountInput.type = 'number'
  amountInput.value = String(entry.baseCost)

  const typeSelect = el('select', 'ed-input ed-cost-scaling')
  const scalingOptions: readonly (readonly [string, string])[] = [
    ['flat', 'Flat'],
    ['linear', 'Linear'],
    ['exponential', 'Exponential'],
  ]
  for (const [value, label] of scalingOptions) {
    const opt = el('option', undefined, label)
    opt.value = value
    if (value === (entry.scaleType ?? 'flat')) opt.selected = true
    typeSelect.append(opt)
  }
  typeSelect.disabled = oneShot
  typeSelect.title = oneShot
    ? 'One-shot upgrades (purchase limit 1) are only ever bought once, so scaling has no effect'
    : 'Per-level cost growth for this currency'

  const factorInput = el('input', 'ed-input ed-cost-factor')
  factorInput.type = 'number'
  factorInput.step = '0.01'
  factorInput.title = 'Per-level growth factor'
  factorInput.value = String(entry.scaleFactor ?? 0)
  factorInput.disabled = oneShot || entry.scaleType === undefined

  const remove = el('button', 'ed-btn ed-btn-remove', '✕')
  remove.type = 'button'

  // Write this currency's entry from the current controls (Flat = no scaling).
  const commit = (): void => {
    const scaleType = typeSelect.value as 'flat' | 'linear' | 'exponential'
    const baseCost = Number(amountInput.value) || 0
    const next: CostEntry =
      scaleType === 'flat'
        ? { baseCost }
        : { baseCost, scaleType, scaleFactor: Number(factorInput.value) || 0 }
    ctx.node.cost = { ...ctx.node.cost, [key]: next }
    ctx.onChange()
  }

  // Renaming a currency: move its entry to the new key (preserving order).
  keySelect.addEventListener('change', () => {
    const nextKey = keySelect.value
    const next: Record<string, CostEntry> = {}
    for (const [k, v] of Object.entries(ctx.node.cost)) next[k === key ? nextKey : k] = v
    ctx.node.cost = next
    ctx.onChange()
    rerender()
  })
  amountInput.addEventListener('change', commit)
  typeSelect.addEventListener('change', () => {
    const enabled = typeSelect.value !== 'flat'
    factorInput.disabled = !enabled
    if (!enabled) factorInput.value = '0'
    // Give a sensible default when switching on from a zeroed/flat factor.
    else if (Number(factorInput.value) === 0)
      factorInput.value = typeSelect.value === 'exponential' ? '1.15' : '1'
    commit()
  })
  factorInput.addEventListener('change', commit)
  remove.addEventListener('click', () => {
    ctx.node.cost = Object.fromEntries(Object.entries(ctx.node.cost).filter(([k]) => k !== key))
    ctx.onChange()
    rerender()
  })

  row.append(keySelect, amountInput, typeSelect, factorInput, remove)
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

function buildPurchaseLimitSection(ctx: InspectorContext, onLimitChange?: () => void): HTMLElement {
  const unlimited = el('input')
  unlimited.type = 'checkbox'
  unlimited.checked = ctx.node.purchaseLimit === null
  const number = el('input', 'ed-input')
  number.type = 'number'
  number.min = '1'
  number.value = String(ctx.node.purchaseLimit ?? 1)
  number.disabled = unlimited.checked

  const sync = (): void => {
    const limit = unlimited.checked ? null : Math.max(1, Number(number.value) || 1)
    ctx.node.purchaseLimit = limit
    number.disabled = unlimited.checked
    // A one-shot upgrade (limit 1) is only ever bought at level 0, so scaling is
    // inert. Normalize its cost to flat entries so we never persist — or ship —
    // dead scaling (the scale controls are also disabled while one-shot).
    if (limit === 1) {
      ctx.node.cost = Object.fromEntries(
        Object.entries(ctx.node.cost).map(([key, entry]) => [key, { baseCost: entry.baseCost }]),
      )
    }
    ctx.onChange()
    // Toggling one-shot (limit 1) enables/disables the cost scaling controls.
    onLimitChange?.()
  }
  unlimited.addEventListener('change', sync)
  number.addEventListener('change', sync)

  const control = el('div', 'ed-row')
  const unlimitedLabel = el('label', 'ed-checkbox')
  unlimitedLabel.append(unlimited, document.createTextNode(' unlimited'))
  control.append(number, unlimitedLabel)
  return field('Purchase limit', control)
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
    const items: SimplePrereqItem[] = []
    for (const row of checklist.querySelectorAll<HTMLDivElement>('.ed-prereq-row')) {
      const box = row.querySelector<HTMLInputElement>('input[type=checkbox]')!
      if (!box.checked) continue
      const level = row.querySelector<HTMLInputElement>('.ed-prereq-level')!
      let minLevel = Math.max(1, Math.floor(Number(level.value) || 1))
      // Clamp to the parent's purchase limit so we never author JSON the loader
      // would reject; reflect the clamp back into the field.
      const max = Number(level.max)
      if (Number.isFinite(max) && max >= 1) minLevel = Math.min(minLevel, max)
      if (String(minLevel) !== level.value) level.value = String(minLevel)
      items.push({ id: box.value, minLevel: minLevel > 1 ? minLevel : undefined })
    }
    ctx.node.prerequisites = fromSimplePrereq({ mode: modeSelect.value as 'all' | 'any', items })
    ctx.onChange()
  }
  modeSelect.addEventListener('change', sync)

  const selected = new Map(simple.items.map((i) => [i.id, i.minLevel ?? 1]))
  for (const id of ctx.allIds) {
    if (id === ctx.node.id) continue
    const row = el('div', 'ed-prereq-row ed-row')
    const item = el('label', 'ed-checklist-item')
    const box = el('input')
    box.type = 'checkbox'
    box.value = id
    box.checked = selected.has(id)
    item.append(box, document.createTextNode(` ${id}`))

    // Per-prerequisite minimum level. Capped at the target's purchase limit so
    // the form can't author a value the loader's validation would reject.
    const level = el('input', 'ed-input ed-prereq-level')
    level.type = 'number'
    level.min = '1'
    level.title = 'Minimum level'
    const limit = findNode(ctx.tree, id)?.purchaseLimit
    if (typeof limit === 'number') level.max = String(limit)
    level.value = String(selected.get(id) ?? 1)
    level.disabled = !box.checked

    box.addEventListener('change', () => {
      level.disabled = !box.checked
      sync()
    })
    level.addEventListener('change', sync)

    row.append(item, level)
    checklist.append(row)
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

function buildFlavorSection(ctx: InspectorContext): HTMLElement {
  const section = el('div', 'ed-section')
  section.append(el('h4', 'ed-section-title', 'Flavor'))

  const current = nodeFlavor(ctx.tree, ctx.node.id)
  const nameInput = el('input', 'ed-input')
  nameInput.type = 'text'
  nameInput.value = current.name
  const iconInput = el('input', 'ed-input')
  iconInput.type = 'text'
  iconInput.value = current.icon
  const descriptionInput = el('textarea', 'ed-input ed-json')
  descriptionInput.rows = 3
  descriptionInput.value = current.description

  const sync = (): void => {
    setNodeFlavor(ctx.tree, ctx.node.id, {
      name: nameInput.value.trim() || ctx.node.id,
      icon: iconInput.value.trim() || current.icon,
      description: descriptionInput.value.trim(),
    })
    ctx.onChange()
  }

  nameInput.addEventListener('change', sync)
  iconInput.addEventListener('change', sync)
  descriptionInput.addEventListener('change', sync)

  section.append(
    field('Name', nameInput),
    field('Icon', iconInput),
    field('Description', descriptionInput),
  )
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
  const cost = buildCostSection(ctx)
  container.append(
    buildIdSection(ctx),
    buildParentSection(ctx),
    cost.element,
    buildPurchaseLimitSection(ctx, cost.refresh),
    buildPrerequisitesSection(ctx),
    buildEffectsSection({
      tree: ctx.tree,
      getEffects: () => ctx.node.effects ?? [],
      setEffects: (next) => {
        ctx.node.effects = next.length > 0 ? next : undefined
        ctx.onChange()
      },
    }),
    buildFlavorSection(ctx),
    buildChoiceSection(ctx),
  )
}

/** Render an empty-state placeholder when no node is selected. */
export function renderInspectorEmpty(container: HTMLElement): void {
  container.innerHTML = '<p class="ed-empty">Select a node to edit it.</p>'
}
