/** A keyboard shortcut entry for the player manual. */
export interface HotkeyEntry {
  /** Key combination displayed to the player (e.g., "Ctrl+1…0"). */
  readonly key: string
  /** Which screen(s) this hotkey is active on. */
  readonly context: string
  /** What the hotkey does. */
  readonly action: string
  /** Optional extra notes. */
  readonly note?: string
}

/** All keyboard shortcuts in the game. Add new entries here when adding hotkeys. */
export const HOTKEYS: readonly HotkeyEntry[] = [
  // ── Navigation ──
  {
    key: 'Escape',
    context: 'Playing / Countdown',
    action: 'Quit the current match and return to the lobby.',
  },
  {
    key: 'Escape',
    context: 'Waiting / Room',
    action: 'Cancel matchmaking or leave the room.',
  },

  // ── Panel switching ──
  {
    key: 'Ctrl+1 … Ctrl+9, Ctrl+0',
    context: 'Playing',
    action: 'Jump to panel 1–10 directly.',
    note: 'Ctrl+1 = first panel, Ctrl+0 = tenth panel. Locked panels are skipped.',
  },
  {
    key: 'Ctrl+←',
    context: 'Playing',
    action: 'Switch to the previous panel.',
  },
  {
    key: 'Ctrl+→',
    context: 'Playing',
    action: 'Switch to the next panel.',
  },

  // ── Gameplay ──
  {
    key: 'Space',
    context: 'Playing (Clicker)',
    action: 'Click for income.',
  },
  {
    key: 'Tab',
    context: 'Playing (Idler)',
    action: 'Cycle the highlighted resource.',
  },
  {
    key: 'C',
    context: 'Playing',
    action: 'Buy all affordable upgrades (cheapest first).',
  },
  {
    key: '1–9',
    context: 'Playing',
    action: 'Buy the Nth upgrade in the play panel.',
  },

  // ── Tab grid (when focused) ──
  {
    key: '← → ↑ ↓',
    context: 'Tab grid focused',
    action: 'Navigate between tabs in the 5×2 grid.',
  },
  {
    key: 'Home / End',
    context: 'Tab grid focused',
    action: 'Jump to first / last panel.',
  },
]
