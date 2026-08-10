/**
 * Attacks section — an authoring list for the mode's attacks: id, kind
 * (active / passive), primary-flavor display (icon · name · description), and
 * the offensive effects each attack carries. Effects reuse the shared
 * effects-editor (the same form machinery as the upgrade-node inspector), so an
 * `enemyProductionModifier` (e.g. "reduce the enemy's Wood production 10%") is
 * authored here exactly as upgrade effects are elsewhere.
 *
 * `active` attacks additionally expose a preparation cost + lead time: the
 * player pays the cost to arm the attack, and the strike lands after the delay.
 * The cost may charge several resources at once, so it is authored as a list of
 * currency rows (like the upgrade inspector's cost section, minus the per-level
 * scaling — attack costs are always flat).
 * `passive` attacks apply their effects continuously and carry no prepare data.
 */

import {
  addAttack,
  addAttackPrepareCurrency,
  attackEffects,
  attackReferences,
  listAttacks,
  listResources,
  removeAttack,
  removeAttackPrepareCurrency,
  renameAttack,
  setAttackEffects,
  setAttackFlavor,
  setAttackKind,
  setAttackPrepareCost,
  setAttackPrepareCurrency,
  setAttackPrepareTime,
  type AttackCostRow,
  type AttackRow,
} from '../model.js'
import { buildEffectsSection } from '../effects-editor.js'
import { addButton, numberInput, removeButton, renameInput } from './controls.js'
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
      addButton(
        c,
        '➕ Add attack',
        () => addAttack(c.tree),
        (id) => `Added attack ${id}`,
        render,
      ),
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
    render()
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

  // ── Preparation (active attacks only): lead time before the strike ──
  if (row.kind === 'active') {
    const prepareTime = numberInput(
      ctx,
      row.prepareTimeSec,
      (n) => {
        setAttackPrepareTime(tree, row.id, n)
      },
      { step: '0.5' },
    )
    fields.append(labeled('Prepare time /s', prepareTime))
  }

  card.append(fields)

  // ── Prepare cost (active attacks only): one row per charged currency ──
  if (row.kind === 'active') card.append(buildPrepareCostSection(ctx, row, render))

  // ── Effects (offensive — applied to the opponent) ──
  card.append(
    buildEffectsSection({
      tree,
      getEffects: () => attackEffects(tree, row.id),
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

/**
 * A `<select>` over the tree's resources, labelled with icon + name + key.
 * `exclude` drops resources already spoken for elsewhere (the selected one is
 * always offered, so a row can keep its own currency).
 */
function resourceSelect(
  tree: EditorContext['tree'],
  selected: string,
  onChange: (value: string) => void,
  exclude: ReadonlySet<string> = new Set(),
): HTMLSelectElement {
  const sel = el('select', 'ed-input')
  for (const r of listResources(tree)) {
    if (r.key !== selected && exclude.has(r.key)) continue
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

/**
 * The prepare-cost editor for one active attack: a row per charged currency plus
 * an add button. A prepare cost may charge several resources at once, so the
 * rows are rebuilt from the model after every structural edit — each dropdown
 * then excludes the currencies its siblings already charge, so two rows can
 * never collapse onto one key (which would silently drop an amount).
 */
function buildPrepareCostSection(
  ctx: EditorContext,
  attack: AttackRow,
  render: () => void,
): HTMLElement {
  const tree = ctx.tree
  const section = el('div', 'ed-section')
  section.append(el('h4', 'ed-section-title', 'Prepare cost'))

  const charged = new Set(attack.prepareCost.map((c) => c.currency))
  const rows = el('div', 'ed-rows')
  if (attack.prepareCost.length === 0) {
    // An effect-bearing active attack is *activated* by paying its cost, so the
    // boot-time validator rejects it without one — say so rather than let the
    // author discover it on export.
    rows.append(
      el(
        'p',
        'ed-hint',
        attackEffects(tree, attack.id).length > 0
          ? 'An active attack carrying effects needs at least one currency to charge.'
          : 'No cost — this attack arms for free.',
      ),
    )
  } else {
    const header = el('div', 'ed-attack-cost-row ed-cost-header')
    header.append(
      el('span', 'ed-cost-th', 'Currency'),
      el('span', 'ed-cost-th', 'Cost'),
      el('span', 'ed-cost-th'),
    )
    rows.append(header)
    for (const entry of attack.prepareCost)
      rows.append(buildPrepareCostRow(ctx, attack.id, entry, charged, render))
  }

  const add = el('button', 'ed-btn', '+ currency')
  add.type = 'button'
  add.disabled = charged.size >= tree.resources.length
  add.addEventListener('click', () => {
    const currency = addAttackPrepareCurrency(tree, attack.id)
    if (currency === null) return
    ctx.markDirty()
    ctx.setStatus(`Added ${currency} to ${attack.id}'s prepare cost`)
    render()
  })

  section.append(rows, add)
  return section
}

/** One prepare-cost row: currency + flat amount + remove. */
function buildPrepareCostRow(
  ctx: EditorContext,
  attackId: string,
  entry: AttackCostRow,
  charged: ReadonlySet<string>,
  render: () => void,
): HTMLElement {
  const tree = ctx.tree
  const row = el('div', 'ed-attack-cost-row')

  const currency = resourceSelect(
    tree,
    entry.currency,
    (value) => {
      if (!setAttackPrepareCurrency(tree, attackId, entry.currency, value)) return
      ctx.markDirty()
      render()
    },
    charged,
  )
  const amount = numberInput(ctx, entry.baseCost, (n) => {
    setAttackPrepareCost(tree, attackId, entry.currency, n)
  })

  const remove = el('button', 'ed-btn ed-btn-remove', '✕')
  remove.type = 'button'
  remove.title = `Stop charging ${entry.currency}`
  remove.addEventListener('click', () => {
    const result = removeAttackPrepareCurrency(tree, attackId, entry.currency)
    if (!result.ok) {
      ctx.setStatus(`Can't remove ${entry.currency}: ${result.reason}`, true)
      return
    }
    ctx.markDirty()
    render()
  })

  row.append(currency, amount, remove)
  return row
}
