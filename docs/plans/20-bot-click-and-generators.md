# PLAN: Teach the bot to click and buy generators

> **Status:** proposed — awaiting approval.
> **Scope:** extend `IdlerBot` so it (1) clicks each tick when clicks are enabled
> and (2) unlocks and buys generators for passive income, while still pursuing its
> existing upgrade/trophy plan.

---

## Current behavior (the gap)

`IdlerBot.decide()` in [server/src/bot.ts](../../server/src/bot.ts) only ever emits
`set_highlight` and `buy` (upgrade) actions. As a result the bot:

- **never clicks** — even though idler mode has `"clicksEnabled": true`
  ([shared/trees/idler.json](../../shared/trees/idler.json)); it relies purely on
  whatever passive income its upgrades grant.
- **never touches generators** — there is no `buy_generator` action emitted, the
  bot is never handed the generator definitions, and its plan never includes the
  free unlock upgrades `g1-g2` (unlocks `g0`,`g1` + the generators panel) and
  `g3-g4` (unlocks `g2`,`g3`). So generators stay locked forever.

The **server side already supports both** for the bot's opponent path; only the
bot path is missing them:

- `applyClick(player, resource?)` and the `click` action with an optional
  `resource` already exist ([server/src/match.ts](../../server/src/match.ts)).
- `buy_generator` is fully handled for human players via
  `isValidGeneratorPurchase` + `applyGeneratorPurchase`; the bot loop in
  `processBotActions` just doesn't have a branch for it.

---

## Design

Three coordinated changes: a richer action set, a mode-aware bot, and the
match-loop wiring to execute the new actions.

### 1. Action set + match wiring

- Extend the bot's `BotAction` union with:
  - `{ type: 'click'; resource: string }` (carry the resource so the bot can
    click `r1` to fund generators or `r0` for score — today the bot's click path
    in `processBotActions` always credits `r0`).
  - `{ type: 'buy_generator'; generatorId: string }`.
- In `processBotActions` ([match.ts](../../server/src/match.ts)):
  - thread the click `resource` through to `applyClick(botPlayer, action.resource)`
    (validated against `this.modeDef.resources`, same as the human path);
  - add a `buy_generator` branch mirroring `processActions`: guard with
    `isValidGeneratorPurchase`, then `applyGeneratorPurchase`, then
    `recordPurchase(botPlayer, 'generator', id)` so the bot's generator buys show
    up in stats/feed exactly like a human's.

> Validation stays server-authoritative: every bot generator buy is re-checked
> with `isValidGeneratorPurchase` (unlocked + affordable), so a buggy strategy
> can never produce an illegal purchase.

### 2. Make `IdlerBot` mode-aware

`IdlerBot` currently takes only `upgrades`. To buy generators it needs the
generator definitions and the unlock-gate logic, so:

- pass the full `ModeDefinition` into the constructor (via the `createBot`
  factory, which already receives `modeDef`); keep the goal-filtered
  `availableUpgrades` for the plan as today.
- derive and cache from the mode: `generators`, `clicksEnabled`, `scoreResource`,
  and the two "funding" currencies (score resource `r0` and the main generator
  currency `r1`).

### 3. Clicking

When `clicksEnabled`, `decide()` emits a small fixed burst of `click` actions per
tick (tunable constant, e.g. `CLICKS_PER_TICK = 4`). The clicked **resource is
the bot's current highlight** so clicking stays coherent with the plan: while the
bot is accumulating `r1` (highlight = `r1`) clicks build `r1`; once it's chasing
score (highlight = `r0`) clicks build score. This reuses the existing
`set_highlight` logic as the single source of "what am I farming right now".

### 4. Unlocking generators

Rather than hand-coding ids, after building the trophy plan the bot scans
`availableUpgrades` for any upgrade carrying a `generatorUnlock` (or the
`panelUnlock: generators`) effect and **appends those to the plan**, prereq-
ordered via the existing `resolvePath`. They cost `{}` (free), so once their
prerequisites are met the existing "buy when affordable" step picks them up
immediately. No new buying machinery — just more plan entries.

### 5. Buying generators (reinvestment)

After the plan/click logic each tick, `decide()` greedily reinvests into unlocked,
affordable generators:

- consider only generators where `isGeneratorUnlocked(state, gen, mode)` is true;
- buy affordable copies cheapest-first, capped per tick (e.g.
  `MAX_GENERATOR_BUYS_PER_TICK = 3`) to keep `decide()` bounded and avoid a single
  tick draining everything in one frame;
- affordability/cost uses the shared helpers (`resolveGeneratorDef`,
  `canAffordGenerator`) so cost-reduction effects are honored.

### 6. Highlight / funding balance

Generators g0–g2 cost `r1`; the bot's base plan is `r0`-funded. To bootstrap
generators the bot spends an early window highlighting `r1` until it owns a small
seed of generators (e.g. until total generators ≥ a threshold or `r1` passive
income is established), then reverts to its plan-driven highlight (ending on `r0`
for max score, as it already does when the plan is exhausted). This keeps the
existing end-state behavior intact while giving generators a funding source.

---

## Files touched

- [server/src/bot.ts](../../server/src/bot.ts) — action union, constructor
  signature (`ModeDefinition`), click/unlock/generator logic, tunable constants.
- [server/src/match.ts](../../server/src/match.ts) — `processBotActions`: click
  `resource` threading + `buy_generator` branch.
- [server/tests/bot.test.ts](../../server/tests/bot.test.ts) — new unit tests
  (clicks emitted when enabled, generator-unlock upgrades enter the plan,
  generators bought when unlocked+affordable) and an integration assertion that a
  bot match accumulates generators over time.

No `shared/` changes are required — all generator/click helpers already exist.

---

## Open questions / decisions for review

1. **Click intensity** — fixed `CLICKS_PER_TICK` (proposed) vs. scaling with
   difficulty. Any target CPS the bot should feel like?
2. **Generator aggressiveness** — cheapest-first greedy (proposed) vs. an
   ROI/payback heuristic. Greedy is simpler and predictable; ROI is "smarter" but
   more code.
3. **Funding split** — the simple "seed on `r1`, then back to plan" rule
   (proposed) vs. a continuous ratio (e.g. alternate highlight). Simpler rule
   first, tune later via the balance dev panel.
