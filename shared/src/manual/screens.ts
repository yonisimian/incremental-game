/** A game screen entry for the player manual. */
export interface ScreenEntry {
  /** Screen name as displayed to the player. */
  readonly name: string
  /** Brief description of what happens on this screen. */
  readonly description: string
}

/** All game screens in navigation order. */
export const SCREENS: readonly ScreenEntry[] = [
  {
    name: 'Lobby',
    description: 'Choose a game mode, set your name, and start matchmaking or create/join a room.',
  },
  {
    name: 'Waiting',
    description: 'In the quick-match queue — waiting for an opponent.',
  },
  {
    name: 'Room',
    description:
      'A private room where you can invite a friend, adjust settings (mode, goal), and start when ready.',
  },
  {
    name: 'Countdown',
    description: 'Matched! A 3-2-1 countdown before the round begins.',
  },
  {
    name: 'Playing',
    description:
      'The active game — earn resources, buy upgrades and generators, and outscore your opponent before time runs out or the goal is reached.',
  },
  {
    name: 'End',
    description: 'Round over — see scores, winner, and return to the lobby.',
  },
]
