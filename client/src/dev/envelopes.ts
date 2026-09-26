/**
 * Envelopes pane (Balance tab) — hosts the envelope editor against its own
 * balance-sidecar working copy, independent of the tree editor. The bundled
 * idler tree is supplied read-only so the view knows which goal types exist.
 */

import { parseBalanceFile, parseTreeFile } from '@game/shared'
import idlerBalanceFile from '@game/shared/balance/idler.json'
import idlerTreeFile from '@game/shared/trees/idler.json'
import { cloneBalance } from './editor/model.js'
import { createEnvelopesView } from './editor/views/envelopes.js'
import type { EditorContext, EditorView } from './editor/views/types.js'

/** Mount the envelopes editor into `pane`. */
export function initEnvelopes(pane: HTMLElement): void {
  pane.innerHTML = `
    <div class="ed-root">
      <div class="ed-toolbar">
        <button id="env-reset-btn" class="ed-btn">↺ Reset to idler</button>
        <span id="env-status" class="ed-status"></span>
      </div>
      <div class="ed-section-host" id="env-host"></div>
    </div>`

  const host = pane.querySelector<HTMLDivElement>('#env-host')!
  const status = pane.querySelector<HTMLSpanElement>('#env-status')!
  const resetBtn = pane.querySelector<HTMLButtonElement>('#env-reset-btn')!
  const tree = parseTreeFile(idlerTreeFile)

  let view: EditorView | null = null

  const setStatus = (text: string, isError = false): void => {
    status.textContent = text
    status.classList.toggle('error', isError)
  }

  const mount = (): void => {
    view?.unmount()
    host.innerHTML = ''
    view = createEnvelopesView(cloneBalance(parseBalanceFile(idlerBalanceFile)))
    const ctx: EditorContext = {
      tree,
      markDirty: () => {},
      setStatus,
      requestRefresh: () => view?.refresh?.(),
    }
    view.mount(host, ctx)
  }

  resetBtn.addEventListener('click', () => {
    mount()
    setStatus('Reset to idler balance')
  })

  mount()
}
