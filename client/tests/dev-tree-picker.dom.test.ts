// @vitest-environment happy-dom
//
// The dev panel's Tree picker chooses which mode the Queue, Envelopes, and
// Editor tabs work on. DOM tier: what matters is that the picker lists every
// bundled tree and that switching remounts the tree-bound tabs on the new one.
// Only one tree ships, so a second mode is bundled here as a copy of it.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getAvailableModes, getModeDefinition, registerMode } from '@game/shared'
import { initDevPanel } from '../src/dev/ui.js'
import { resetDom } from './dom-harness.js'

/** A second mode to switch to: the idler tree under another id. */
const COPY = 'idler-copy'

type BundledModes = typeof import('../src/dev/bundled-modes.js')

// The Envelopes tab resolves its tree through the bundled map, so the copy
// must be bundled too, not just registered.
vi.mock('../src/dev/bundled-modes.js', async (importOriginal) => {
  const actual = await importOriginal<BundledModes>()
  const trees = new Map([
    ...actual.BUNDLED_TREES,
    ['idler-copy', actual.BUNDLED_TREES.get('idler')],
  ])
  return {
    ...actual,
    BUNDLED_TREES: trees,
    bundledTree: (mode: string) => {
      if (!trees.has(mode)) throw new Error(`No bundled tree for mode '${mode}'`)
      return trees.get(mode)
    },
  } satisfies BundledModes
})

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
  registerMode(COPY, getModeDefinition('idler'))
  root = document.createElement('div')
  document.body.append(root)
  initDevPanel(root)
})

afterEach(() => {
  resetDom()
})

describe('bundled trees', () => {
  it('bundles every tree file, keyed by file name, default mode first', async () => {
    const actual = await vi.importActual<BundledModes>('../src/dev/bundled-modes.js')
    expect([...actual.BUNDLED_TREES.keys()]).toEqual(['idler'])
  })
})

describe('dev panel tree picker (DOM)', () => {
  it('lists every loaded tree and starts on the default mode', () => {
    expect([...picker().options].map((o) => o.value)).toEqual(getAvailableModes())
    expect(picker().value).toBe('idler')
  })

  it('remounts the queue tab with the selected tree’s strategies', () => {
    const listText = (): string => root.querySelector('#q-list')!.textContent
    // Idler bundles reference strategies; a mode without any starts on one
    // empty scratch strategy.
    expect(listText()).not.toContain('Strategy 1')
    selectTree(COPY)
    expect(listText()).toContain('Strategy 1')
  })

  it('remounts the envelopes and editor tabs on the selected tree', () => {
    openTab('[data-subtab="envelopes"]')
    selectTree(COPY)
    expect(root.querySelector('#env-reset-btn')!.textContent).toContain(COPY)

    openTab('[data-tab="editor"]')
    expect(root.querySelector('#ed-reset-btn')!.textContent).toContain(COPY)
  })

  it('remembers the selection across reloads', () => {
    selectTree(COPY)
    resetDom()
    root = document.createElement('div')
    document.body.append(root)
    initDevPanel(root)
    expect(picker().value).toBe(COPY)
  })
})
