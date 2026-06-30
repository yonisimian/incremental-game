/**
 * Generators section — an authoring table (left) beside a live preview (right)
 * showing how every generator renders in the in-game panel, as if all unlocked.
 *
 * The preview reuses the game's pure `renderGeneratorCardView` over a throwaway
 * `ModeDefinition` built from the working tree (the tree is never registered as a
 * mode, so the game's registry path can't be used). While the tree is mid-edit
 * and invalid, the preview shows the validation message instead — the same text
 * an export would surface.
 */

import {
  getGeneratorCost,
  getModeFlavor,
  toModeDefinition,
  type GeneratorDefinition,
} from '@game/shared'
import { renderGeneratorCardView } from '../../../ui/panels/generators-panel.js'
import {
  addGenerator,
  generatorReferences,
  listGenerators,
  listResources,
  removeGenerator,
  renameGenerator,
  setGeneratorField,
  setGeneratorFlavor,
  type GeneratorRow,
} from '../model.js'
import { addButton, numberInput, removeButton, renameInput } from './controls.js'
import { el, labeledInput } from './dom.js'
import type { EditorContext, EditorView } from './types.js'

export function createGeneratorsView(): EditorView {
  let host: HTMLElement | null = null
  let ctx: EditorContext | null = null
  let preview: HTMLElement | null = null

  const renderPreview = (): void => {
    if (!preview || !ctx) return
    preview.innerHTML = ''
    let modeDef
    try {
      modeDef = toModeDefinition(ctx.tree)
    } catch (err) {
      preview.append(
        el(
          'div',
          'ed-preview-msg ed-preview-error',
          err instanceof Error ? err.message : 'Invalid tree',
        ),
      )
      return
    }
    if (modeDef.generators.length === 0) {
      preview.append(el('div', 'ed-preview-msg', 'No generators yet.'))
      return
    }
    const flavor = getModeFlavor(modeDef)
    const list = el('div', 'generator-list')
    list.innerHTML = modeDef.generators.map((def) => previewCard(def, flavor)).join('')
    preview.append(list)
  }

  const render = (): void => {
    if (!host || !ctx) return
    const c = ctx
    host.innerHTML = ''

    const root = el('div', 'ed-gen-root')

    // Left: authoring list.
    const left = el('div', 'ed-gen-edit')
    const toolbar = el('div', 'ed-form-toolbar')
    toolbar.append(
      addButton(
        c,
        '➕ Add generator',
        () => addGenerator(c.tree),
        (id) => `Added generator ${id}`,
        render,
      ),
    )
    left.append(toolbar)

    const list = el('div', 'ed-gen-list')
    for (const row of listGenerators(c.tree)) list.append(buildRow(c, row, render, renderPreview))
    left.append(list)

    // Right: live preview.
    const right = el('div', 'ed-gen-preview')
    right.append(el('h3', 'ed-gen-preview-title', 'Preview'))
    preview = el('div', 'ed-gen-preview-body')
    right.append(preview)

    root.append(left, right)
    host.append(root)
    renderPreview()
  }

  return {
    mount(h, c): void {
      host = h
      ctx = c
      render()
    },
    refresh: render,
    unmount(): void {
      if (host) host.innerHTML = ''
      host = null
      ctx = null
      preview = null
    },
  }
}

/** One preview card: zero owned, shown as affordable (an authoring preview). */
function previewCard(
  def: GeneratorDefinition,
  flavor: Parameters<typeof renderGeneratorCardView>[1],
): string {
  return renderGeneratorCardView(def, flavor, {
    owned: 0,
    nextCost: getGeneratorCost(def, 0),
    affordable: true,
    maxAffordable: 0,
    bulkCost: 0,
  })
}

function buildRow(
  ctx: EditorContext,
  row: GeneratorRow,
  render: () => void,
  renderPreview: () => void,
): HTMLElement {
  const tree = ctx.tree
  const card = el('div', 'ed-gen-card')

  // ── Header: id rename + remove ──
  const header = el('div', 'ed-gen-card-head')
  const idInput = renameInput(ctx, row.id, (next) => renameGenerator(tree, row.id, next), render)

  const removeBtn = removeButton(
    ctx,
    generatorReferences(tree, row.id),
    () => removeGenerator(tree, row.id),
    { removed: `Removed generator ${row.id}`, blocked: `Can't remove ${row.id}` },
    render,
  )
  header.append(labeled('ID', idInput), removeBtn)
  card.append(header)

  // ── Flavor: icon + name ──
  const iconInput = labeledInput('text', row.icon, 'ed-input ed-input-icon')
  const nameInput = labeledInput('text', row.name)
  const commitFlavor = (): void => {
    setGeneratorFlavor(tree, row.id, { name: nameInput.value, icon: iconInput.value })
    ctx.markDirty()
    renderPreview()
  }
  iconInput.addEventListener('input', commitFlavor)
  nameInput.addEventListener('input', commitFlavor)

  // ── Mechanics ──
  const baseCost = numberInput(
    ctx,
    row.baseCost,
    (n) => {
      setGeneratorField(tree, row.id, { baseCost: n })
    },
    { onDone: renderPreview },
  )

  const scaling = numberInput(
    ctx,
    row.costScaling,
    (n) => {
      setGeneratorField(tree, row.id, { costScaling: n })
    },
    { step: '0.01', onDone: renderPreview },
  )

  const currency = resourceSelect(tree, row.costCurrency, (value) => {
    setGeneratorField(tree, row.id, { costCurrency: value })
    ctx.markDirty()
    renderPreview()
  })

  const prodResource = resourceSelect(tree, row.productionResource, (value) => {
    setGeneratorField(tree, row.id, { productionResource: value })
    ctx.markDirty()
    renderPreview()
  })

  const rate = numberInput(
    ctx,
    row.productionRate,
    (n) => {
      setGeneratorField(tree, row.id, { productionRate: n })
    },
    { step: '0.1', onDone: renderPreview },
  )

  const fields = el('div', 'ed-gen-card-fields')
  fields.append(
    labeled('Icon', iconInput),
    labeled('Name', nameInput),
    labeled('Base cost', baseCost),
    labeled('Cost scaling', scaling),
    labeled('Cost currency', currency),
    labeled('Produces', prodResource),
    labeled('Rate /s', rate),
  )
  card.append(fields)
  return card
}

/** A `<select>` over the tree's resources, labelled with icon + name + key. */
function resourceSelect(
  tree: EditorContext['tree'],
  selected: string,
  onChange: (value: string) => void,
): HTMLSelectElement {
  const sel = el('select', 'ed-input')
  for (const r of listResources(tree)) {
    const opt = el('option', undefined, `${r.icon} ${r.displayName} (${r.key})`)
    opt.value = r.key
    if (r.key === selected) opt.selected = true
    sel.append(opt)
  }
  sel.addEventListener('change', () => {
    onChange(sel.value)
  })
  return sel
}

/** A label + control pair (vertical). */
function labeled(label: string, control: HTMLElement): HTMLElement {
  const wrap = el('label', 'ed-gen-field')
  wrap.append(el('span', 'ed-gen-field-label', label), control)
  return wrap
}
