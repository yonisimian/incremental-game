# TODO

## Core Gameplay

### Modes

- [x] Clicker
- [x] Idler
- [ ] Monster Wave clicker (e.g. Tap Tap Infinity)
- [ ] Bullet Heaven (e.g. Vampire Survivors)
- [ ] Tower Defense (e.g. Outhold)
- [ ] Timed Survival (e.g. Minutescape)
- [ ] Map Control / Expansion (e.g. Lumberjacking, Harventure)
- [ ] Map Exploration (e.g. Digseum, Idle Chapel)
- [ ] Compound (e.g. Dwarf Eats Mountain, Rock Island, The Gnope Apolog)
- [ ] Pantheon Worship (e.g. Idle Wizard)

### Goals

- [x] By time
- [x] By first to score
- [x] By first to buy a specific upgrade

### Player Count

- [ ] Single player + Leaderboard
- [x] 1 vs 1
- [x] 1 vs bot
- [ ] Group vs group
- [ ] Battle royal (survival, all against all)

### Controls & Input

- [ ] Per-panel hotkeys (generators: 1/2/3 for tiers; upgrade-tree: 1/2/3 for upgrades)
- [x] Hotkey for "quit" (Escape on playing/countdown)
- [x] Hotkey for "back" (Escape on waiting/room)
- [x] Hotkey for "Leave" button (room / waiting screens) — merged with "back" via Escape
- [x] Hotkeys for panels (Ctrl+1…0 direct, Ctrl+←/→ prev/next)

### Match Flow

- [x] Quick-match option (random game mode + game goal)
- [ ] CPS encourager mechanism (see Trello)
- [x] Unit tests for buy-upgrade match-end flow (trophy buy → winner; safety-cap → score-based)

## Progression Systems

### Generators

- [ ] Visual feedback on generator purchase
- [ ] "Buy Max" button for generators (possibly unlocked via an upgrade)
- [ ] Bot: teach bot to buy generators
- [x] Unit tests for generator cost/purchase logic

### Upgrade Tree

- [ ] Support mixed AND/OR prerequisites per edge (currently AND-only). Possible impl: replace the list (AND semantics) with "or"/"and" operators to express the predicate
- [ ] Upgrades that only unlock after purchasing a certain amount of the parent upgrade
- [ ] Visibility tiers for locked nodes — hidden / "?" placeholder / grey-revealed / owned
- [ ] Replace hand-placed (x, y) with a layout system
- [ ] Startup-time cycle detection on prereq graph
- [ ] Generic hotkeys (buy cheapest / buy all affordable)
- [x] Multi-purchase with fixed cost
- [ ] Multi-purchase with dynamic cost
- [ ] Choice upgrades (locks sibling upgrades when bought)
- Specific upgrades — generator:
  - [ ] Time Mul: multiply generators by a factor entangled with time since purchase
  - [x] Add power to generator(s) (more points per tick)
  - [ ] Increase tick speed (…per generator?)
  - [ ] Lower tier support: each N tier-1 entities add power to tier-2 generators
- Specific upgrades — idler:
  - [ ] Unlock highlighting (start with 0 idle production?)
  - [ ] Highlight battery charge: highlight "nothing" to charge a battery that amplifies highlighting power
  - [ ] Highlight battery diminish: lower drain rate
  - [ ] Highlight battery recharge: faster charging rate
  - [ ] Highlight battery max charge
- Specific upgrades — clicker:
  - [ ] Add power to the click
  - [ ] Multiply click power
  - [ ] Critical click chance (starts at 0%)
  - [ ] Critical click power

### Ability Cards

- [ ] Own panel, also a pre-match decision (see DESIGN.md)
- [ ] Ability card classes (randomizers, rhythmicals, etc.)

### Perks

### Prestige

### Achievements

## Anti-Cheating

- [ ] Punish players with too-high CPS
- [ ] Punish players with even gaps between clicks (auto-clicker detection)

## UX

