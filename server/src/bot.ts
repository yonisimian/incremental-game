import type {
  GameMode,
  GeneratorDefinition,
  ModeDefinition,
  PlayerState,
  UpgradeDefinition,
} from '@game/shared'
import {
  collectBatteryParams,
  getHighlightMultiplier,
  isHighlightBatteryActive,
  readBatteryCharge,
  readHighlight,
  getPrerequisiteUpgradeIds,
  getCostCurrency,
  generatorCostCurrency,
  getGeneratorCost,
  getUpgradeNextCost,
  isCostAffordable,
  isGeneratorUnlocked,
  resolveGeneratorDef,
} from '@game/shared'

// ─── Types ───────────────────────────────────────────────────────

/** A single bot decision. */
type BotAction =
  | { type: 'click'; resource: string }
  | { type: 'buy'; upgradeId: string }
  | { type: 'buy_generator'; generatorId: string }
  | { type: 'set_highlight'; highlight: string | null }

/** Strategy interface — one `decide` call per game tick. */
export interface BotStrategy {
  /** Return zero or more actions to execute this tick. */
  decide(state: Readonly<PlayerState>, tickSec: number): BotAction[]
}

// ─── Tunables ────────────────────────────────────────────────────────

/** Clicks the bot fires each tick when clicking is enabled. */
const CLICKS_PER_TICK = 4
/** Max generator copies the bot buys in a single tick (keeps `decide` bounded). */
const MAX_GENERATOR_BUYS_PER_TICK = 3
/**
 * While the bot owns fewer than this many generators total (and at least one is
 * unlocked), it farms the generator currency to seed its economy before
 * returning to its plan/score focus. Tune via the balance dev panel.
 */
const GENERATOR_SEED_TARGET = 12

/** Most common cost currency among a set of generators (the "funding" currency). */
function dominantGeneratorCurrency(generators: readonly GeneratorDefinition[]): string | null {
  const counts = new Map<string, number>()
  for (const g of generators) {
    const currency = generatorCostCurrency(g)
    counts.set(currency, (counts.get(currency) ?? 0) + 1)
  }
  let best: string | null = null
  let bestCount = 0
  for (const [cur, count] of counts) {
    if (count > bestCount) {
      best = cur
      bestCount = count
    }
  }
  return best
}

/** Does owning this upgrade unlock one or more generators? */
function unlocksGenerator(upgrade: UpgradeDefinition): boolean {
  return (upgrade.effects ?? []).some((e) => e.type === 'generatorUnlock')
}

// ─── Idler Bot ───────────────────────────────────────────────────────

/**
 * Medium-difficulty idler bot.
 *
 * Each tick it: picks a "farm" currency (the generator currency while seeding
 * its economy, otherwise its plan/score currency), highlights and clicks that
 * currency, advances its upgrade plan, and reinvests spare currency into
 * unlocked generators.
 *
 * The plan is: be-af-mr → the generator-unlock upgrades (free, so they fire
 * early and start passive income) → under the buy-upgrade goal, the Royal
 * Throne (trophy) via its prerequisite chain.
 */
export class IdlerBot implements BotStrategy {
  /** Ordered upgrade plan. */
  private readonly plan: { id: string; currency: string }[]

  private planIndex = 0

  /**
   * Whether the bot is currently in the lantern's recharge half-cycle (highlight
   * released). Hysteresis state, so it must persist between ticks — deriving it
   * from the charge alone would flap at both ends of the tank.
   */
  private recharging = false

  private readonly upgradeMap: ReadonlyMap<string, UpgradeDefinition>

  private readonly modeDef: ModeDefinition

  private readonly generators: readonly GeneratorDefinition[]

  private readonly clicksEnabled: boolean

  private readonly scoreResource: string

  /** Currency the bot farms to fund generators (most common generator cost). */
  private readonly generatorCurrency: string

