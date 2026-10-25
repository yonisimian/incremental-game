# 53 — Category navigation and names

## Status: Implemented

Built as planned, with these differences:

- **Fit margin.** The fit adds `FIT_MARGIN` (64 world px) around the nodes'
  centers instead of a separate node size and padding.
- **Bar.** The columns are `1fr 1.5fr 1fr`. The bar also stretches to the
  panel's full width, because the panel centers its children and the bar
  would otherwise shrink to its text.
- **Ruler.** It wraps instead of scrolling: a horizontal scroll container
  also clipped the buttons vertically.
- **Tests.** The tree-file test of the categories' roots lives in
  `shared/tests/upgrade-tree.test.ts`, next to the existing category test.

Follows [52 — per-category upgrade sub-trees](52-upgrade-category-subtrees.md)
(PR #178). Lands on the same branch, `feat/upgrade-category-subtrees`.

---

## Problem

Playtesting the category view from 52 showed:

- Switching category opens at the minimum zoom (0.2), so small categories are
  tiny specks in the middle of the viewport.
- The bar's arrows and title size to their text, so the bar shifts and changes
  width with every switch.
- The only way to move is one step at a time. There's no way to jump to a far
  category.
- Coming back to a category re-centers it and loses where the player was.
- The category names are the root upgrades' names ("First Generation", "First
  Spy"), not names for the groups.
- Click and Highlight share one category, though they're separate systems.

## Goal

A category view that fits the screen, a bar that doesn't move, a ruler of
icons under the tree to jump to any category, a remembered view for each
category, and real category names, with Highlight in its own category.

---

## Decisions

| Question               | Decision                                                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Zoom on first visit    | Fit the category's bounds into the viewport with padding, clamped to [`MIN_ZOOM`, `FIT_MAX_ZOOM` = 1], so one node isn't huge. |
| Remembering a category | Each category keeps its own pan/zoom for the rest of the match. A first visit fits; a return restores. Reset on a new match.   |
| Whole-tree view (off)  | Unchanged: still opens centered at `INITIAL_ZOOM`.                                                                             |
| Bar layout             | Arrows and title get fixed widths (`3fr 4fr 3fr`-style grid with the arrows filling their column). Long names truncate.        |
| Ruler                  | A row of icon buttons under the tree, one per round category, in arrow order. The current one is highlighted.                  |
| Ruler labels           | Icon only. The name is the button's `title` and `aria-label`.                                                                  |
| Arrows stay            | Yes. The ruler is in addition to the arrows.                                                                                   |
| Category icons         | A new required `icon` on each flavor category entry. Used by the ruler.                                                        |
| Names and icons        | Below. Icons are the root upgrades' icons.                                                                                     |
| Highlight split        | `sh-unlock` and its subtree move out of Click into a new Highlight category placed right after Click.                          |
| Bank (`sb-unlock`)     | Stays in Click.                                                                                                                |
| Category ids           | Renumbered in order, `c0`…`c8`. No players, so no compatibility concern.                                                       |
| File version           | Stays 6. The `icon` field is a schema change, but the only file is converted in the same commit.                               |

The 9 categories, in arrow order:

| Id   | Name              | Icon | Root upgrades            |
| ---- | ----------------- | ---- | ------------------------ |
| `c0` | Goal              | 👑   | `goal`                   |
| `c1` | Base Production   | 🌱   | `be-af-mr`               |
| `c2` | Global Production | 🌳   | `ae-mf-ar`               |
| `c3` | Generators        | ⚙️   | `g1-g2`                  |
| `c4` | Click             | 🖱️   | `sc-unlock`, `sb-unlock` |
| `c5` | Highlight         | 🔎   | `sh-unlock`              |
| `c6` | Attack            | 💥   | `a-unlock`               |
| `c7` | Diplomacy         | 🌍   | `ir-unlock`              |
| `c8` | Espionage         | 🕵   | `e-se-mr`                |

---

## Approach

### 1. Names

Rename the 8 entries in the medieval flavor's `categories` table. Data only.

### 2. Highlight split

In `idler.json`, take `sh-unlock` out of `sc-unlock`'s children and make it a
root of a new category after Click. Its `offset` becomes absolute (the sum of
its old ancestors' offsets), so every position stays where it was. Then
renumber Attack, Diplomacy and Espionage to `c6`…`c8` in the tree and the
flavor. `sh-unlock` has no prerequisites, and nothing outside its subtree
requires a node in it, so no prerequisite crosses the new boundary.

### 3. Category icons

`CategoryFlavorSchema` and `CategoryFlavor` gain `icon: string`. The flavor
lookup in `shared/src/flavor.ts` gains `getCategoryIcon(flavor, id)`, cached
like `getCategoryName`. The editor:

- `addCategory` gives a new category a placeholder icon (`📁`).
- The category bar gets an icon field next to the name, written to every
  flavor like the name.

### 4. Fit zoom on first visit

`computeCenteredInitialState` takes a zoom. With categories on, it uses the
fit zoom: the smaller of viewport width and height over the category's bounds
(plus a node's size and padding), clamped to [`MIN_ZOOM`, `FIT_MAX_ZOOM`].
With categories off, it keeps `INITIAL_ZOOM`.

### 5. Remembered view per category

Replace `lastPanZoomState` + `recenter` with a map from category id (or a
fixed key for the whole tree) to `PanZoomState`, cleared on a new match.
Before a switch, the current view is saved under the current category. On
render, the new category's saved view is restored, or fitted when it has none.

### 6. Fixed-size bar

CSS only. The bar's grid gets fixed columns, the arrows fill their column
(`width: 100%`), and the title truncates with an ellipsis. With one category,
the empty arrow columns keep their width, so the title doesn't move.

### 7. Ruler

`renderCategoryRuler` draws a `<nav class="tree-category-ruler">` after the
viewport, with one button per round category: `data-category="cN"`,
`title` / `aria-label` set to the name, `aria-current="true"` on the current
one. A click sets `currentCategory` and re-renders, saving the view first as
an arrow does. The arrow handler and the ruler handler share one
`showCategory(id)`. Not drawn when the round has one category.

---

## Edge cases

- **Viewport not laid out yet** (zero size, e.g. jsdom or a hidden tab): the
  fit falls back to `INITIAL_ZOOM`.
- **A category with one node:** the fit is capped at `FIT_MAX_ZOOM`, so the
  node shows at its normal size.
- **Saved view of a category absent from this round:** can't happen, since the
  map resets each match and a round's categories don't change mid-match.
- **Narrow screens:** the ruler wraps or scrolls horizontally inside its own
  row. With 9 icons at about 2.25rem each, it fits a 360px screen in one row.

---

## Tests

- `tree-categories.test.ts`: the fit-zoom helper (bounds wider than tall,
  taller than wide, one node, zero-size viewport).
- `upgrade-tree-panel.dom.test.ts`: the ruler renders one button per round
  category with the current one marked; a ruler click switches category;
  leaving and returning restores the saved pan/zoom; a first visit fits.
- `editor-tree-categories.dom.test.ts`: the icon field writes every flavor;
  a new category gets the placeholder icon.
- Shared: the flavor validation and codec tests gain `icon`; a test that
  `idler.json`'s categories hold the expected roots.

---

## Implementation order

One commit each:

1. `docs(plans): 53 — category navigation and names`
2. `feat(shared): name the upgrade categories`
3. `feat(shared): Highlight in its own category`
4. `feat(shared): category icons` (schema, flavor lookup, editor field)
5. `feat(client): fit a category to the screen`
6. `feat(client): remember each category's view`
7. `feat(client): fixed-size category bar`
8. `feat(client): category ruler`
9. `docs(plans): 53 as built`

If knip refuses `getCategoryIcon` before the ruler uses it (as in 51 and 52),
commit 4 drops the lookup and commit 8 adds it.