- [ ] Configurable number viewing mode (at least: name `123k`, scientific `1.23e5`, engineering `123e3`)
- [ ] Configurable digit grouping (e.g. `123,456` / `123.456` / none)
- [ ] Confirmation panel ("are you sure you wanna quit?")
- [ ] End-game screen: show counts of generators + tree upgrades purchased (or show no statistics at all?)
- [x] User name (lobby input, localStorage persistence)
- [x] Remove support of "focused" elements (i.e. pressing "tab" shouldn't highlight random buttons)
- [ ] Verbose player-name feedback in rooms: show who joined, who left, and display names on the waiting screen

## Presentation

### Visualization

- [ ] Particle system(?)
- [ ] Post effects(?)

### Sound

- [ ] Sound track
- [ ] Sound effects

### Other

- [ ] Vibration
- [ ] Themes

## Dev Panel (`/dev.html`)

### Simulation

- [ ] Simulate purchasing generators (not only upgrades)
- [ ] Replace strategy checkboxes with auto-simulate-all: run every strategy, show top 5 by final score
- [ ] Function-based strategies: allow "buy whichever is affordable first" / conditional logic

### Charts & UX

- [x] "Hide all series" button — toggle all uPlot series off in one click so you can isolate a single one
- [x] Show value tooltip on graph hover (crosshair with numeric readout at the hovered point)
- [x] Use `uPlot.setData()` for live chart updates instead of destroy + recreate

### Statistics

- [ ] Purchase timeline table: at each second show which purchase was made and its description
- [ ] Generator breakdown: show all generators' levels, effects, and income share (% of total income per generator)

### Architecture

- [ ] Extract `canPurchase()` to `@game/shared` — simulator currently duplicates prerequisite / one-shot checks
- [ ] Split `ui.ts` into smaller modules (layout, render-sim, render-live, csv)
- [ ] Derive `UPGRADE_ABBR` from mode definition instead of manual lookup table
- [ ] Import/export game settings (mode definitions, constants) via JSON so balance tweaks can be shared/versioned outside code

## Analytics

- [ ] In-game: for each generator, show percentage of its value-per-tick relative to total

## Networking & Resilience

- [ ] Intentional disconnect: call `disconnect()` on quit so the server can distinguish voluntary quit from network drop
- [ ] Heartbeat timeout: terminate connections that don't respond to ping within a timeout
- [ ] Reconnect grace period: give disconnected players ~10 s to rejoin before forfeiting

## Testing

- [ ] Integration tests: keyboard hotkeys (Escape quit/back, Ctrl+N panels, Space click, Tab highlight)
- [ ] E2E tests (Playwright): full match flow — lobby → queue → match → quit/end → lobby
- [ ] E2E tests (Playwright): panel switching via hotkeys in a live match

## Infrastructure

- [x] Set up Dependabot for monthly automated dependency PRs
- [x] Add a README.md
- [ ] Add a MANUAL.md with game instructions
- [x] Bundle size reporting: log bundle sizes on every build; warn or block push if game bundle exceeds a configured limit

## Known Bugs

- [ ] Clicker button gets clipped from above when expanded on each click
- [x] Screen bottom is cropped on Tal's device
- [x] Bot never buys the trophy in idler race-to-buy goal
- [x] Bot clicks too fast in clicker mode — unbeatable even at 20 CPS
- [x] Game stays on 0:00 for ~5 seconds before showing the end screen
- [ ] "Cancel" / "Leave" button is too far above the title on waiting/room screens — move closer
- [ ] `C` hotkey (buy cheapest) works in idler but has no visible hint after play-panel upgrades were removed
- [ ] Holding Space in clicker mode triggers repeated clicks (should require discrete presses)
- [x] "Race To Buy" goal in idler mode is impossible — no global/trophy upgrade exists since 9885e31 (fix in separate PR)
- [ ] "Ctrl + N" Hotkeys (switching panels) don't work on MacOS since Cmd + N is reserved for "New Window"