  constructor(
    modeDef: ModeDefinition,
    availableUpgrades: readonly UpgradeDefinition[] = modeDef.upgrades,
  ) {
    this.modeDef = modeDef
    this.generators = modeDef.generators
    this.clicksEnabled = modeDef.clicksEnabled
    this.scoreResource = modeDef.scoreResource
    this.generatorCurrency = dominantGeneratorCurrency(this.generators) ?? this.scoreResource

    this.upgradeMap = new Map(availableUpgrades.map((u) => [u.id, u]))

    // Base plan — core economy seed.
    const basePlan: { id: string; currency: string }[] = [{ id: 'be-af-mr', currency: 'r0' }]
    const includedIds = new Set(basePlan.map((s) => s.id))

    // Generator-unlock upgrades next: they're free, so buying them early opens
    // up passive income (and the generators panel) as soon as possible.
    for (const upgrade of availableUpgrades) {
      if (!unlocksGenerator(upgrade)) continue
      const path = this.resolvePath(upgrade, includedIds)
      for (const step of path) includedIds.add(step.id)
      basePlan.push(...path)
    }

    // If the trophy is available (buy-upgrade goal), append its prereq chain.
    const trophy = availableUpgrades.find((u) => u.goalType === 'buy-upgrade')
    if (trophy) {
      basePlan.push(...this.resolvePath(trophy, includedIds))
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
      for (const prereq of getPrerequisiteUpgradeIds(def.prerequisites)) {
        visit(prereq)
      }
      result.push({ id, currency: getCostCurrency(def, 'r0') })
    }

    visit(target.id)
    return result
  }

  /**
   * Which currency to farm (highlight + click) this tick. While the bot still
   * wants to stock generators it farms the generator currency; otherwise it
   * follows its plan, ending on the score resource once the plan is exhausted.
   */
  private farmCurrency(state: Readonly<PlayerState>): string {
    if (this.shouldFarmGenerators(state)) return this.generatorCurrency
    if (this.planIndex < this.plan.length) return this.plan[this.planIndex].currency
    return this.scoreResource
  }

  /** True while at least one generator is unlocked and the seed target is unmet. */
  private shouldFarmGenerators(state: Readonly<PlayerState>): boolean {
    if (this.generators.length === 0) return false
    let totalOwned = 0
    for (const g of this.generators) totalOwned += state.generators[g.id] ?? 0
    if (totalOwned >= GENERATOR_SEED_TARGET) return false
    return this.generators.some((g) => isGeneratorUnlocked(state, g, this.modeDef))
  }

  /** Buy the current plan target when affordable, advancing the plan. */
  private advancePlan(state: Readonly<PlayerState>, actions: BotAction[]): void {
    if (this.planIndex >= this.plan.length) return
    const next = this.plan[this.planIndex]
    const def = this.upgradeMap.get(next.id)
    if (!def) return
    const owned = state.upgrades[next.id] ?? 0
    if (isCostAffordable(state.resources, getUpgradeNextCost(def, owned))) {
      actions.push({ type: 'buy', upgradeId: next.id })
      this.planIndex++
    }
  }

  /**
   * Reinvest into unlocked generators, cheapest-first, capped per tick. Spends
   * are simulated against a local wallet so the bot doesn't emit buys it can't
   * afford; the server re-validates each buy regardless.
   */
  private buyGenerators(state: Readonly<PlayerState>, actions: BotAction[]): void {
    const unlocked = this.generators.filter((g) => isGeneratorUnlocked(state, g, this.modeDef))
    if (unlocked.length === 0) return

    // Cost-reduction factors depend on owned upgrades, not generator counts, so
    // the resolved defs are stable across this tick's buys.
    const resolved = new Map(
      unlocked.map((g) => [g.id, resolveGeneratorDef(g, state, this.modeDef)]),
    )
    const wallet: Record<string, number> = { ...state.resources }
    const owned: Record<string, number> = { ...state.generators }

    for (let buys = 0; buys < MAX_GENERATOR_BUYS_PER_TICK; buys += 1) {
      let pick: { gen: GeneratorDefinition; cost: number } | null = null
      for (const gen of unlocked) {
        const cost = getGeneratorCost(resolved.get(gen.id)!, owned[gen.id] ?? 0)
        if ((wallet[generatorCostCurrency(gen)] ?? 0) < cost) continue
        if (!pick || cost < pick.cost) pick = { gen, cost }
      }
      if (!pick) break
      actions.push({ type: 'buy_generator', generatorId: pick.gen.id })
      wallet[generatorCostCurrency(pick.gen)] -= pick.cost
      owned[pick.gen.id] = (owned[pick.gen.id] ?? 0) + 1
    }
  }

