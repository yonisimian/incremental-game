import { buildEffectsSection } from '../effects-editor.js'
import { el } from './dom.js'
import type { EditorContext, EditorView } from './types.js'

/**
 * The mode-level effects section: the bonuses every player starts a round with
 * (a flat base rate is a `baseModifier` targeting a base producer `bK`) plus any
 * state-derived effect that applies unconditionally. Backed by the tree file's
 * `startingEffects`, the same list the runtime reads as `ModeDefinition.effects`.
 */
export function createStartingEffectsView(): EditorView {
  let host: HTMLElement | null = null
  let ctx: EditorContext | null = null

  const render = (): void => {
    if (!host || !ctx) return
    // Narrowed once so the effects-section callbacks close over a non-null
    // context rather than re-asserting on every edit.
    const context = ctx
    const tree = context.tree

    host.innerHTML = ''
    const root = el('div', 'ed-gen-root')
    const left = el('div', 'ed-gen-edit')

    const toolbar = el('div', 'ed-form-toolbar')
    toolbar.append(
      el('div', undefined, 'Effects applied to every player for the whole round (no purchase)'),
    )
    left.append(toolbar)

    const list = el('div', 'ed-gen-list')
    list.append(
      buildEffectsSection({
        tree,
        effectHost: 'mode',
        getEffects: () => tree.startingEffects,
        setEffects: (next) => {
          tree.startingEffects = [...next]
          context.markDirty()
        },
      }),
    )
    left.append(list)

    root.append(left)
    host.append(root)
  }

  return {
    mount(h, c) {
      host = h
      ctx = c
      render()
    },
    refresh: render,
    unmount() {
      if (host) host.innerHTML = ''
      host = null
      ctx = null
    },
  }
}
