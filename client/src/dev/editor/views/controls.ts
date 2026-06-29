/**
 * Context-aware form controls shared by the editor's form sections (resources,
 * generators). Each builder wires a control to a model mutation plus the standard
 * editor feedback (mark dirty, status line, re-render), so the views stay
 * declarative. Lower-level, context-free DOM builders live in `dom.js`.
 */

import { el, labeledInput } from './dom.js'
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
 * runs the optional `onDone`, e.g. to refresh a preview), reverting to `value`
 * for non-numeric input. `step` tunes the spinner increment.
 */
export function numberInput(
  ctx: EditorContext,
  value: number,
  commit: (n: number) => void,
  options: { step?: string; onDone?: () => void } = {},
): HTMLInputElement {
  const input = labeledInput('number', String(value), 'ed-input ed-input-num')
  if (options.step !== undefined) input.step = options.step
  input.addEventListener('change', () => {
    const n = Number(input.value)
    if (Number.isFinite(n)) {
      commit(n)
      ctx.markDirty()
      options.onDone?.()
    } else {
      input.value = String(value)
    }
  })
  return input
}
