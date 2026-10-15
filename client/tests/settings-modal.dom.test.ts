// @vitest-environment happy-dom
//
// The Upgrade Tree chips must reflect and change the stored visibility mode.
// DOM tier because the failure is a click on a live modal not reaching the setting.

import { afterEach, describe, expect, it } from 'vitest'
import { openSettings } from '../src/ui/settings-modal.js'
import { getTreeVisibility, setTreeVisibility } from '../src/ui/tree-visibility.js'
import { getTreeCategories, setTreeCategories } from '../src/ui/tree-categories.js'
import { resetDom } from './dom-harness.js'

const chip = (mode: string) =>
  document.querySelector<HTMLButtonElement>(`[data-tree-visibility="${mode}"]`)!

afterEach(() => {
  setTreeVisibility('full')
  setTreeCategories(false)
  resetDom()
})

describe('settings modal — upgrade tree visibility', () => {
  it('selects Full by default', () => {
    openSettings()
    expect(chip('full').classList.contains('selected')).toBe(true)
    expect(chip('hidden').classList.contains('selected')).toBe(false)
    expect(chip('peek').classList.contains('selected')).toBe(false)
  })

  it('selects and stores the mode the player clicks', () => {
    openSettings()
    chip('peek').click()

    expect(getTreeVisibility()).toBe('peek')
    expect(localStorage.getItem('tree-visibility')).toBe('peek')
    expect(chip('peek').classList.contains('selected')).toBe(true)
    expect(chip('full').classList.contains('selected')).toBe(false)
  })
})

describe('settings modal — upgrade categories', () => {
  const categoryChip = (value: 'on' | 'off') =>
    document.querySelector<HTMLButtonElement>(`[data-tree-categories="${value}"]`)!

  it('selects Off by default', () => {
    openSettings()
    expect(categoryChip('off').classList.contains('selected')).toBe(true)
    expect(categoryChip('on').classList.contains('selected')).toBe(false)
  })

  it('turns categories on and stores it', () => {
    openSettings()
    categoryChip('on').click()

    expect(getTreeCategories()).toBe(true)
    expect(localStorage.getItem('tree-categories')).toBe('on')
    expect(categoryChip('on').classList.contains('selected')).toBe(true)
    expect(categoryChip('off').classList.contains('selected')).toBe(false)
  })
})
