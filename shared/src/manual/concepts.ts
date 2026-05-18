/** A game concept entry for the player manual. */
export interface ConceptEntry {
  /** Concept heading. */
  readonly name: string
  /** Explanation paragraph(s) in Markdown. */
  readonly body: string
}

/** Core game concepts. Add new entries when introducing mechanics. */
export const CONCEPTS: readonly ConceptEntry[] = [
  {
    name: 'Objective',
    body: `Two players compete in real-time. Each round has a **goal** that determines how the winner is decided. Earn resources, spend them on upgrades and generators, and outscore your opponent.`,
  },
  {
    name: 'Resources & Score',
    body: `**Resources** are currencies you spend on upgrades and generators. **Score** is the total amount of the primary resource ("score resource") you've ever earned — it never decreases, even when you spend.`,
  },
  {
    name: 'Generators',
    body: `Generators produce passive income every second. Each copy you buy adds to your income rate. Their cost increases exponentially with each purchase (cost × scaling^owned).`,
  },
  {
    name: 'Upgrades',
    body: `Upgrades provide permanent bonuses — flat income boosts, multipliers, or special effects. Some are one-time purchases; others can be bought multiple times. Tree upgrades may require prerequisites.`,
  },
  {
    name: 'Goals',
    body: [
      '- **Timed**: Highest score when the timer runs out wins.',
      '- **Target Score**: First player to reach a target score wins (with a safety time cap).',
      '- **Buy Upgrade**: First player to buy a specific trophy upgrade wins (with a safety time cap).',
    ].join('\n'),
  },
  {
    name: 'Highlighting (Idler)',
    body: `In Idler mode, you can highlight a resource to double (or quadruple, with an upgrade) its production rate. Press **Tab** to cycle which resource is highlighted.`,
  },
  {
    name: 'Clicking (Clicker)',
    body: `In Clicker mode, each click earns income. Press **Space** or click the big button. Upgrades can increase click power.`,
  },
]
