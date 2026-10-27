// ─── About Modal ─────────────────────────────────────────────────────
//
// A small overlay opened from the lobby's "i" button. Says what the game is.

import { openModal } from './modal.js'

export function openAbout(): void {
  openModal(
    'about-overlay',
    'About',
    `<div class="modal-body about-body">
      <p>
        incremen<span class="brand-t">T</span>al is a head-to-head incremental game: you and a
        rival race to build the bigger score before the clock runs out.
      </p>
    </div>`,
  )
}
