# 54 — Play panel empty state ("Choose your opening")

## Problem

The Play panel is tab 0, the first thing a player sees, and at match start it is
**completely blank**. Its three sections (lantern bar, highlight cards, click
cards) each render `''` until an upgrade unlocks them
([play-panel.ts](../../client/src/ui/panels/play-panel.ts)). The header resource
bar is already ticking, but nothing tells the player that the Upgrade Tree is
where the game starts. In a timed race, every second spent figuring that out is
lost score.

## Approach

When the Play panel has nothing else to show, render an **empty state**: a short
heading, one line of guidance, and a grid of **opening cards**, one per tree root
(the branch entry points). Each card is a summary. Clicking it opens the
**existing upgrade detail popup** (Buy / Cancel), so no new purchase UI is needed.
A secondary link switches to the Upgrade Tree tab.

```text
┌─────────────────────────────────────────────┐
│            Choose your opening            │
│  Every strategy starts in the Upgrade     │
│  Tree. Pick a branch. You can expand      │
│  into the others anytime.                 │
│                                           │
│  ┌──────────────────┐ ┌──────────────────┐  │
│  │ 🌱 Axe Handling   │ │ 🌳 Work Optimiz…  │  │
│  │ +1 base 🪵/sec    │ │ ×1.1 production  │  │
│  │ per level.       │ │ of all resources │  │
│  │ 10 🪵             │ │ 50 🪵 50 🍺        │  │
│  └──────────────────┘ └──────────────────┘  │
│  … First Generation, Click, Warfare,      │
│    Diplomacy, First Spy (2 per row)       │
│                                           │
│       Open the Upgrade Tree → Ctrl+2      │
└────────────────────────────────────────────┘
```

Tiles are outline-style (transparent fill, border, accent on hover) to match the
game's other secondary controls, in an `auto-fill` grid: two columns in the
~360px game column, one below ~330px.

### Why cards that open the detail popup (not navigate, not one-click buy)

| Option                                     | Verdict                                                                                                                                                                                                                                |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Navigate**: switch tab, pan to node   | The tab bar already does the switch, so this only adds value if it also pans to and highlights the node. That needs a new pan-to-node API on the tree panel, whose pan/zoom handle is module-private. It's the most work for a detour. |
| **B. One-click buy on the card**           | Fastest, but the tree always confirms through the popup. A misclick on 💥 Warfare spends the whole 50 🪵 opening budget. Big cards in a first-seconds rush invite misclicks.                                                           |
| **C. Card → existing detail popup (pick)** | Two clicks, the same as the tree. Uses the same confirm UX, full description, lock reason, and live cost (`openUpgradeDetail` already takes a `host` option). Zero new purchase logic.                                                 |

**Decided: C.** The "Open the Upgrade Tree" link still teaches where the rest of
the game lives.

**Cards:** all 7 non-goal roots, in **tree (authoring) order**:
Axe Handling, Work Optimization, First Generation, Click, Warfare, Diplomacy,
First Spy. Authoring order is the tree's left-to-right layout, so the grid mirrors
what the player sees when they open the tree.

### Visibility rule

Show the empty state **iff the panel has no other content**: click, highlight,
and battery are all locked. That is the panel's actual "empty" condition, and it
needs no extra state. It also covers a player who opened with 🌱 Axe Handling or
⚙️ Generators, because their Play panel is still blank and the cards are still
valid next moves. As soon as Click or Highlight unlocks, the empty state is
removed in `update()`, using the same inject/remove-on-gate-flip pattern the panel
already uses.

Card list = tree roots, **excluding**:

- goal upgrades (`goalType`). Royal Throne at 30M is not an opening.
- `comingSoon` upgrades.
- roots whose `purchaseLimit` is reached. After buying 💥 Warfare, its card
  disappears instead of sitting there dead. `update()` compares the eligible id
  list against the last one rendered and rebuilds the grid only when it changes.

Blocked cards are still shown (🌳 needs 50 🍺 and the player starts with 20).
A card is dimmed when `canBuy` is false. That covers both "can't afford" and an
enemy purchase lock, and `update()` toggles it each tick. The popup already
explains the reason. The tree's `.too-expensive` rule is scoped to
`.upgrade-btn.tree-node`, so the cards get their own `.blocked` dim rule rather
than borrowing it.

### Copy

