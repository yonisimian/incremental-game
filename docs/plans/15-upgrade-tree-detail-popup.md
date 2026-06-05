# PLAN: Upgrade Tree Detail Popup (Icon-Only Nodes)

## Goal

Refactor the upgrade-**tree** UI so each upgrade is a **small, fixed-size, icon-only
button**. Clicking a node no longer buys it directly — instead it opens a **detail
view** (a popup overlaying the tree panel) showing the upgrade's name, cost,
description, and (future-proofed) any additional info, with explicit **Buy** and
**Cancel** actions.

This makes the tree compact and readable at a glance, removes the accidental-purchase
footgun of click-to-buy, and gives us a place to surface richer per-upgrade
information later (modifiers, prerequisites, synergies).

> Scope: the **tree panel** only. The flat clicker upgrade list (`renderClickerUpgrades`)
> keeps its current click-to-buy behaviour for now, but the popup is built as a
> reusable component so the flat list can adopt it in a follow-up.

---

## Current Behaviour (baseline)

- `renderUpgradeTree` (in `client/src/ui/components.ts`) emits one
  `.upgrade-btn.tree-node` per upgrade, each ~180px wide, containing
  `name`, `cost`, `level`, and `description` spans.
- Nodes live in a pan/zoom canvas (`upgrade-tree-panel.ts`).
- `bindUpgradeEvents('tree-canvas')` delegates clicks: a click on a non-disabled
  node calls `doBuy(uid)` **immediately**.
- Upgrade display data lives in `UpgradeFlavor` = `{ id, name, description }`.
  Names embed a leading emoji (e.g. `'🪓 Sharpened Axes'`). There is **no
  dedicated icon field**. (Note: `GeneratorFlavor` already has separate `name`
  - `icon` fields — good precedent for doing the same on `UpgradeFlavor`.)
- Node state is conveyed by CSS classes: `.locked`, `.owned`, `.too-expensive`,
  or none (buyable). Nodes are currently `disabled` when not buyable.
- The tree canvas already disambiguates **drag-vs-click**: `pan-zoom.ts` tracks
  `dragMaxDist` against `DRAG_CLICK_THRESHOLD` (5px) and calls `suppressNextClick()`
  (window capture-phase) so a pan ending on a node doesn't fire its click. This
  works for **any** click consumer, so swapping buy→open-popup inherits it for free.

---

## Target Behaviour

1. Tree nodes become fixed-size square icon buttons (e.g. ~56–64px).
   - Show only the upgrade icon.
   - Retain state-color classes (`.locked` / `.owned` / `.too-expensive` / buyable).
   - `aria-label` = upgrade name; `title` = `"<name> — <cost>"` for quick hover info.
   - Owned/maxed nodes may show a small ✓ corner badge; locked nodes stay dimmed.
