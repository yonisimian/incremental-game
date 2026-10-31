// @vitest-environment happy-dom
//
// The tree editor shows one category at a time, like the game with categories
// on. DOM tier because the behavior is the category bar's wiring: which nodes
// the canvas draws, and where a new root lands.

import { afterEach, describe, expect, it } from 'vitest'
import { parseTreeFile } from '@game/shared'
import type { TreeFile } from '@game/shared'
import idlerTreeFile from '@game/shared/trees/idler.json'
import { categoryOf, cloneTree } from '../src/dev/editor/model.js'
import { createTreeView } from '../src/dev/editor/views/tree.js'
import type { EditorContext, EditorView } from '../src/dev/editor/views/types.js'

let view: EditorView | null = null

function mount(): { tree: TreeFile; status: string[] } {
  const tree = cloneTree(parseTreeFile(idlerTreeFile))
  const status: string[] = []
  const ctx: EditorContext = {
    tree,
    markDirty: () => {},
    setStatus: (text) => status.push(text),
    requestRefresh: () => {},
  }
  const host = document.createElement('div')
  document.body.appendChild(host)
  view = createTreeView()
  view.mount(host, ctx)
  return { tree, status }
}

const button = (id: string) => document.querySelector<HTMLButtonElement>(`#${id}`)!
const nameField = () => document.querySelector<HTMLInputElement>('#ed-cat-name')!
const iconField = () => document.querySelector<HTMLInputElement>('#ed-cat-icon')!
const drawn = () =>
  [...document.querySelectorAll<HTMLElement>('.ed-node')].map((n) => n.dataset.nodeId)

afterEach(() => {
  view?.unmount()
  view = null
  document.body.innerHTML = ''
})

describe('tree editor categories', () => {
  it('opens on the first category and draws only its nodes', () => {
    mount()
    expect(nameField().value).toBe('Goal')
    expect(drawn()).toEqual(['goal'])
  })

  it('steps through categories with the arrows, wrapping around', () => {
    mount()
    button('ed-cat-next').click()
    expect(nameField().value).toBe('Base Production')
    button('ed-cat-prev').click()
    button('ed-cat-prev').click()
    expect(nameField().value).toBe('Espionage')
  })

  it('shows the whole tree under All, and returns to the category after', () => {
    mount()
    button('ed-cat-next').click()
    const all = document.querySelector<HTMLInputElement>('#ed-cat-all')!
    all.click()
    expect(drawn()).toContain('goal')
    expect(drawn()).toContain('g1-g2')
    expect(button('ed-cat-next').disabled).toBe(true)
    all.click()
    expect(nameField().value).toBe('Base Production')
  })

  it('adds a root to the category on screen', () => {
    const { tree } = mount()
    button('ed-cat-next').click()
    button('ed-add-btn').click()
    const added = drawn().find((id) => id?.startsWith('node'))!
    expect(categoryOf(tree, added)).toBe(tree.categories[1].id)
  })

  it('renames the category on screen', () => {
    const { tree } = mount()
    nameField().value = 'Throne'
    nameField().dispatchEvent(new Event('change'))
    expect(tree.flavors[0].categories[0].name).toBe('Throne')
  })

  it('sets the icon of the category on screen', () => {
    const { tree } = mount()
    expect(iconField().value).toBe('👑')
    iconField().value = '🏆'
    iconField().dispatchEvent(new Event('change'))
    expect(tree.flavors[0].categories[0].icon).toBe('🏆')
  })

  it('adds a category, switches to it, and deletes it while empty', () => {
    const { tree } = mount()
    const before = tree.categories.length
    button('ed-cat-add').click()
    expect(tree.categories).toHaveLength(before + 1)
    expect(iconField().value).toBe('📁')
    expect(drawn()).toEqual([])
    expect(button('ed-cat-delete').disabled).toBe(false)
    button('ed-cat-delete').click()
    expect(tree.categories).toHaveLength(before)
  })

  it("won't delete a category that holds nodes", () => {
    mount()
    expect(button('ed-cat-delete').disabled).toBe(true)
  })
})
