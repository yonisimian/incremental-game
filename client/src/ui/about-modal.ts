// ─── About Modal ─────────────────────────────────────────────────────
//
// A small overlay opened from the lobby's "i" button. Says what the game is,
// and opens the upgrade tree for reading before a first match.

import { openModal } from './modal.js'
import { openTreeReader } from './tree-reader.js'

export function openAbout(): void {
  const overlay = openModal(
    'about-overlay',
    'About',
    `<div class="modal-body about-body">
      <p>
        incremen<span class="brand-t">T</span>al is a head-to-head incremental game: you and a
        rival race to build the bigger score before the clock runs out.
      </p>
      <button class="about-tree-btn" id="about-tree-btn">🌳 Browse the upgrade tree</button>
    </div>`,
  )
  if (!overlay) return
  overlay.querySelector('#about-tree-btn')!.addEventListener('click', openTreeReader)
}
