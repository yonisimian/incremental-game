/**
 * Envelopes pane (Balance tab) — hosts the envelope editor against its own
 * balance-sidecar working copy, independent of the tree editor. The selected
 * mode's bundled tree is supplied read-only so the view knows which goal types
 * exist. A mode without a sidecar starts from an empty one, ready to author and
 * export as `shared/balance/<mode>.json`.
 */

import { CURRENT_BALANCE_VERSION, parseBalanceFile, parseTreeFile } from '@game/shared'
import type { BalanceFile, GameMode } from '@game/shared'
import { BUNDLED_BALANCES, bundledTree } from './bundled-modes.js'
import { cloneBalance } from './editor/model.js'
import { createEnvelopesView } from './editor/views/envelopes.js'
import type { EditorContext, EditorView } from './editor/views/types.js'

/** The bundled balance sidecar for `mode`, or an empty one if it has none. */
function bundledBalance(mode: GameMode): BalanceFile {
  const raw = BUNDLED_BALANCES.get(mode)
  return raw === undefined
    ? { version: CURRENT_BALANCE_VERSION, mode, envelopes: [] }
    : parseBalanceFile(raw)
}

/** Mount the envelopes editor into `pane` for `mode` (the dev panel's selected tree). */
export function initEnvelopes(pane: HTMLElement, mode: GameMode): void {
  pane.innerHTML = `
    <div class="ed-root">
      <div class="ed-toolbar">
        <button id="env-reset-btn" class="ed-btn">↺ Reset to ${mode}</button>
        <span id="env-status" class="ed-status"></span>
      </div>
      <div class="ed-section-host" id="env-host"></div>
    </div>`

  const host = pane.querySelector<HTMLDivElement>('#env-host')!
  const status = pane.querySelector<HTMLSpanElement>('#env-status')!
  const resetBtn = pane.querySelector<HTMLButtonElement>('#env-reset-btn')!
  const tree = parseTreeFile(bundledTree(mode))

  let view: EditorView | null = null

  const setStatus = (text: string, isError = false): void => {
    status.textContent = text
    status.classList.toggle('error', isError)
  }

  const mount = (): void => {
    view?.unmount()
    host.innerHTML = ''
    view = createEnvelopesView(cloneBalance(bundledBalance(mode)))
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
    setStatus(`Reset to ${mode} balance`)
  })

  mount()
}
