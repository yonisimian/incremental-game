/**
 * Attacks section — an authoring list for the mode's attacks: id, kind
 * (active / passive), primary-flavor display (icon · name · description), and
 * the offensive effects each attack carries. Effects reuse the shared
 * effects-editor (the same form machinery as the upgrade-node inspector), so an
 * `enemyProductionModifier` (e.g. "reduce the enemy's Wood production 10%") is
 * authored here exactly as upgrade effects are elsewhere.
 *
 * Only `passive` attacks have continuous behavior today; an offensive effect on
 * an active attack is flagged at export by `validateModeDefinition`.
 */

import {
  addAttack,
  attackEffects,
  attackReferences,
  listAttacks,
  removeAttack,
  renameAttack,
  setAttackEffects,
  setAttackFlavor,
  setAttackKind,
  type AttackRow,
} from '../model.js'
import { buildEffectsSection, type EffectEntry } from '../effects-editor.js'
import { addButton, removeButton, renameInput } from './controls.js'
import { el, labeledInput } from './dom.js'
import type { EditorContext, EditorView } from './types.js'

export function createAttacksView(): EditorView {
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
      addButton(c, '➕ Add attack', () => addAttack(c.tree), (id) => `Added attack ${id}`, render),
    )
    left.append(toolbar)

    const list = el('div', 'ed-gen-list')
    const attacks = listAttacks(c.tree)
    if (attacks.length === 0) {
      list.append(el('div', 'ed-preview-msg', 'No attacks yet.'))
    } else {
      for (const row of attacks) list.append(buildRow(c, row, render))
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

function buildRow(ctx: EditorContext, row: AttackRow, render: () => void): HTMLElement {
  const tree = ctx.tree
  const card = el('div', 'ed-gen-card')

  // ── Header: id rename + remove ──
  const header = el('div', 'ed-gen-card-head')
  const idInput = renameInput(ctx, row.id, (next) => renameAttack(tree, row.id, next), render)
  const removeBtn = removeButton(
    ctx,
    attackReferences(tree, row.id),
    () => removeAttack(tree, row.id),
    { removed: `Removed attack ${row.id}`, blocked: `Can't remove ${row.id}` },
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
    setAttackKind(tree, row.id, kindSelect.value === 'active' ? 'active' : 'passive')
    ctx.markDirty()
  })

  // ── Flavor: icon + name + description ──
  const iconInput = labeledInput('text', row.icon, 'ed-input ed-input-icon')
  const nameInput = labeledInput('text', row.name)
  const descInput = labeledInput('text', row.description)
  const commitFlavor = (): void => {
    setAttackFlavor(tree, row.id, {
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
    labeled('Icon', iconInput),
    labeled('Name', nameInput),
    labeled('Description', descInput),
  )
  card.append(fields)

  // ── Effects (offensive — applied to the opponent) ──
  card.append(
    buildEffectsSection({
      tree,
      getEffects: () => attackEffects(tree, row.id) as readonly EffectEntry[],
      setEffects: (next) => {
        setAttackEffects(tree, row.id, [...next])
        ctx.markDirty()
      },
    }),
  )

  return card
}

/** A label + control pair (vertical), matching the generators view. */
function labeled(label: string, control: HTMLElement): HTMLElement {
  const wrap = el('label', 'ed-gen-field')
  wrap.append(el('span', 'ed-gen-field-label', label), control)
  return wrap
}
