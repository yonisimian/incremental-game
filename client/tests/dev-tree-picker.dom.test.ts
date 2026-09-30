// @vitest-environment happy-dom
//
// The dev panel's Tree picker chooses which mode the Queue, Envelopes, and
// Editor tabs work on. DOM tier: what matters is that the picker lists every
// bundled tree and that switching remounts the tree-bound tabs on the new one.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getAvailableModes } from '@game/shared'
import { BUNDLED_TREES } from '../src/dev/bundled-modes.js'
import { initDevPanel } from '../src/dev/ui.js'
import { resetDom } from './dom-harness.js'

let root: HTMLElement

const picker = (): HTMLSelectElement => root.querySelector<HTMLSelectElement>('#dev-tree-select')!

function selectTree(mode: string): void {
  picker().value = mode
  picker().dispatchEvent(new Event('change'))
}

function openTab(selector: string): void {
  root.querySelector<HTMLButtonElement>(selector)!.click()
}

beforeEach(() => {
  localStorage.clear()
  root = document.createElement('div')
  document.body.append(root)
  initDevPanel(root)
})

afterEach(() => {
  resetDom()
})

describe('bundled trees', () => {
  it('bundles every tree file, keyed by file name, default mode first', () => {
    expect([...BUNDLED_TREES.keys()]).toEqual(['idler', 'idler-alternative'])
  })
})

describe('dev panel tree picker (DOM)', () => {
  it('lists every loaded tree and starts on the default mode', () => {
    expect([...picker().options].map((o) => o.value)).toEqual(getAvailableModes())
    expect(picker().value).toBe('idler')
  })

  it('remounts the queue tab with the selected tree’s strategies', () => {
    const listText = (): string => root.querySelector('#q-list')!.textContent
    // Idler bundles reference strategies; a tree without any starts on one
    // empty scratch strategy.
    expect(listText()).not.toContain('Strategy 1')
    selectTree('idler-alternative')
    expect(listText()).toContain('Strategy 1')
  })

  it('remounts the envelopes and editor tabs on the selected tree', () => {
    openTab('[data-subtab="envelopes"]')
    selectTree('idler-alternative')
    expect(root.querySelector('#env-reset-btn')!.textContent).toContain('idler-alternative')

    openTab('[data-tab="editor"]')
    expect(root.querySelector('#ed-reset-btn')!.textContent).toContain('idler-alternative')
  })

  it('remembers the selection across reloads', () => {
    selectTree('idler-alternative')
    resetDom()
    root = document.createElement('div')
    document.body.append(root)
    initDevPanel(root)
    expect(picker().value).toBe('idler-alternative')
  })
})