- Heading: **Choose your opening**
- Body: _Every strategy starts in the Upgrade Tree. Pick a branch. You can expand
  into the others anytime._
- Link: **Open the Upgrade Tree →** with a `<kbd>` hint for its Ctrl+N hotkey,
  derived from its slot index (not hard-coded). Touch devices already hide every
  `kbd` (`@media (pointer: coarse)`).

The copy is mode-agnostic: no "wood"/"realm", so it works for any future
`shared/trees/*.json` mode. Card name, icon, and description come from flavor
(`getUpgradeName`/`getUpgradeIcon`/`getUpgradeDescription`). Idler names embed
the icon (`"🌱 Axe Handling"`). The detail popup already stripped that leading
duplicate; the stripping moved into a shared `upgradeTitle` helper that both the
popup and the cards use.

## Data: identifying tree roots

The flat `UpgradeDefinition[]` drops the authoring tree, so the client can't tell
roots from children. "No prerequisites" is **not** a substitute: in idler it also
matches `ae-mf-ar-time` and `sh-unlock`, which are layout children.

**Change:** `toModeDefinition` in [codec.ts](../../shared/src/tree/codec.ts) sets
`rootUpgradeIds: tree.upgrades.map((u) => u.id)` on `ModeDefinition`, a new
optional readonly field.

- _Complexity:_ one derived field. It is not authored, so there is no schema
  change, no file-version bump, and no editor work. It costs one line in the
  codec and one in `types.ts`. The alternatives are a `parent`/`depth` field on
  every `UpgradeDefinition` (more surface, layout leaking into gameplay types) or
  re-parsing the tree on the client (duplicate logic).
- Optional rather than required, because hand-built `ModeDefinition`s in tests
  and `_stub-mode.ts` have no tree. When it's absent (`?? []`), the empty state
  shows just the guidance text and the tree link, with no cards.

## Files touched

