/**
 * Resources section — a table of the mode's resources. Each row edits one
 * resource's stable key (rename cascades through the model), its primary-flavor
 * display (icon + name + optional CSS class), its starting amount, and which
 * resource is the score resource. Add/remove maintain the cross-flavor key
 * invariants; remove is blocked (with a reason) while anything references the
 * key.
 */

import {
  addResource,
  listResources,
  removeResource,
  renameResource,
  resourceReferences,
  setInitialResource,
  setResourceFlavor,
  setScoreResource,
  type ResourceRow,
} from '../model.js'
import { addButton, numberInput, removeButton, renameInput } from './controls.js'
import { el, labeledInput } from './dom.js'
import type { EditorContext, EditorView } from './types.js'

/** The score-resource radio group name (one selection across all rows). */
const SCORE_RADIO = 'ed-score-resource'

export function createResourcesView(): EditorView {
  let host: HTMLElement | null = null
  let ctx: EditorContext | null = null

  const render = (): void => {
    if (!host || !ctx) return
    const c = ctx
    host.innerHTML = ''

    const root = el('div', 'ed-form-root')

    const toolbar = el('div', 'ed-form-toolbar')
    toolbar.append(
      addButton(
        c,
        '➕ Add resource',
        () => addResource(c.tree),
        (key) => `Added resource ${key}`,
        render,
      ),
    )
    root.append(toolbar)

    const table = el('div', 'ed-form-table ed-res-table')
    table.append(headerRow(['Score', 'Key', 'Icon', 'Name', 'CSS class', 'Initial', '']))
    for (const row of listResources(c.tree)) table.append(buildRow(c, row, render))
    root.append(table)

    host.append(root)
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
    },
  }
}

function headerRow(labels: readonly string[]): HTMLElement {
  const head = el('div', 'ed-form-head')
  for (const label of labels) head.append(el('span', 'ed-form-head-cell', label))
  return head
}

function buildRow(ctx: EditorContext, row: ResourceRow, render: () => void): HTMLElement {
  const tree = ctx.tree
  const rowEl = el('div', 'ed-form-row')

  // Commit the three flavor fields together (the model upserts the primary flavor).
  const iconInput = labeledInput('text', row.icon, 'ed-input ed-input-icon')
  const nameInput = labeledInput('text', row.displayName)
  const classInput = labeledInput('text', row.className ?? '')
  const commitFlavor = (): void => {
    setResourceFlavor(tree, row.key, {
      displayName: nameInput.value,
      icon: iconInput.value,
      className: classInput.value.trim(),
    })
    ctx.markDirty()
  }
  for (const input of [iconInput, nameInput, classInput]) {
    input.addEventListener('input', commitFlavor)
  }

  // Score radio: exactly one resource is the score resource.
  const score = el('input')
  score.type = 'radio'
  score.name = SCORE_RADIO
  score.checked = row.isScore
  score.addEventListener('change', () => {
    if (!score.checked) return
    setScoreResource(tree, row.key)
    ctx.markDirty()
    ctx.setStatus(`Score resource → ${row.key}`)
    render()
  })

  // Key rename (cascades; revert on conflict).
  const keyInput = renameInput(ctx, row.key, (next) => renameResource(tree, row.key, next), render)

  const initialInput = numberInput(ctx, row.initial, (n) => {
    setInitialResource(tree, row.key, n)
  })

  // Remove — disabled (with a reason) while anything references the key.
  const removeBtn = removeButton(
    ctx,
    resourceReferences(tree, row.key),
    () => removeResource(tree, row.key),
    { removed: `Removed resource ${row.key}`, blocked: `Can't remove ${row.key}` },
    render,
  )

  rowEl.append(
    cell(score),
    cell(keyInput),
    cell(iconInput),
    cell(nameInput),
    cell(classInput),
    cell(initialInput),
    cell(removeBtn),
  )
  return rowEl
}

function cell(control: HTMLElement): HTMLElement {
  const c = el('span', 'ed-form-cell')
  c.append(control)
  return c
}
