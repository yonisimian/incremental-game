/** A panel entry for the player manual. */
export interface PanelEntry {
  /** Panel icon (emoji, matches the tab button). */
  readonly icon: string
  /** Panel display name. */
  readonly name: string
  /** One-line description of what this panel does. */
  readonly description: string
}

/** All in-game panels. Add an entry here when creating a new panel. */
export const PANELS: readonly PanelEntry[] = [
  {
    icon: '🎮',
    name: 'Play',
    description:
      'Main gameplay — click for income (Clicker) or manage resource highlighting (Idler).',
  },
  {
    icon: '🏭',
    name: 'Generators',
    description: 'Buy generators for passive income — each copy produces resources every second.',
  },
  {
    icon: '🌳',
    name: 'Upgrades',
    description: 'Skill tree — purchase upgrades to boost income, unlock multipliers, and win.',
  },
]