2. Clicking any node opens the **detail popup** (even locked/maxed nodes — the popup
   explains _why_ it can't be bought). Clicking never buys directly.
3. The detail popup shows:
   - Icon + name (header)
   - Cost, with affordability styling (and `Maxed`/`✓` when capped)
   - Level indicator (`owned / limit`) when relevant
   - Description
   - Lock reason when locked (`Requires …`) or choice-blocked message
   - **Buy** button (disabled unless currently buyable) and **Cancel** button
   - A layout that leaves room for future info sections (modifiers, prereqs).
4. Popup closes on: **Cancel**, **Escape**, backdrop click, or a successful **Buy**.
   - **Decision: close on Buy.** A successful purchase closes the popup (rather than
     staying open for the next level). Re-open the node to buy another level. This
     keeps the interaction simple; revisit if multi-buy UX is added later.
5. While open, the popup reflects **live** state each tick (affordability / Buy-enabled
   update as passive income changes the balance).

---

## Design Decisions

### 1. Add an explicit `icon` to `UpgradeFlavor`

Add `readonly icon: string` to `UpgradeFlavor` (`shared/src/modes/types.ts`) and a
`getUpgradeIcon(flavor, id)` cached helper in `shared/src/flavor.ts`, mirroring
`getUpgradeName`.

- Populate `icon` for every upgrade in `clicker.ts` / `idler.ts` flavors.
- **Migration:** today names embed a leading emoji (`'🪓 Sharpened Axes'`). When
  adding `icon`, lift that emoji into `icon` and decide whether to also strip it
  from `name` (the popup renders icon + name together, so keeping it in both would
  duplicate the glyph). Simplest: move the emoji to `icon`, leave the bare text in
  `name`.
- **Enforcement:** making `icon` a **required** field gives compile-time enforcement
  across all flavor entries — stronger than the existing runtime checks. The current
  `validateModeDefinition` (in `shared/src/modes/index.ts`) only verifies
  id-level presence/orphan matching, **not** per-field content (it never checks that
  `name`/`description` are non-empty). So no new runtime validation is needed for
  `icon` beyond the required type; adding per-field content checks would be net-new
  scope and is intentionally avoided here.

### 2. Reusable detail-popup component

New module `client/src/ui/upgrade-detail.ts` exporting something like:

```ts
export function openUpgradeDetail(upgradeId: string): void
export function closeUpgradeDetail(): void
export function isUpgradeDetailOpen(): boolean
export function updateUpgradeDetail(state: Readonly<GameState>): void // live refresh
```

- Renders a `role="dialog"` `.upgrade-detail` overlay + `.upgrade-detail-backdrop`
  mounted inside the tree **panel container** (so the live pan/zoom `transform` on
  `.tree-canvas` doesn't move/scale the popup). It must **not** be a `.tree-node`
  child of `.tree-canvas`, because the panel's `update()` removes all `.tree-node`
  elements every tick.
- **Lifecycle caveat:** the tree panel's `render()` does
  `container.innerHTML = renderShell(...)`, which wipes any mounted popup. So the
  popup is created on demand by `openUpgradeDetail` (not baked into `renderShell`),
  and the module-level "open" state **must reset** on panel re-render / match
  boundary, otherwise `updateUpgradeDetail` would try to refresh a popup whose DOM
  was wiped. Closing on panel switch is acceptable UX.
- Buy button → `doBuy(id)`; on the next state update, if the upgrade became
  owned/maxed (or the design choice is "close on buy"), close the popup.
- Cancel/Escape/backdrop → `closeUpgradeDetail()`.
- Focus management: focus the Buy button (or Cancel if disabled) on open; restore
  focus to the originating node on close; trap Tab within the dialog.
- All interpolated strings escaped via `escapeAttr`/`escapeHtml` (names/descriptions
  are authored data but we keep the existing escaping discipline).

### 3. Click vs. pan disambiguation

The tree canvas supports drag-to-pan. Opening the popup on `click` after a pan-drag
would be wrong.

- **Already handled:** `pan-zoom.ts` suppresses the trailing click after a drag
  exceeding `DRAG_CLICK_THRESHOLD` (window capture-phase `suppressNextClick`). Since
  the popup opens from the same delegated `click`, it inherits this for free — a real
  drag won't open the popup. No new threshold logic needed.
- Implementation: swap the tree's node-activation from `doBuy(uid)` to
  `openUpgradeDetail(uid)`. **Do not change `bindUpgradeEvents`' default behavior** —
  `play-panel.ts` calls `bindUpgradeEvents()` (default `'upgrades'`) and must keep
  buying directly. Either add a separate tree binder or give `bindUpgradeEvents` an
  optional `onActivate` callback (default = `doBuy`) and pass `openUpgradeDetail`
  for the tree.

### 4. Keep node state classes; move buy gating into the popup

- `renderUpgradeTree` keeps computing `unlocked / affordable / maxed / choiceBlocked`
  and emitting the same state classes (used for node coloring).
- Nodes are **never** `disabled` now (so locked nodes remain clickable to view
  details); the Buy button inside the popup carries the `disabled` gate instead.
  - **Tests to update:** `client/tests/components.test.ts` asserts `disabled` on
    tree nodes — the `.locked` test (lines ~125–135, `data-upgrade="uN"...disabled`)
    and the "marks unlocked-but-broke nodes with `.too-expensive` (and disables)"
    test (~line 155). Both must be updated to the no-`disabled` model (assert the
    state class only, not the `disabled` attr).

---

## Files to Touch

| File                                         | Change                                                                                                                                                                                                     |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shared/src/modes/types.ts`                  | Add `icon: string` to `UpgradeFlavor`.                                                                                                                                                                     |
| `shared/src/flavor.ts`                       | Add cached `getUpgradeIcon(flavor, id)`.                                                                                                                                                                   |
| `shared/src/modes/clicker.ts`, `idler.ts`    | Add `icon` to each upgrade flavor entry (lift leading emoji from `name`).                                                                                                                                  |
| `shared/src/modes/index.ts`                  | `validateModeDefinition` lives here; **no change required** — `icon` is enforced at compile time by the required type.                                                                                     |
| `client/src/ui/components.ts`                | `renderUpgradeTree`: emit icon-only node markup (`aria-label`, `title`, state classes, ✓ badge); stop emitting name/cost/desc spans on tree nodes; **stop setting `disabled`** on nodes.                   |
| `client/src/ui/upgrade-detail.ts`            | **New** reusable detail-popup component.                                                                                                                                                                   |
| `client/src/ui/panels/upgrade-tree-panel.ts` | Bind node activation → `openUpgradeDetail`; call `updateUpgradeDetail(state)` in `update()`; reset popup state on `render()` / match boundary; tear down popup in `cleanup`.                               |
| `client/src/ui/helpers.ts`                   | Give `bindUpgradeEvents` an optional `onActivate` callback (default `doBuy`) so the tree opens the popup; **play-panel default behavior unchanged**.                                                       |
| `client/src/ui/hotkeys.ts`                   | Add `Escape`→close-popup **before** the existing `Escape`→`quitMatch` branch (otherwise Escape would quit the match instead of closing the popup). Confirm tree hotkeys (buy-cheapest/buy-all) unaffected. |
| `client/src/style.css`                       | Fixed-size `.tree-node` icon styling; `.upgrade-detail*` popup/backdrop styles.                                                                                                                            |
| `scripts/lint-css.ts`                        | No code change expected, but **every new class must exist in both CSS and source** to pass the consistency lint.                                                                                           |
| `docs/DESIGN.md`                             | Note the tree interaction model (view → buy) if the UI flow section warrants it.                                                                                                                           |

---

## Testing

- **Node rendering:** tree node is icon-only, has `aria-label` = name, carries the
  correct state class, and is **not** `disabled`.
- **Open on click:** clicking a node calls `openUpgradeDetail` (not `doBuy`).
- **Buy flow:** popup Buy → `doBuy(id)`; disabled when not buyable
  (locked / unaffordable / maxed / choice-blocked).
- **Lock reason:** locked node's popup shows the `Requires …` text; choice-blocked
  shows the group message.
- **Close paths:** Cancel, Escape, backdrop click, and successful Buy all close it.
- **Live refresh:** `updateUpgradeDetail` flips Buy from disabled→enabled when the
  balance crosses the cost.
- **Pan vs click:** a drag past `DRAG_CLICK_THRESHOLD` does **not** open the popup
  (covered by existing pan-zoom suppression; add/keep a guard test if practical).
- Update the existing tree-node `disabled` assertions in
  `client/tests/components.test.ts` (the `.locked` and `.too-expensive` tests) to
  the no-`disabled` model.

---

## Out of Scope (Possible Follow-ups)

- Applying the same popup to the flat clicker upgrade list.
- Richer detail sections: modifier breakdown, prerequisite graph snippet, synergy
  hints.
- Buy-multiple / buy-max controls inside the popup for dynamic-cost upgrades.
- Animations/transitions for popup open/close.

---

## Rollout / Validation

Run the full pipeline before pushing: `pnpm typecheck && pnpm format:check &&
pnpm lint && pnpm lint:css && pnpm test`. The CSS-consistency lint is the most
likely tripwire — add new classes to both the stylesheet and the rendering source.
