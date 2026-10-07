// @vitest-environment happy-dom
//
// A refused slot cost is reported under the input that holds it, with the typed
// value left in place to be corrected — not in the shell's toolbar status, a
// screen away from the row. DOM tier because placement is the behavior.

import { beforeEach, describe, expect, it } from 'vitest'
import { parseTreeFile } from '@game/shared'
import type { TreeFile } from '@game/shared'
import idlerTreeFile from '@game/shared/trees/idler.json'
import { cloneTree } from '../src/dev/editor/model.js'
import { createAttacksView } from '../src/dev/editor/views/attacks.js'
import { createPactsView } from '../src/dev/editor/views/pacts.js'
import type { EditorContext, EditorView } from '../src/dev/editor/views/types.js'

function mount(make: () => EditorView) {
  const tree = cloneTree(parseTreeFile(idlerTreeFile))
  const status: string[] = []
  const ctx: EditorContext = {
    tree,
    markDirty: () => {},
    setStatus: (text) => {
      status.push(text)
    },
    requestRefresh: () => {},
  }
  const host = document.createElement('div')
  document.body.append(host)
  make().mount(host, ctx)
  // The first row is the first authored entity; its "Slot cost" field is the
  // first one so labelled.
  const field = [...host.querySelectorAll<HTMLElement>('.ed-gen-field')].find(
    (f) => f.querySelector('.ed-gen-field-label')?.textContent === 'Slot cost',
  )!
  const input = field.querySelector('input')!
  return {
    tree,
    status,
    input,
    error: (): string => field.querySelector('.ed-field-error')?.textContent ?? '',
    type: (value: string): void => {
      input.value = value
      input.dispatchEvent(new Event('change'))
    },
  }
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe.each([
  ['attack', createAttacksView, (t: TreeFile) => t.attacks[0]],
  ['pact', createPactsView, (t: TreeFile) => t.pacts[0]],
] as const)('%s editor — slot cost', (_what, make, first) => {
  it('reports a value below 1 under the input, keeps it typed, and writes nothing', () => {
    const view = mount(make)
    const before = structuredClone(first(view.tree))

    view.type('-1')
    expect(view.error()).toBe('slot cost must be a positive whole number (got -1)')
    expect(view.input.value).toBe('-1')
    expect(view.input.classList.contains('invalid')).toBe(true)
    expect(first(view.tree)).toEqual(before)
    expect(view.status).toEqual([])
  })

  it('treats a blanked field as nothing typed: value restored, no report, no write', () => {
    const view = mount(make)
    const before = structuredClone(first(view.tree))
    expect(view.input.min).toBe('1')

    view.type('')
    expect(view.input.value).toBe(String(before.slotCost ?? 1))
    expect(view.error()).toBe('')
    expect(first(view.tree)).toEqual(before)
  })

  it('clears the report once a valid value is written', () => {
    const view = mount(make)
    view.type('0')
    expect(view.error()).not.toBe('')

    view.type('2')
    expect(view.error()).toBe('')
    expect(view.input.classList.contains('invalid')).toBe(false)
    expect(first(view.tree).slotCost).toBe(2)
  })

  it('restores the last written value on a blank, not the value the row opened with', () => {
    const view = mount(make)
    view.type('2')
    view.type('')
    expect(view.input.value).toBe('2')
    expect(first(view.tree).slotCost).toBe(2)
  })

  it('clears a refusal when the field is blanked back to the kept value', () => {
    const view = mount(make)
    const before = structuredClone(first(view.tree))
    view.type('0')
    view.type('')
    expect(view.input.value).toBe(String(before.slotCost ?? 1))
    expect(view.error()).toBe('')
    expect(view.input.classList.contains('invalid')).toBe(false)
    expect(first(view.tree)).toEqual(before)
  })
})
