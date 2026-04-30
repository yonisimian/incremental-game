# TODO

## Chores

- [x] Upgrade major dependencies (TypeScript 6, Vite 8, knip 6, @types/node 25)
- [x] Upgrade minor dependencies (vitest, tsx, ws)
- [ ] Set up Dependabot for monthly automated dependency PRs
- [ ] Add a README.md file

## Bugs

- [ ] UI: clicker button gets clipped from above when expanded on each click
- [ ] UI: CLICK button's bounding rectangle shows on some devices
- [ ] UI: screen bottom is cropped on Tal's device

## UI

- [x] Remove hotkeys from mobiles
- [ ] Make hotkeys per-panel (e.g., on generators panel press 1/2/3 to buy tiers; on upgrade-tree panel press 1/2/3 to buy upgrades)

## Features

- [x] Auto-generators (clicker + idle modes)
- [ ] Hotkeys for auto-generators
- [ ] Bot: teach bot to buy generators
- [ ] Visual feedback on generator purchase
- [ ] Unit tests for generator cost/purchase logic
- [x] Upgrade tree (own panel, like generators — start with idler game mode)
- [ ] Upgrade tree: support mixed AND/OR prerequisites per edge (currently AND-only)
- [ ] Upgrade tree: visibility tiers for locked nodes — hidden / "?" placeholder / grey-revealed / owned (currently always fully visible)
- [ ] Upgrade tree: replace hand-placed (x, y) with a layout system
- [ ] Upgrade tree: startup-time cycle detection on prereq graph (currently no validation; bad data silently locks all nodes in a cycle)
- [ ] Upgrade tree: generic hotkeys (e.g. buy cheapest tree upgrade, buy all affordable tree upgrades) — replaces the removed Q/W/E/R per-index hotkeys
- [ ] Ability cards (own panel, also a pre-match decision — see DESIGN.md)
- [ ] Perks (pre-match decision)
- [ ] Prestige
- [ ] Ability card classes (randomizers, rhythmicals, etc.)
- [ ] Achievements
- [ ] Game goal: first to buy a specific upgrade

## Game Modes

- [ ] Monster wave clicker
- [ ] Bullet heaven
- [ ] Monster tower defense
- [ ] Monster timed survival
- [ ] Map control / expansion
- [ ] Map exploration
- [ ] Compound

## Metrics && Analysis

- [ ] Think about metrics and analysis
