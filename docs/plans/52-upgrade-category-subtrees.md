# 52 — Per-category upgrade sub-trees

## Status: Planned

Builds on [51 — tree visibility modes](51-tree-visibility-modes.md) (PR #177):
it adds a second tree setting next to 51's, and scopes 51's rendering to one
category. This branch starts from `feat/visibility-tree-modes`; once #177
merges, rebase it onto `main`.

---

## Problem

Playtesters said the upgrade tree is too big to take in. The idler tree shows
all 81 upgrades across 8 top-level branches on one canvas, so a new player
can't tell what to focus on.

## Goal

Group the tree into categories and, when the player turns categories on, show
one category at a time with arrows to move between them. With categories off,
the tree looks exactly as it does today.

---

## Decisions

| Question               | Decision                                                                                                          |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Where categories live  | Top level of the tree JSON. Each category holds its upgrades, replacing today's flat top-level `upgrades` list.   |
| Which categories       | 8, one per current top-level branch (below).                                                                      |
| Category ids           | Abstract, `c0`…`c7`, like `r0` / `g0`. The name lives in the flavor.                                              |
| Panel title            | The current category's name.                                                                                      |
| Navigation             | Left / right arrows only, no tabs or dots. Above each arrow, the name of the category it leads to.                |
| Wrap-around            | Yes. Right on the last category goes to the first, and left on the first goes to the last.                        |
| Empty categories       | Skipped. A category with no upgrades in this round (e.g. the trophy outside its goal) never shows.                |
| Starting category      | The first non-empty category. The panel remembers the last one viewed for the rest of the match, like pan / zoom. |
| Switching category     | Re-centers on the new category at the starting zoom.                                                              |
| Hotkeys and swipe      | Not now. A comment at the arrow code notes them as future work.                                                   |
| Turning categories off | A player setting, Categories On / Off, default Off. Off shows the whole tree on one canvas, as today.             |
| Changing the setting   | From the lobby only, like the visibility setting.                                                                 |
| Positions              | Stay global. A category view centers on its own upgrades; the whole-tree view draws everything in place.          |
| Cross-category prereqs | Rejected at boot until decided (open question 1). None exist today.                                               |
| File format change     | Version 5 → 6 with no migration step. The game has no players, and `idler.json` is converted once by hand.        |
| Dev editor             | A category bar with an "All" view, category management, moving nodes between categories, category-aware pickers.  |

The 8 categories, from today's top-level branches in
[`idler.json`](../../shared/trees/idler.json):

| Id   | Root upgrade | Name              | Upgrades |
| ---- | ------------ | ----------------- | -------- |
| `c0` | `goal`       | Royal Throne      | 1        |
| `c1` | `be-af-mr`   | Axe Handling      | 6        |
| `c2` | `ae-mf-ar`   | Work Optimization | 4        |
| `c3` | `g1-g2`      | First Generation  | 21       |
| `c4` | `sc-unlock`  | Click             | 16       |
| `c5` | `a-unlock`   | Warfare           | 15       |
| `c6` | `ir-unlock`  | Diplomacy         | 6        |
| `c7` | `e-se-mr`    | First Spy         | 12       |

The names are the root upgrades' names for now. Categories will probably want
their own names (for example "Generators" rather than "First Generation").
Royal Throne exists only in the buy-upgrade goal, so in a timed round it's
skipped as empty.

---

## Approach

### 1. Tree file (schema v6)

In [`schema.ts`](../../shared/src/tree/schema.ts):

- `CURRENT_TREE_VERSION = 6`.
- `TreeFileSchema.upgrades` is replaced by
  `categories: z.array(CategorySchema).min(1)`, where
  `CategorySchema = z.strictObject({ id: z.string(), upgrades: z.array(UpgradeNodeSchema) })`.
- `ModeFlavorSchema` gains `categories: z.array(CategoryFlavorSchema)`, where
  `CategoryFlavorSchema = z.strictObject({ id: z.string(), name: z.string() })`.

[`codec.ts`](../../shared/src/tree/codec.ts): no `migrateV5toV6`. A v5 file
fails with the existing "Unsupported tree file version" error. Earlier
migration steps stay as they are.

[`idler.json`](../../shared/trees/idler.json) is converted by a one-off script
(not committed): each top-level node becomes the only root of its own
category, in today's order, keeping its `offset`, so every absolute position
is unchanged. The flavor gets the 8 names above.

### 2. Runtime types and flatten

In [`types.ts`](../../shared/src/types.ts) and
[`modes/types.ts`](../../shared/src/modes/types.ts):

- `UpgradeDefinition.category?: string`, the id of the category the upgrade
  sits in.
- `ModeDefinition.categories?: readonly CategoryDefinition[]`, with
  `CategoryDefinition = { readonly id: string }`. Order is the arrow order.
- `ModeFlavor.categories?: readonly CategoryFlavor[]`, with
  `CategoryFlavor = { readonly id: string; readonly name: string }`.

All three are optional, so modes built in code (test stubs such as
`client/tests/_stub-mode.ts`) keep working without categories. A mode with no
`categories` always renders as one tree.

[`upgrade-tree.ts`](../../shared/src/modes/upgrade-tree.ts):
`flattenUpgradeTree` takes the categories and stamps each flattened upgrade
with its category id. Output order stays pre-order, category by category.
`toModeDefinition` passes `tree.categories` through and copies their ids to
`ModeDefinition.categories`.

### 3. Boot validation

In `validateModeDefinition`
([`modes/index.ts`](../../shared/src/modes/index.ts)), when the mode has
`categories`:

- Category ids are unique, and there's at least one.
- Every upgrade has a `category`, and it names a declared category.
- No prerequisite crosses categories: every upgrade id in an upgrade's
  prerequisites (`getPrerequisiteUpgradeIds`) has the same category.
- A category may be empty in the file. Emptiness is a per-round fact (goal
  filtering), not an authoring error.

In `validateFlavor` ([`flavor.ts`](../../shared/src/flavor.ts)): the flavor
names every category exactly once, with no orphans, like the existing
upgrade / generator checks. `getCategoryName(flavor, id)` joins the cached
lookups there.

### 4. Client — the setting

New module `client/src/ui/tree-categories.ts`, shaped like 51's
`tree-visibility.ts`:

- `getTreeCategories(): boolean` / `setTreeCategories(on)`, stored under
  `tree-categories`. Missing or unknown reads as `false` (Off).
- `roundCategories(modeDef, upgrades): string[]`, the mode's category ids in
  order, minus those with no upgrade in this round's `upgrades`. Pure.
- `stepCategory(ids, current, step: 1 | -1): string`, the neighbour with
  wrap-around. Pure.

[`settings-modal.ts`](../../client/src/ui/settings-modal.ts): a
**Categories** section below Upgrade Tree, with On / Off chips
(`data-tree-categories`), worded like the visibility chips.

### 5. Client — rendering a category

[`components.ts`](../../client/src/ui/components.ts): `UpgradeTreeOptions`
gains `scope?: ReadonlySet<string>`, the ids of the category being shown.

- Bounds are computed over `scope` (still ignoring `visible`, as in 51).
- Nodes and edges are limited to `scope`, then to `visible` as today.

The panel can't pass a state with a filtered `upgrades` list instead.
`upgradeBlockReason` caches its id → upgrade map by the `state.upgrades`
array (`game.ts`), and a choice group or prerequisite lookup would miss
upgrades outside the category.

### 6. Client — the panel

[`upgrade-tree-panel.ts`](../../client/src/ui/panels/upgrade-tree-panel.ts):

- **Mode:** categories apply when the setting is On, the mode has
  `categories`, and `roundCategories` returns at least one. Otherwise the
  panel renders as today.
- **Current category:** module state `currentCategory`, reset at the match
  boundary to the first of `roundCategories`. If the remembered id is no
  longer in the list, it falls back to the first.
- **Header:** `renderShell` adds a bar above the viewport: a left arrow
  button, the title (`getCategoryName`), and a right arrow button. Each arrow
  shows its target's name above it. With one category, the arrows are hidden.
- **Switching:** an arrow click sets `currentCategory` with `stepCategory`,
  clears the saved pan / zoom so the new category centers, and calls
  `renderActivePanel(getState())`. A `// Future: hotkeys and swipe` comment
  sits at this handler.
- **Rendering:** `renderVisibleTree` passes `scope` = the current category's
  ids. Visibility and reveal tracking still run over the whole round, so a
  node revealed in another category stays in the pulse set until the player
  opens that category. 51's pulse ends on `animationend`, which only fires for
  drawn nodes.

### 7. Styles

[`style.css`](../../client/src/style.css): `.tree-category-bar` (a three-column
flex row over the viewport), `.tree-category-title`, `.tree-category-arrow`
(stacked: target name above the arrow glyph), and the name in `--text-dim`.
The bar must fit at phone width, so long names truncate with an ellipsis.

### 8. Dev editor

[`model.ts`](../../client/src/dev/editor/model.ts):

- Walkers (`walkPositioned`, `findNode`, `detachNode`, `removeNode`) iterate
  every category's roots instead of `tree.upgrades`. `PositionedNode` gains
  `category`.
- `addNode(tree, parentId, node, categoryId)`: a new root goes into
  `categoryId`.
- New: `categoryOf(tree, id)`, `addCategory(tree)` (next free `cN`, plus a
  flavor entry), `renameCategory(tree, id, name)` (writes every flavor),
  `moveCategory(tree, id, step)`, `removeCategory(tree, id)` (empty only), and
  `moveToCategory(tree, nodeId, categoryId)`. That last one detaches the node
  with its subtree, and adds it as a root of the target category at the same
  absolute position.
- `reparentNode` refuses a parent in another category; moving across
  categories goes through `moveToCategory`.

[`views/tree.ts`](../../client/src/dev/editor/views/tree.ts) and
[`canvas.ts`](../../client/src/dev/editor/canvas.ts):

- A category bar above the canvas: the same arrows and name as the game, an
  **All** toggle, and add / rename / move left / move right / delete buttons.
- The canvas draws the selected category, or every category in All.
- "Add root" adds to the selected category. It's disabled in All.

[`inspector.ts`](../../client/src/dev/editor/inspector.ts):

- A **Category** select that calls `moveToCategory`.
- The **Parent** select lists only nodes in the same category.
- The prerequisite picker labels each option with its category and shows a
  warning on a cross-category pick, since the boot validator rejects it.

### 9. Docs

[`CLAUDE.md`](../../CLAUDE.md): the "idler mode is authored as JSON" paragraph
describes the categories level. [`docs/DESIGN.md`](../DESIGN.md) gets the same
note wherever it describes the tree file.

---

## Edge cases

- **Only one non-empty category.** No arrows, just the title.
- **Mode without categories** (a code-built test mode, or a future tree that
  opts out): the setting has no effect.
- **Goal changes the set.** `roundCategories` is computed from this round's
  `state.upgrades`, so the trophy's category appears only in buy-upgrade
  rounds.
- **Remembered category becomes empty.** It can't mid-round, because a round's
  upgrades are fixed at round start. A new match resets to the first category
  anyway.
- **Detail popup open while switching.** `render()` already calls
  `resetUpgradeDetail()`, so the popup closes with the old category.
- **Visibility modes.** 51's rules apply unchanged inside the category. Each
  category's root has no prerequisites, so Hidden mode always shows at least
  one node.
- **Pulse in another category.** The pulse stays pending until that category
  is drawn, then plays once (section 6).

---

## Tests

- **`shared/tests/tree.test.ts`:** schema accepts v6 with categories and
  rejects v5; flatten stamps `category` and keeps positions; validation
  rejects a duplicate category id, an upgrade in an unknown category, a
  cross-category prerequisite, and a flavor missing or adding a category; an
  empty category is accepted; `idler.json` loads.
- **Client pure (`tree-categories.test.ts`):** `roundCategories` drops empty
  categories and keeps order; `stepCategory` wraps both ways; the setting
  defaults to Off and round-trips.
- **`components.test.ts`:** `scope` limits nodes, edges and bounds; without
  `scope`, output is unchanged.
- **`upgrade-tree-panel.dom.test.ts`:** Off renders the whole tree with no bar;
  On renders the first non-empty category with its title and neighbour names;
  the arrows wrap; the trophy category is skipped in a timed round; the
  category is remembered across a tab switch and reset on a new match; a
  pulse in another category plays when that category opens.
- **`settings-modal.dom.test.ts`:** the Categories chips default to Off and
  persist.
- **Editor (`editor-model.test.ts`, `editor-io.test.ts`):** fixtures move to
  v6; add / rename / move / delete category; `moveToCategory` keeps absolute
  positions; `reparentNode` refuses another category; export / import
  round-trips categories.

---

## Implementation order

1. `docs(plans): 52 — per-category upgrade sub-trees`
2. `feat(shared): upgrade categories in the tree file`: §1–§3, the
   converted `idler.json`, the shared tests, and the editor model and test
   fixtures moved to v6 so everything still builds (the editor shows every
   category as one tree until step 5).
3. `feat(client): categories setting`: §4 with its tests.
4. `feat(client): one category at a time in the upgrade tree`: §5–§7 with
   their tests.
5. `feat(dev): categories in the tree editor`: §8 with its tests.
6. `docs: categories in the tree file`: §9.

Each step leaves the game working, and the setting defaults to Off
throughout. As in 51, knip rejects exports nothing uses yet, so step 3 may
have to merge into step 4.

---

## Open questions

1. **Prerequisites across categories.** Until decided, the boot validator
   rejects them and the editor warns. None exist today.
2. **Locked categories.** Should a category stay locked until its first
   upgrade is reachable? Until decided, every non-empty category is reachable
   from round start.
3. **Category names.** The root upgrades' names are placeholders.
