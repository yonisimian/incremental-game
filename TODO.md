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

### Goals

- [x] By time
- [x] By first to score
- [x] By first to buy a specific upgrade

### Player Count

- [ ] Single player
- [x] 1 vs 1
- [x] 1 vs bot
- [ ] Group vs group
- [ ] Battle royal (survival, all against all)

### Controls & Input

- [ ] Per-panel hotkeys (generators: 1/2/3 for tiers; upgrade-tree: 1/2/3 for upgrades)
- [ ] Hotkey for "quit"
- [ ] Hotkeys for generators

### Match Flow

- [ ] Quick-match option (random game mode + game goal)
- [ ] CPS encourager mechanism (see Trello)

## Progression Systems

### Generators

- [ ] Visual feedback on generator purchase
- [ ] Bot: teach bot to buy generators
- [ ] Unit tests for generator cost/purchase logic

### Upgrade Tree

- [ ] Support mixed AND/OR prerequisites per edge (currently AND-only)
- [ ] Visibility tiers for locked nodes — hidden / "?" placeholder / grey-revealed / owned
- [ ] Replace hand-placed (x, y) with a layout system
- [ ] Startup-time cycle detection on prereq graph
- [ ] Generic hotkeys (buy cheapest / buy all affordable)
- [ ] Multi-purchase with fixed cost
- [ ] Multi-purchase with dynamic cost
- [ ] Choice upgrades (locks sibling upgrades when bought)
- Specific upgrades — generator:
  - [ ] Time Mul: multiply generators by a factor entangled with time since purchase
  - [ ] Add power to generator(s) (more points per tick)
  - [ ] Increase tick speed (…per generator?)
  - [ ] Lower tier support: each N tier-1 entities add power to tier-2 generators
- Specific upgrades — idler:
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

- [ ] Confirmation panel ("are you sure you wanna quit?")
- [ ] End-game screen: show counts of generators + tree upgrades purchased
- [x] User name (lobby input, localStorage persistence)

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

## Analytics

- [ ] In-game: for each generator, show percentage of its value-per-tick relative to total

## Infrastructure

- [ ] Set up Dependabot for monthly automated dependency PRs
- [ ] Add a README.md
- [ ] Add a MANUAL.md with game instructions
- [ ] Unit tests for buy-upgrade match-end flow (trophy buy → winner; safety-cap → score-based)

## Known Bugs

- [ ] Clicker button gets clipped from above when expanded on each click
- [ ] Screen bottom is cropped on Tal's device
- [ ] Bot never buys the trophy in idler race-to-buy goal
- [ ] Bot clicks too fast in clicker mode — unbeatable even at 20 CPS
- [ ] Game stays on 0:00 for ~5 seconds before showing the end screen
- [ ] `C` hotkey (buy cheapest) works in idler but has no visible hint after play-panel upgrades were removed
