// @vitest-environment happy-dom
//
// The effects editor reports each schema complaint under the param it concerns,
// phrased with that param's name and value, and keeps the block-level line for
// cross-field rules. DOM tier because placement is the behavior: which row the
// message lands in.

import { beforeEach, describe, expect, it } from 'vitest'
import { parseTreeFile } from '@game/shared'
import idlerTreeFile from '@game/shared/trees/idler.json'
import { cloneTree } from '../src/dev/editor/model.js'
import { buildEffectsSection } from '../src/dev/editor/effects-editor.js'

interface EffectEntry {
  readonly type: string
  readonly [param: string]: unknown
}

function mount(initial: EffectEntry) {
  let effects: readonly EffectEntry[] = [initial]
  const section = buildEffectsSection({
    tree: cloneTree(parseTreeFile(idlerTreeFile)),
    effectHost: 'upgrade',
    getEffects: () => effects,
    setEffects: (next) => {
      effects = next
    },
  })
  document.body.append(section)
  const row = (label: string): HTMLElement =>
    [...section.querySelectorAll<HTMLElement>('.ed-field')].find(
      (r) => r.querySelector('.ed-field-label')?.textContent === label,
    )!
  return {
    saved: (): EffectEntry => effects[0],
    row,
    fieldError: (label: string): string =>
      row(label).querySelector('.ed-field-error')?.textContent ?? '',
    blockError: (): string => section.querySelector('.ed-effect > .ed-error')?.textContent ?? '',
    setNumber: (label: string, value: string): void => {
      const input = row(label).querySelector('input')!
      input.value = value
      input.dispatchEvent(new Event('change'))
    },
  }
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('effects editor — per-field errors', () => {
  it('shows every invalid param under its own row, naming the param and value', () => {
    const form = mount({ type: 'batteryBand', band: 'high', threshold: 0.5, bonus: 0.2 })

    form.setNumber('threshold', '2')
    form.setNumber('bonus', '-3')

    expect(form.fieldError('threshold')).toBe('threshold must be < 1; got 2')
    expect(form.fieldError('bonus')).toBe('bonus must be > 0; got -3')
    expect(form.fieldError('band')).toBe('')
    expect(form.blockError()).toBe('')
    expect(form.saved()).toMatchObject({ threshold: 0.5, bonus: 0.2 })
  })

  it('clears a field error once the value is fixed', () => {
    const form = mount({ type: 'batteryBand', band: 'high', threshold: 0.5, bonus: 0.2 })

    form.setNumber('bonus', '-3')
    form.setNumber('bonus', '0.4')

    expect(form.fieldError('bonus')).toBe('')
    expect(form.saved()).toMatchObject({ bonus: 0.4 })
  })

  it('keeps a pathless cross-field rule on the block line', () => {
    const form = mount({ type: 'attackAlert', leadSec: 5 })

    form.setNumber('leadSec (optional)', '')

    expect(form.blockError()).toContain('attackAlert must grant a lead')
    expect(form.fieldError('leadSec (optional)')).toBe('')
  })
})
