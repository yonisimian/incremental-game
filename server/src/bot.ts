import type {
  CurrencyHighlight,
  GameMode,
  PlayerState,
  UpgradeDefinition,
  UpgradeId,
} from '@game/shared'

// ─── Types ───────────────────────────────────────────────────────────

/** A single bot decision. */
export type BotAction =
  | { type: 'click' }
  | { type: 'buy'; upgradeId: UpgradeId }
  | { type: 'set_highlight'; highlight: CurrencyHighlight }

/** Strategy interface — one `decide` call per game tick. */
export interface BotStrategy {
  /** Return zero or more actions to execute this tick. */
  decide(state: Readonly<PlayerState>, tickSec: number): BotAction[]
}

// ─── Clicker Bot ─────────────────────────────────────────────────────

/**
 * Medium-difficulty clicker bot.
 * - Clicks at a randomized rate (~8–12 CPS).
 * - Buys the cheapest affordable upgrade each tick.
 */
export class ClickerBot implements BotStrategy {
  private readonly upgrades: readonly UpgradeDefinition[]

  constructor(upgrades: readonly UpgradeDefinition[]) {
    this.upgrades = upgrades
  }

  decide(state: Readonly<PlayerState>, tickSec: number): BotAction[] {
    const actions: BotAction[] = []

    // Randomized clicking: ~8–12 CPS, scaled by tick duration
    const cps = 8 + Math.random() * 4
    const clicks = Math.round(cps * tickSec)
    for (let i = 0; i < clicks; i++) {
      actions.push({ type: 'click' })
    }

    // Buy cheapest affordable upgrade
    const affordable = this.upgrades
      .filter((u) => {
        if (!u.repeatable && state.upgrades[u.id]) return false
        return state.currency >= u.cost
      })
      .sort((a, b) => a.cost - b.cost)

    if (affordable.length > 0) {
      actions.push({ type: 'buy', upgradeId: affordable[0].id })
    }

    return actions
  }
}

// ─── Idler Bot ───────────────────────────────────────────────────────

/**
 * Medium-difficulty idler bot.
 * Strategy: TR×2 → SA → LM (strong from sim analysis).
 * Switches highlight between ale/wood as needed for the next target upgrade.
 */
export class IdlerBot implements BotStrategy {
  /** Ordered upgrade plan. */
  private readonly plan: { id: UpgradeId; currency: CurrencyHighlight }[] = [
    { id: 'tavern-recruits', currency: 'ale' },
    { id: 'tavern-recruits', currency: 'ale' },
    { id: 'sharpened-axes', currency: 'wood' },
    { id: 'lumber-mill', currency: 'wood' },
  ]

  private planIndex = 0

  private readonly upgradeMap: ReadonlyMap<UpgradeId, UpgradeDefinition>

  constructor(upgrades: readonly UpgradeDefinition[]) {
    this.upgradeMap = new Map(upgrades.map((u) => [u.id, u]))
  }

  decide(state: Readonly<PlayerState>): BotAction[] {
    const actions: BotAction[] = []

    if (this.planIndex >= this.plan.length) return actions

    const next = this.plan[this.planIndex]
    const def = this.upgradeMap.get(next.id)
    if (!def) return actions

    // Switch highlight if needed
    if (state.highlight !== next.currency) {
      actions.push({ type: 'set_highlight', highlight: next.currency })
    }

    // Buy when affordable
    // NOTE: planIndex advances optimistically here, assuming processBotActions
    // will accept the purchase. This is safe because both check the same balance,
    // but if validation logic diverges in the future this coupling could break.
    const balance = next.currency === 'wood' ? (state.wood ?? 0) : (state.ale ?? 0)
    if (balance >= def.cost) {
      actions.push({ type: 'buy', upgradeId: next.id })
      this.planIndex++

      // After buying, if plan has more steps, switch highlight for next goal
      if (this.planIndex < this.plan.length) {
        const upcoming = this.plan[this.planIndex]
        if (upcoming.currency !== next.currency) {
          actions.push({ type: 'set_highlight', highlight: upcoming.currency })
        }
      } else {
        // Plan done — focus on wood for max score
        actions.push({ type: 'set_highlight', highlight: 'wood' })
      }
    }

    return actions
  }
}

// ─── Factory ─────────────────────────────────────────────────────────

/** Create a bot strategy for the given game mode. */
export function createBot(mode: GameMode, upgrades: readonly UpgradeDefinition[]): BotStrategy {
  return mode === 'clicker' ? new ClickerBot(upgrades) : new IdlerBot(upgrades)
}
