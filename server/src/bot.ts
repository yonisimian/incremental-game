import type { GameMode, ModeDefinition, PlayerState, UpgradeDefinition } from '@game/shared'
import { isMaxed } from '@game/shared'

// ─── Types ───────────────────────────────────────────────────────

/** A single bot decision. */
type BotAction =
  | { type: 'click' }
  | { type: 'buy'; upgradeId: string }
  | { type: 'set_highlight'; highlight: string }

/** Strategy interface — one `decide` call per game tick. */
export interface BotStrategy {
  /** Return zero or more actions to execute this tick. */
  decide(state: Readonly<PlayerState>, tickSec: number): BotAction[]
}

// ─── Clicker Bot ─────────────────────────────────────────────────────

/**
 * Medium-difficulty clicker bot.
 * - Clicks at a randomized rate (~4–7 CPS).
 * - Buys the cheapest affordable upgrade with a ~1.5–2.5 s reaction delay.
 */
export class ClickerBot implements BotStrategy {
  private readonly upgrades: readonly UpgradeDefinition[]
  private readonly scoreResource: string
  /** Accumulated seconds since the last purchase attempt. */
  private purchaseCooldown = 0
  /** Pre-rolled delay before the next purchase attempt. */
  private nextPurchaseDelay = 1.5 + Math.random()

  constructor(upgrades: readonly UpgradeDefinition[], scoreResource: string) {
    this.upgrades = upgrades
    this.scoreResource = scoreResource
  }

  decide(state: Readonly<PlayerState>, tickSec: number): BotAction[] {
    const actions: BotAction[] = []

    // Randomized clicking: ~4–7 CPS, scaled by tick duration
    const cps = 4 + Math.random() * 3
    const clicks = Math.round(cps * tickSec)
    for (let i = 0; i < clicks; i++) {
      actions.push({ type: 'click' })
    }

    // Buy cheapest affordable upgrade with a ~1.5–2.5 s reaction delay
    this.purchaseCooldown += tickSec
    if (this.purchaseCooldown >= this.nextPurchaseDelay) {
      const affordable = this.upgrades
        .filter((u) => {
          const currentLevel = state.upgrades[u.id] ?? 0
          if (isMaxed(u, currentLevel)) return false
          const costResource = u.costCurrency ?? this.scoreResource
          return (state.resources[costResource] ?? 0) >= u.cost
        })
        .sort((a, b) => a.cost - b.cost)

      if (affordable.length > 0) {
        actions.push({ type: 'buy', upgradeId: affordable[0].id })
      }
      // Reset regardless — don't let cooldown accumulate past the threshold
      this.purchaseCooldown = 0
      this.nextPurchaseDelay = 1.5 + Math.random()
    }

    return actions
  }
}

// ─── Idler Bot ───────────────────────────────────────────────────────

/**
 * Medium-difficulty idler bot.
 * Strategy: u0 (Sharpened Axes) → u1 (Heavy Logging) → u2 (Royal Brewery),
 * then, under buy-upgrade goal, pursues Industrial Era → Royal Throne (trophy).
 * Switches highlight between resources as needed for the next target upgrade.
 */
export class IdlerBot implements BotStrategy {
  /** Ordered upgrade plan. */
  private readonly plan: { id: string; currency: string }[]

  private planIndex = 0

  private readonly upgradeMap: ReadonlyMap<string, UpgradeDefinition>

  constructor(upgrades: readonly UpgradeDefinition[]) {
    this.upgradeMap = new Map(upgrades.map((u) => [u.id, u]))

    // Base plan — core economy upgrades
    const basePlan: { id: string; currency: string }[] = [
      { id: 'u0', currency: 'r0' }, // Sharpened Axes (costs wood)
      { id: 'u1', currency: 'r0' }, // Heavy Logging (costs wood)
      { id: 'u2', currency: 'r1' }, // Royal Brewery (costs ale)
    ]

    // If the trophy is available (buy-upgrade goal), append its prereq chain.
    // Walk the prerequisite edges backwards from the trophy to build a
    // dependency-ordered path, skipping any upgrades already in the base plan.
    const trophy = upgrades.find((u) => u.goalType === 'buy-upgrade')
    if (trophy) {
      const basePlanIds = new Set(basePlan.map((s) => s.id))
      const trophyPath = this.resolvePath(trophy, basePlanIds)
      basePlan.push(...trophyPath)
    }

    this.plan = basePlan

    // Validate plan entries against actual upgrade definitions (fail-fast).
    for (const step of this.plan) {
      if (!this.upgradeMap.has(step.id)) {
        throw new Error(
          `[IdlerBot] plan references unknown upgrade '${step.id}'. ` +
            `Available: ${[...this.upgradeMap.keys()].join(', ')}`,
        )
      }
    }
  }

  /**
   * Build a dependency-ordered list of plan steps from `target` back through
   * its prerequisites, skipping anything already covered by `existing`.
   */
  private resolvePath(
    target: UpgradeDefinition,
    existing: ReadonlySet<string>,
  ): { id: string; currency: string }[] {
    const result: { id: string; currency: string }[] = []
    const visited = new Set<string>(existing)

    const visit = (id: string): void => {
      if (visited.has(id)) return
      visited.add(id)
      const def = this.upgradeMap.get(id)
      if (!def) return
      for (const prereq of def.prerequisites ?? []) {
        visit(prereq)
      }
      result.push({ id, currency: def.costCurrency ?? 'r0' })
    }

    visit(target.id)
    return result
  }

  decide(state: Readonly<PlayerState>): BotAction[] {
    const actions: BotAction[] = []

    if (this.planIndex >= this.plan.length) return actions

    const next = this.plan[this.planIndex]
    const def = this.upgradeMap.get(next.id)
    if (!def) return actions

    // Switch highlight if needed
    if (state.meta.highlight !== next.currency) {
      actions.push({ type: 'set_highlight', highlight: next.currency })
    }

    // Buy when affordable
    const balance = state.resources[next.currency] ?? 0
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
        // Plan done — focus on r0 (score resource) for max score
        actions.push({ type: 'set_highlight', highlight: 'r0' })
      }
    }

    return actions
  }
}

// ─── Factory ─────────────────────────────────────────────────────────

/**
 * Create a bot strategy for the given game mode.
 *
 * `availableUpgrades` is the goal-filtered list (typically from
 * `getAvailableUpgrades(modeDef, goal)`); bots only consider these. Under
 * goals that hide the trophy, the bot doesn't see it. Under buy-upgrade,
 * the idler bot detects the trophy and builds a plan to reach it via its
 * prerequisite chain.
 */
export function createBot(
  mode: GameMode,
  modeDef: ModeDefinition,
  availableUpgrades: readonly UpgradeDefinition[] = modeDef.upgrades,
): BotStrategy {
  return mode === 'clicker'
    ? new ClickerBot(availableUpgrades, modeDef.scoreResource)
    : new IdlerBot(availableUpgrades)
}
