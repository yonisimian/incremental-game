/**
 * Context-aware form controls shared by the editor's form sections (resources,
 * generators). Each builder wires a control to a model mutation plus the standard
 * editor feedback (mark dirty, status line, re-render), so the views stay
 * declarative. Lower-level, context-free DOM builders live in `dom.js`.
 */

import { el, labeledInput } from './dom.js'
import { listResources } from '../model.js'
import type { MutationResult } from '../model.js'
import type { EditorContext } from './types.js'

/**
 * A rename `<input>` that commits on change and reverts on conflict. `rename`
 * returns `false` when the new name is blank or already used (the model leaves
 * the tree untouched), in which case the field snaps back and reports why.
 */
export function renameInput(
  ctx: EditorContext,
  current: string,
  rename: (next: string) => boolean,
  onDone: () => void,
): HTMLInputElement {
  const input = labeledInput('text', current, 'ed-input ed-input-key')
  input.addEventListener('change', () => {
    const next = input.value.trim()
    if (next === current) return
    if (rename(next)) {
      ctx.markDirty()
      ctx.setStatus(`Renamed ${current} → ${next}`)
      onDone()
    } else {
      input.value = current
      ctx.setStatus(`Can't rename to '${next}' (blank or already used)`, true)
    }
  })
  return input
}

/**
 * A danger "remove" button, disabled (with the blocking references in its title)
 * while `refs` is non-empty. On click it runs `remove` and either confirms or
 * surfaces the model's refusal reason.
 */
export function removeButton(
  ctx: EditorContext,
  refs: readonly string[],
  remove: () => MutationResult,
  messages: { removed: string; blocked: string },
  onDone: () => void,
): HTMLButtonElement {
  const btn = el('button', 'ed-btn ed-btn-danger', '🗑')
  btn.disabled = refs.length > 0
  if (refs.length > 0) btn.title = `Referenced by ${refs.join(', ')}`
  btn.addEventListener('click', () => {
    const result = remove()
    if (result.ok) {
      ctx.markDirty()
      ctx.setStatus(messages.removed)
      onDone()
    } else {
      ctx.setStatus(`${messages.blocked}: ${result.reason}`, true)
    }
  })
  return btn
}

/**
 * An "add" button that runs `add` (returning the new id), marks dirty, reports
 * via `describe`, and re-renders.
 */
export function addButton(
  ctx: EditorContext,
  label: string,
  add: () => string,
  describe: (id: string) => string,
  onDone: () => void,
): HTMLButtonElement {
  const btn = el('button', 'ed-btn', label)
  btn.addEventListener('click', () => {
    const id = add()
    ctx.markDirty()
    ctx.setStatus(describe(id))
    onDone()
  })
  return btn
}

/**
 * A number `<input>` that commits a finite value on change (then marks dirty and
 * runs the optional `onDone`, e.g. to refresh a preview), reverting to the last
 * accepted value for non-numeric input. `step` tunes the spinner increment.
 * `commit` returns `false` to refuse a value.
 */
export function numberInput(
  ctx: EditorContext,
  value: number,
  commit: (n: number) => unknown,
  options: { step?: string; min?: string; allowBlank?: boolean; onDone?: () => void } = {},
): HTMLInputElement {
  const input = labeledInput('number', String(value), 'ed-input ed-input-num')
  if (options.step !== undefined) input.step = options.step
  if (options.min !== undefined) input.min = options.min
  let last = value
  input.addEventListener('change', () => {
    // A blank field reads as 0, which most fields mean as "none"; a field that
    // has no "none" (`allowBlank: false`) treats it as nothing typed instead.
    const blank = input.value.trim() === ''
    const n = Number(input.value)
    if (blank && options.allowBlank === false) {
      // Re-committing the kept value also clears a refusal shown for the typo.
      input.value = String(last)
      commit(last)
    } else if (Number.isFinite(n)) {
      if (commit(n) !== false) last = n
      ctx.markDirty()
      options.onDone?.()
    } else {
      input.value = String(last)
    }
  })
  return input
}

/**
 * A `<select>` over the tree's resources, labelled with icon + name + key.
 * `exclude` drops resources already spoken for elsewhere (the selected one is
 * always offered, so a row can keep its own currency).
 */
export function resourceSelect(
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
