// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openModal } from '../src/ui/modal.js'
import { resetDom } from './dom-harness.js'

const ID = 'test-overlay'
const count = (): number => document.querySelectorAll(`#${ID}`).length

describe('openModal (DOM)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    resetDom()
    vi.useRealTimers()
  })

  it('mounts once and refuses a second open while mounted', () => {
    expect(openModal(ID, 'Title', '<p>body</p>')).not.toBeNull()
    expect(openModal(ID, 'Title', '<p>body</p>')).toBeNull()
    expect(count()).toBe(1)
  })

  it('can reopen after being closed before its fade-in started', () => {
    const overlay = openModal(ID, 'Title', '')!
    overlay.querySelector<HTMLButtonElement>('.modal-close')!.click()
    expect(count()).toBe(0)

    vi.runAllTimers()
    expect(openModal(ID, 'Title', '')).not.toBeNull()
    expect(count()).toBe(1)
  })

  it('closes on Escape after it became visible, even without transitionend', () => {
    openModal(ID, 'Title', '')
    vi.runAllTimers()
    expect(document.getElementById(ID)!.classList.contains('visible')).toBe(true)

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    vi.runAllTimers()
    expect(count()).toBe(0)
  })

  it('ignores a bubbled child transitionend while fading out', () => {
    const overlay = openModal(ID, 'Title', '')!
    vi.runAllTimers()
    const closeBtn = overlay.querySelector<HTMLButtonElement>('.modal-close')!
    closeBtn.click()

    closeBtn.dispatchEvent(new Event('transitionend', { bubbles: true }))
    expect(count()).toBe(1)
    overlay.dispatchEvent(new Event('transitionend'))
    expect(count()).toBe(0)
  })

  it('closes on a backdrop click but not a click inside the dialog', () => {
    const overlay = openModal(ID, 'Title', '<p id="inside">x</p>')!
    document.getElementById('inside')!.click()
    expect(count()).toBe(1)

    overlay.click()
    expect(count()).toBe(0)
  })
})
