// ─── Modal ───────────────────────────────────────────────────────────
//
// The shared overlay shell (backdrop, header, close button) behind the settings
// and report-a-bug dialogs. Closes on the ✕ button, a backdrop click, or Escape.

const CLOSE_ICON = `
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
    <path d="M5 5L15 15M15 5L5 15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  </svg>`

// Fallback removal in case `transitionend` never fires (e.g. reduced motion).
const CLOSE_FALLBACK_MS = 250

/**
 * Mount a modal with overlay id `id`, a `title` heading and `body` HTML (both
 * trusted — interpolated as markup). Returns the overlay, or `null` if already open.
 */
export function openModal(id: string, title: string, body: string): HTMLElement | null {
  if (document.getElementById(id)) return null

  document.body.insertAdjacentHTML(
    'beforeend',
    `<div class="modal-overlay" id="${id}">
      <div class="modal" role="dialog" aria-modal="true" aria-label="${title}">
        <header class="modal-header">
          <h2>${title}</h2>
          <button class="modal-close" aria-label="Close">${CLOSE_ICON}</button>
        </header>
        ${body}
      </div>
    </div>`,
  )
  const overlay = document.getElementById(id)!

  let openingFrame: number | null = requestAnimationFrame(() => {
    openingFrame = null
    overlay.classList.add('visible')
  })

  const onKeydown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') close()
  }

  function close(): void {
    document.removeEventListener('keydown', onKeydown)
    if (openingFrame !== null) {
      cancelAnimationFrame(openingFrame)
      openingFrame = null
    }
    if (!overlay.classList.contains('visible')) {
      overlay.remove()
      return
    }
    const remove = (): void => {
      clearTimeout(timer)
      overlay.remove()
    }
    const timer = window.setTimeout(remove, CLOSE_FALLBACK_MS)
    overlay.addEventListener('transitionend', remove, { once: true })
    overlay.classList.remove('visible')
  }

  overlay.querySelector('.modal-close')!.addEventListener('click', close)
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close()
  })
  document.addEventListener('keydown', onKeydown)
  return overlay
}
