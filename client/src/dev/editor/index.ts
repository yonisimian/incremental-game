/**
 * Editor shell — owns the single working-copy `TreeFile` and the file-level
 * toolbar (import / export / copy / reset / status), and hosts one
 * {@link EditorView} section at a time (resources · generators · upgrade tree).
 *
 * Sections are mounted lazily on switch and torn down on leave (each owns its
 * own listeners; the tree section's pan/zoom needs a visible host, which the
 * mount-on-switch guarantees). The shell re-mounts the active section whenever
 * it replaces the tree (import / reset) so views never see their `tree`
 * reference swapped underneath them.
 */

import { parseTreeFile, type TreeFile } from '@game/shared'
import idlerTreeFile from '@game/shared/trees/idler.json'
import { cloneTree } from './model.js'
import { exportTree, importTreeFromFile, treeToJson } from './io.js'
import type { EditorContext, EditorView } from './views/types.js'
import { createTreeView } from './views/tree.js'
import { createResourcesView } from './views/resources.js'
import { createGeneratorsView } from './views/generators.js'

type Section = 'resources' | 'generators' | 'tree'

const SECTIONS: readonly { id: Section; label: string }[] = [
  { id: 'resources', label: '💎 Resources' },
  { id: 'generators', label: '🏭 Generators' },
  { id: 'tree', label: '🌳 Upgrade Tree' },
]

const VIEW_FACTORIES: Record<Section, () => EditorView> = {
  resources: createResourcesView,
  generators: createGeneratorsView,
  tree: createTreeView,
}

function buildLayout(): string {
  const tabs = SECTIONS.map(
    (s) => `<button class="ed-section-tab" data-section="${s.id}">${s.label}</button>`,
  ).join('')
  return `
    <div class="ed-root">
      <div class="ed-toolbar">
        <button id="ed-import-btn" class="ed-btn">📂 Import</button>
        <input type="file" id="ed-file" accept="application/json,.json" hidden />
        <button id="ed-export-btn" class="ed-btn">💾 Export</button>
        <button id="ed-copy-btn" class="ed-btn">📋 Copy JSON</button>
        <button id="ed-reset-btn" class="ed-btn">↺ Reset to idler</button>
        <span id="ed-status" class="ed-status"></span>
      </div>
      <div class="ed-section-tabs">${tabs}</div>
      <div class="ed-section-host" id="ed-section-host"></div>
    </div>`
}

interface ShellState {
  tree: TreeFile
  dirty: boolean
  section: Section
}

/** Mount the editor into a pane element. Returns a teardown function. */
export function initEditor(pane: HTMLElement): () => void {
  pane.innerHTML = buildLayout()

  const host = pane.querySelector<HTMLDivElement>('#ed-section-host')!
  const status = pane.querySelector<HTMLSpanElement>('#ed-status')!
  const importBtn = pane.querySelector<HTMLButtonElement>('#ed-import-btn')!
  const exportBtn = pane.querySelector<HTMLButtonElement>('#ed-export-btn')!
  const copyBtn = pane.querySelector<HTMLButtonElement>('#ed-copy-btn')!
  const resetBtn = pane.querySelector<HTMLButtonElement>('#ed-reset-btn')!
  const fileInput = pane.querySelector<HTMLInputElement>('#ed-file')!
  const tabs = Array.from(pane.querySelectorAll<HTMLButtonElement>('.ed-section-tab'))

  const state: ShellState = {
    tree: cloneTree(parseTreeFile(idlerTreeFile)),
    dirty: false,
    section: 'tree',
  }

  let current: EditorView | null = null

  const setStatus = (text: string, isError = false): void => {
    status.textContent = text
    status.classList.toggle('error', isError)
  }

  const context = (): EditorContext => ({
    tree: state.tree,
    markDirty: () => {
      state.dirty = true
    },
    setStatus,
    requestRefresh: () => current?.refresh?.(),
  })

  const syncTabs = (): void => {
    for (const tab of tabs) {
      tab.classList.toggle('active', tab.dataset.section === state.section)
    }
  }

  // Tear down the active section and mount `state.section` fresh against the
  // current tree. Used on section switch and on tree replacement (import/reset).
  const mountSection = (): void => {
    current?.unmount()
    host.innerHTML = ''
    current = VIEW_FACTORIES[state.section]()
    current.mount(host, context())
    syncTabs()
  }

  for (const tab of tabs) {
    tab.addEventListener('click', () => {
      const section = tab.dataset.section as Section
      if (section === state.section) return
      state.section = section
      mountSection()
    })
  }

  // ── Toolbar ──
  importBtn.addEventListener('click', () => {
    fileInput.click()
  })
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0]
    if (!file) return
    void importTreeFromFile(file)
      .then((tree) => {
        state.tree = tree
        state.dirty = false
        mountSection()
        setStatus(`Loaded ${file.name}`)
      })
      .catch((err: unknown) => {
        setStatus(err instanceof Error ? err.message : 'Import failed', true)
      })
      .finally(() => {
        fileInput.value = ''
      })
  })

  exportBtn.addEventListener('click', () => {
    try {
      exportTree(state.tree)
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Export failed', true)
      return
    }
    state.dirty = false
    setStatus(`Exported ${state.tree.id}.json`)
  })

  copyBtn.addEventListener('click', () => {
    let json: string
    try {
      json = treeToJson(state.tree)
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Copy failed', true)
      return
    }
    void navigator.clipboard
      .writeText(json)
      .then(() => {
        setStatus(`Copied ${state.tree.id}.json to clipboard`)
      })
      .catch(() => {
        setStatus('Copy to clipboard failed', true)
      })
  })

  resetBtn.addEventListener('click', () => {
    state.tree = cloneTree(parseTreeFile(idlerTreeFile))
    state.dirty = false
    mountSection()
    setStatus('Reset to idler tree')
  })

  mountSection()

  return () => {
    current?.unmount()
    current = null
  }
}