  /**
   * Whether cycling the lantern beats simply holding the highlight forever.
   *
   * Not obvious, and worth checking rather than assuming: releasing gives up the
   * *whole* highlight bonus, not just the lantern's share. Holding forever settles
   * at an empty lantern and pays the plain highlight multiplier continuously;
   * cycling pays the boosted multiplier for `max/drain` seconds and nothing at all
   * for `max/charge` seconds. At the default numbers (×1.5 lantern, equal rates)
   * those are a dead heat, and with a strong highlight multiplier cycling is
   * *worse* — a bot that always cycled would regress.
   *
   * The lantern's factor is sampled at half charge, so a charge-band bonus at
   * either end is ignored: bands only ever make cycling better, so the bias is
   * toward holding, which is the safe direction to be wrong in.
   */
  private worthCycling(state: Readonly<PlayerState>, farm: string): boolean {
    const params = collectBatteryParams(state, this.modeDef)
    if (params.chargeRate <= 0 || params.drainRate <= 0) return false

    const probe = (charge: number): Readonly<PlayerState> => ({
      ...state,
      meta: { ...state.meta, highlight: farm, hlCharge: charge },
    })
    const boosted = getHighlightMultiplier(probe(params.maxCharge / 2), this.modeDef)
    const plain = getHighlightMultiplier(probe(0), this.modeDef)

    const holdSec = params.maxCharge / params.drainRate
    const chargeSec = params.maxCharge / params.chargeRate
    // Released earns the bare rate — multiplier 1, not `plain`.
    const cycleAverage = (holdSec * boosted + chargeSec) / (holdSec + chargeSec)
    return cycleAverage > plain
  }

  /**
   * What to highlight this tick: the farmed resource, or `null` while running the
   * lantern's recharge half-cycle. Plain hysteresis — hold until the lantern is
   * dry, refill until it's full — so the bot switches twice per tank rather than
   * flapping every tick.
   */
  private highlightTarget(state: Readonly<PlayerState>, farm: string): string | null {
    if (!isHighlightBatteryActive(state, this.modeDef)) {
      this.recharging = false
      return farm
    }
    const charge = readBatteryCharge(state)
    if (charge === null || !this.worthCycling(state, farm)) {
      this.recharging = false
      return farm
    }
    const params = collectBatteryParams(state, this.modeDef)
    if (this.recharging) {
      if (charge >= params.maxCharge) this.recharging = false
    } else if (charge <= 0) {
      this.recharging = true
    }
    return this.recharging ? null : farm
  }

  decide(state: Readonly<PlayerState>): BotAction[] {
    const actions: BotAction[] = []

    const farm = this.farmCurrency(state)
    const highlight = this.highlightTarget(state, farm)

    // Highlight the resource we're currently farming (boosts its passive income),
    // or release it to refill the lantern.
    if (readHighlight(state) !== highlight) {
      actions.push({ type: 'set_highlight', highlight })
    }

    // Advance the upgrade plan (buy the current target when affordable).
    this.advancePlan(state, actions)

    // Click the farmed resource for active income.
    if (this.clicksEnabled) {
      for (let i = 0; i < CLICKS_PER_TICK; i += 1) {
        actions.push({ type: 'click', resource: farm })
      }
    }

    // Reinvest spare currency into unlocked generators.
    this.buyGenerators(state, actions)

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
 *
 * Idler is currently the only mode (the `mode`/`modeDef` plumbing is kept so
 * re-adding modes stays cheap — see master-plan D1).
 */
export function createBot(
  _mode: GameMode,
  modeDef: ModeDefinition,
  availableUpgrades: readonly UpgradeDefinition[] = modeDef.upgrades,
): BotStrategy {
  return new IdlerBot(modeDef, availableUpgrades)
}