| File                                                                                           | Change                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [shared/src/modes/types.ts](../../shared/src/modes/types.ts)                                   | `ModeDefinition.rootUpgradeIds?: readonly string[]`                                                                                                                                                                                                                                                                                                                                                |
| [shared/src/tree/codec.ts](../../shared/src/tree/codec.ts)                                     | populate it in `toModeDefinition`                                                                                                                                                                                                                                                                                                                                                                  |
| [client/src/ui/panels/play-panel.ts](../../client/src/ui/panels/play-panel.ts)                 | `renderOpening(state)`. `bind()` wires the cards to `openUpgradeDetail(id, { host: <.play-opening> })` and the link to `switchToPanel(UPGRADE_TREE_PANEL_INDEX)`. `update()` calls `updateUpgradeDetail(state)`, toggles card dimming, re-keys the card set, and inject/removes the section on the gate flip. When it removes the section, it first calls `closeUpgradeDetail()`.                  |
| [client/src/ui/panels.ts](../../client/src/ui/panels.ts)                                       | `renderActivePanel` calls `resetUpgradeDetail()` before rendering. Any panel render wipes a popup mounted in the old content, so the reset belongs at that one choke point. This also fixes an existing stale state: today, Tree (popup open) → Ctrl+0 leaves `openId` set, and the first Escape is swallowed by a popup that no longer exists. The tree panel's own call is dropped as redundant. |
| [client/src/ui/mode-ui.ts](../../client/src/ui/mode-ui.ts)                                     | use `UPGRADE_TREE_PANEL_INDEX = 1` (exported from `panels.ts`, since `mode-ui` imports the Play panel and would form a cycle) where the tree slot is pushed. The tree is always slot 1 when a mode has upgrades, and cards only render when it does. That makes a lookup-by-id helper unnecessary.                                                                                                 |
| [client/src/style.css](../../client/src/style.css)                                             | `.play-opening` (`position: relative`, so it hosts the popup's `absolute; inset: 0` backdrop). `.panel-container` is an unpositioned scroller and can't be the host. Also the heading, the body, an `auto-fill minmax(10rem, 1fr)` grid of compact outline tiles (transparent fill, `--border` outline, `--accent` on hover, one-line names), and a dim state. Existing tokens only.               |
| [client/src/ui/helpers.ts](../../client/src/ui/helpers.ts)                                     | `upgradeTitle(name, icon)`: the popup's leading-icon stripping, now shared with the cards.                                                                                                                                                                                                                                                                                                         |
| [client/src/ui/upgrade-detail.ts](../../client/src/ui/upgrade-detail.ts)                       | use `upgradeTitle`.                                                                                                                                                                                                                                                                                                                                                                                |
| [client/src/ui/panels/upgrade-tree-panel.ts](../../client/src/ui/panels/upgrade-tree-panel.ts) | drop its `resetUpgradeDetail()` call (now in `renderActivePanel`).                                                                                                                                                                                                                                                                                                                                 |
| [client/src/ui/helpers.ts](../../client/src/ui/helpers.ts)                                     | `upgradeTitle(name, icon)`: the popup's leading-icon stripping, now shared with the cards.                                                                                                                                                                                                                                                                                                         |
| [client/src/ui/upgrade-detail.ts](../../client/src/ui/upgrade-detail.ts)                       | use `upgradeTitle`.                                                                                                                                                                                                                                                                                                                                                                                |
| [client/src/ui/panels/upgrade-tree-panel.ts](../../client/src/ui/panels/upgrade-tree-panel.ts) | drop its `resetUpgradeDetail()` call (now in `renderActivePanel`).                                                                                                                                                                                                                                                                                                                                 |
| [shared/trees/idler.json](../../shared/trees/idler.json)                                       | Shorten ⚙️ First Generation's description to fit a tile: _Unlock the 🪵 and 🍺 generators._                                                                                                                                                                                                                                                                                                        |

`openUpgradeDetail` already takes a `host`, so the popup needs no new API.

## Tests

- **Shared logic unit:** `toModeDefinition` yields `rootUpgradeIds` in authoring
  order for the idler tree, and children are not included.
- **Client DOM unit** (`play-panel.dom.test.ts`, new, since the panel has no test
  today):
  - fresh state → empty state with one card per eligible root, in tree order.
    Goal excluded, maxed root excluded. (`comingSoon` is filtered too but
    untested: no idler root uses it.)
  - unaffordable root carries `.blocked`. `update()` clears it once affordable,
    keeping the same card element.
  - unlocking Click via `update()` removes the empty state and injects the click
    cards, and the reverse.
  - card click opens the detail popup inside `.play-opening` for that id. The link
    calls the tab switch.
  - with the popup open, `update()` with newly affordable state enables its Buy
    button. This test guards the liveness wiring, which is the easiest piece to
    forget.
  - buying a maxed-limit root through the popup removes its card on the next
    `update()`.
  - `renderActivePanel` with a popup open → `isUpgradeDetailOpen()` is false
    afterwards (`panels.ts` reset).
  - Not written: mode without `rootUpgradeIds`. The fallback is a single `?? []`.
- **e2e:** none. Nothing here crosses the client/server boundary that existing
  purchase e2e doesn't already cover. Check that no e2e asserts the Play panel is
  blank at start.

## Not doing (scope guard)

- No pan-to-node / node highlight in the tree (option A). Revisit only if
  playtests show people open the tree and can't find the branch.
- No persistent "tutorial seen" flag, coach marks, or arrows. The empty state
  fixes itself when the panel gets content.
- No win-condition banner. Tempting ("Win by owning 👑 or the highest Total"), but
  the goal is per-room (lobby goal picker) and belongs in its own change.

## Follow-ups

- **Per-tree colours.** Tint each opening tile (border/icon accent) with its
  branch's colour, e.g. red for Warfare. No tree has a colour yet; add it when
  per-tree colours land, reading the same field the tree panel uses.
- **Categories branch (`feat/upgrade-category-subtrees`).** It replaces
  `tree.upgrades` with `categories[].upgrades`, so the `rootUpgradeIds` line in
  `toModeDefinition` must flatten the categories' top-level upgrades on whichever
  branch merges second. Category flavor (name + icon) is also the natural home
  for the colour above.

## Decisions

1. Card action: open the existing detail popup (C).
2. Cards: all 7 non-goal roots.
3. Order: tree (authoring) order.

## Risks to check during implementation

- **Mobile:** 7 cards at 10rem make 2 columns × 4 rows on a 412px-wide phone.
  The popup centres over `.play-opening`, the block the player just tapped, so
  it's on screen even if the panel scrolled. Eyeball portrait and landscape once.
  MOB-02 only checks Settings and isn't affected.
- **Space while the popup is open:** Click is locked whenever the empty state is
  visible, so the Space hotkey can't double-fire with the focused Buy button.
