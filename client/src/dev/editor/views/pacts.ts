/**
 * Pacts section — an authoring list for the mode's pacts (plan 42): id, kind
 * (active / passive), whether the treaty is `mutual`, primary-flavor display
 * (icon · name · description), and the buff effects each pact carries.
 * Effects reuse the shared effects-editor (the same form machinery as the
 * upgrade-node inspector and the attacks view), so a `mirrorStatModifier`
 * ("+2% wood per enemy woodcutter") is authored here exactly as upgrade
 * effects are elsewhere, with its `source` / `field` as catalog dropdowns.
 *
 * No cost or timing fields yet — plan 44 adds them behind the kind select, the
 * way the attacks view clears prepare data on a switch to passive.
 */

import {
  addPact,
  listPacts,
  pactEffects,
  pactReferences,
  removePact,
  renamePact,
  setPactEffects,
  setPactFlavor,
  setPactKind,
  setPactMutual,
  type PactRow,
} from '../model.js'
import { buildEffectsSection } from '../effects-editor.js'
import { addButton, removeButton, renameInput } from './controls.js'
import { el, labeledInput } from './dom.js'
import type { EditorContext, EditorView } from './types.js'

export function createPactsView(): EditorView {
  let host: HTMLElement | null = null
  let ctx: EditorContext | null = null

  const render = (): void => {
    if (!host || !ctx) return
    const c = ctx
    host.innerHTML = ''

    const root = el('div', 'ed-gen-root')
    const left = el('div', 'ed-gen-edit')

    const toolbar = el('div', 'ed-form-toolbar')
    toolbar.append(
      addButton(
        c,
        '➕ Add pact',
        () => addPact(c.tree),
        (id) => `Added pact ${id}`,
        render,
      ),
    )
    left.append(toolbar)

    const list = el('div', 'ed-gen-list')
    const pacts = listPacts(c.tree)
    if (pacts.length === 0) {
      list.append(el('div', 'ed-preview-msg', 'No pacts yet.'))
    } else {
      for (const row of pacts) list.append(buildRow(c, row, render))
    }
    left.append(list)

    root.append(left)
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

function buildRow(ctx: EditorContext, row: PactRow, render: () => void): HTMLElement {
  const tree = ctx.tree
  const card = el('div', 'ed-gen-card')

  // ── Header: id rename + remove ──
  const header = el('div', 'ed-gen-card-head')
  const idInput = renameInput(ctx, row.id, (next) => renamePact(tree, row.id, next), render)
  const removeBtn = removeButton(
    ctx,
    pactReferences(tree, row.id),
    () => removePact(tree, row.id),
    { removed: `Removed pact ${row.id}`, blocked: `Can't remove ${row.id}` },
    render,
  )
  header.append(labeled('ID', idInput), removeBtn)
  card.append(header)

  // ── Kind ──
  const kindSelect = el('select', 'ed-input')
  for (const kind of ['passive', 'active'] as const) {
    const opt = el('option', undefined, kind)
    opt.value = kind
    if (kind === row.kind) opt.selected = true
    kindSelect.append(opt)
  }
  kindSelect.addEventListener('change', () => {
    setPactKind(tree, row.id, kindSelect.value === 'active' ? 'active' : 'passive')
    ctx.markDirty()
    render()
  })

  // ── Mutual: the partner benefits too ──
  const mutual = el('input', 'ed-input ed-effect-check')
  mutual.type = 'checkbox'
  mutual.checked = row.mutual
  mutual.title = "The pact's effects also resolve for the partner, reading you as their enemy"
  mutual.addEventListener('change', () => {
    setPactMutual(tree, row.id, mutual.checked)
    ctx.markDirty()
  })

  // ── Flavor: icon + name + description ──
  const iconInput = labeledInput('text', row.icon, 'ed-input ed-input-icon')
  const nameInput = labeledInput('text', row.name)
  const descInput = labeledInput('text', row.description)
  const commitFlavor = (): void => {
    setPactFlavor(tree, row.id, {
      name: nameInput.value,
      icon: iconInput.value,
      description: descInput.value,
    })
    ctx.markDirty()
  }
  iconInput.addEventListener('input', commitFlavor)
  nameInput.addEventListener('input', commitFlavor)
  descInput.addEventListener('input', commitFlavor)

  const fields = el('div', 'ed-gen-card-fields')
  fields.append(
    labeled('Kind', kindSelect),
    labeled('Mutual', mutual),
    labeled('Icon', iconInput),
    labeled('Name', nameInput),
    labeled('Description', descInput),
  )
  card.append(fields)

  // ── Effects (the buffs the treaty carries) ──
  card.append(
    buildEffectsSection({
      // The pact effects ride both kinds; the picker follows this pact's so an
      // active pact offers what plan 44 will read.
      effectHost: row.kind === 'active' ? 'activePact' : 'passivePact',
      tree,
      getEffects: () => pactEffects(tree, row.id),
      setEffects: (next) => {
        setPactEffects(tree, row.id, [...next])
        ctx.markDirty()
      },
    }),
  )

  return card
}

/** A label + control pair (vertical), matching the attacks view. */
function labeled(label: string, control: HTMLElement): HTMLElement {
  const wrap = el('label', 'ed-gen-field')
  wrap.append(el('span', 'ed-gen-field-label', label), control)
  return wrap
}
