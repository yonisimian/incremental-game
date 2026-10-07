/**
 * Pacts section — an authoring list for the mode's pacts: id, kind
 * (active / passive), whether the treaty is `mutual`, primary-flavor display
 * (icon · name · description), and the buff effects each pact carries.
 * Effects reuse the shared effects-editor (the same form machinery as the
 * upgrade-node inspector and the attacks view), so a `mirrorStatModifier`
 * ("+2% wood per enemy woodcutter") is authored here exactly as upgrade
 * effects are elsewhere, with its `source` / `field` as catalog dropdowns.
 *
 * `active` pacts additionally expose an activation cost (currency rows, like an
 * attack's prepare cost), how long the window stays open, and an optional
 * cooldown after it; the model clears all three on a switch to passive, as
 * the attacks view does for prepare data.
 */

import {
  addPact,
  addPactActivationCurrency,
  listPacts,
  pactEffects,
  pactReferences,
  removePact,
  removePactActivationCurrency,
  renamePact,
  setPactActivationCost,
  setPactActivationCurrency,
  setPactCooldown,
  setPactDuration,
  setPactEffects,
  setPactFlavor,
  setPactKind,
  setPactMutual,
  setPactSlotCost,
  type AttackCostRow,
  type PactRow,
} from '../model.js'
import { buildEffectsSection } from '../effects-editor.js'
import { addButton, numberInput, removeButton, renameInput, resourceSelect } from './controls.js'
import { el, labeled, labeledInput } from './dom.js'
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
    const kind = kindSelect.value === 'active' ? 'active' : 'passive'
    const result = setPactKind(tree, row.id, kind)
    // A refusal (an effect the new kind cannot host) leaves the tree as it
    // was; the re-render puts the select back.
    if (result.ok) ctx.markDirty()
    else ctx.setStatus(`Can't make ${row.id} ${kind}: ${result.reason}`, true)
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

  // How much of its kind's slot budget the pact takes (1 = the default). A
  // refusal (below 1) leaves the tree as it was and is reported under the
  // input, which keeps the typed value so it can be corrected in place.
  const slotCostError = el('span', 'ed-error ed-field-error')
  const slotCost = numberInput(
    ctx,
    row.slotCost,
    (n) => {
      const result = setPactSlotCost(tree, row.id, n)
      slotCostError.textContent = result.ok ? '' : result.reason
      slotCost.classList.toggle('invalid', !result.ok)
      return result.ok
    },
    { step: '1', min: '1', allowBlank: false },
  )
  const slotCostField = labeled('Slot cost', slotCost)
  slotCostField.append(slotCostError)

  const fields = el('div', 'ed-gen-card-fields')
  fields.append(
    labeled('Kind', kindSelect),
    labeled('Mutual', mutual),
    labeled('Icon', iconInput),
    labeled('Name', nameInput),
    labeled('Description', descInput),
    slotCostField,
  )

  // ── Activation (active pacts only): how long the window stays open, and the rest after ──
  if (row.kind === 'active') {
    const duration = numberInput(
      ctx,
      row.durationSec ?? 0,
      (n) => {
        setPactDuration(tree, row.id, n)
      },
      { step: '0.5' },
    )
    // Blank (0) means "no cooldown".
    const cooldown = numberInput(
      ctx,
      row.cooldownSec ?? 0,
      (n) => {
        setPactCooldown(tree, row.id, n)
      },
      { step: '0.5' },
    )
    fields.append(labeled('Duration /s', duration), labeled('Cooldown /s', cooldown))
  }
  card.append(fields)

  // ── Activation cost (active pacts only): one row per charged currency ──
  if (row.kind === 'active') card.append(buildActivationCostSection(ctx, row, render))

  // ── Effects (the buffs the treaty carries) ──
  card.append(
    buildEffectsSection({
      // The picker follows this pact's kind: an active pact also offers the
      // effects that only make sense for a while (a gift to the partner).
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

/**
 * The activation-cost editor for one active pact — the attacks view's
 * prepare-cost section with the pact mutations: a row per charged currency
 * plus an add button, each dropdown excluding its siblings' currencies.
 */
function buildActivationCostSection(
  ctx: EditorContext,
  pact: PactRow,
  render: () => void,
): HTMLElement {
  const tree = ctx.tree
  const section = el('div', 'ed-section')
  section.append(el('h4', 'ed-section-title', 'Activation cost'))

  const charged = new Set(pact.activationCost.map((c) => c.currency))
  const rows = el('div', 'ed-rows')
  if (pact.activationCost.length === 0) {
    rows.append(
      el(
        'p',
        'ed-hint',
        pactEffects(tree, pact.id).length > 0
          ? 'An active pact carrying effects needs at least one currency to charge.'
          : 'No cost — this pact activates for free.',
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
    for (const entry of pact.activationCost)
      rows.append(buildActivationCostRow(ctx, pact.id, entry, charged, render))
  }

  const add = el('button', 'ed-btn', '+ currency')
  add.type = 'button'
  add.disabled = charged.size >= tree.resources.length
  add.addEventListener('click', () => {
    const currency = addPactActivationCurrency(tree, pact.id)
    if (currency === null) return
    ctx.markDirty()
    ctx.setStatus(`Added ${currency} to ${pact.id}'s activation cost`)
    render()
  })

  section.append(rows, add)
  return section
}

/** One activation-cost row: currency + flat amount + remove. */
function buildActivationCostRow(
  ctx: EditorContext,
  pactId: string,
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
      if (!setPactActivationCurrency(tree, pactId, entry.currency, value)) return
      ctx.markDirty()
      render()
    },
    charged,
  )
  const amount = numberInput(ctx, entry.baseCost, (n) => {
    setPactActivationCost(tree, pactId, entry.currency, n)
  })
  const remove = el('button', 'ed-btn ed-btn-remove', '✕')
  remove.type = 'button'
  remove.title = `Stop charging ${entry.currency}`
  remove.addEventListener('click', () => {
    const result = removePactActivationCurrency(tree, pactId, entry.currency)
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
