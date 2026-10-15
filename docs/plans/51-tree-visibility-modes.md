# 51 — Upgrade tree visibility modes

## Status: Planned

Alternative to
[52 — Per-category upgrade sub-trees](52-upgrade-category-subtrees.md).

---

## Problem

Playtesters said the upgrade tree is too big to take in. The idler tree shows
all 81 upgrades across 8 top-level branches from the start of the round, so a
new player can't tell what to focus on.

## Goal

Three tree visibility modes as a player setting, so each player can pick the
one that suits them and we can see which one playtesters prefer:

| Mode       | What the player sees                                                                                                                        |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 — Full   | Every upgrade, as today.                                                                                                                    |
| 2 — Hidden | Only upgrades whose prerequisites are met. A dotted stub from the parent hints that something is hidden behind it.                          |
| 3 — Peek   | Mode 2, plus the children of those upgrades, with their effect and cost, even if their prerequisites aren't met. Grandchildren stay hidden. |

This only changes what the player sees in the client.
[`idler.json`](../../shared/trees/idler.json), `shared/` and the server stay the
same.

---

## Decisions

| Question                        | Decision                                                                                      | Why                                                                                                      |
| ------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Who picks the mode              | The player, in the settings modal.                                                            | Lets each playtester try all three.                                                                      |
| Default                         | Full.                                                                                         | A player who never opens settings sees today's tree.                                                     |
| Switching mid-round             | Not possible. The settings modal opens from the lobby only, and we add no in-round control.   | Keeps a round's tree stable.                                                                             |
| Parent / child                  | The prerequisite edges the tree already draws, not layout nesting in the JSON.                | Layout children ≠ prerequisites. The edges are what the player reads as "leads to".                      |
| Revealed                        | Prerequisites met (`isPrerequisiteSatisfied`). Cost, choice groups and slots don't matter.    | A revealed upgrade the player can't afford is still a goal worth seeing.                                 |
| Dotted stubs                    | Mode 2 only. A peeked child in mode 3 gets none.                                              | In mode 3 the peeked children are already the hint.                                                      |
| Canvas size                     | Bounds come from every upgrade, visible or not.                                               | Hidden upgrades appear in their final spot, and the initial centering doesn't move as the tree grows.    |
| Reveal feedback                 | An upgrade that becomes visible mid-round pulses once. Upgrades visible at round start don't. | Without it, players in modes 2 and 3 may not notice that something unlocked.                             |
| Dev editor (`/dev.html`)        | Unchanged; always the full tree.                                                              | It's for authoring, not playing.                                                                         |
| Where the visibility rule lives | Client, in a new `tree-visibility.ts`.                                                        | Display-only. Nothing in `shared/` or the server needs it, and the client has a pure-function test tier. |

---

## Approach

### 1. The visibility rule

New module `client/src/ui/tree-visibility.ts`, shaped like
[`format-number.ts`](../../client/src/ui/format-number.ts): a type, the stored
setting, and a pure function.

```ts
export type TreeVisibility = 'full' | 'hidden' | 'peek'

/** Ids of the upgrades the tree shows for this player under `mode`. */
export function visibleUpgradeIds(
  upgrades: readonly UpgradeDefinition[],
  player: PlayerState,
  mode: TreeVisibility,
): ReadonlySet<string>
```

- `full`: every upgrade.
- `hidden`: every upgrade whose prerequisites are met. An upgrade with no
  prerequisites is always revealed.
- `peek`: the `hidden` set, plus every upgrade for which at least one id from
  `getPrerequisiteUpgradeIds` is in that set.

The function computes the revealed set once and then does one pass for peek.
It doesn't recurse, so grandchildren can't leak in.

### 2. The stored setting

In the same module, following `format-number.ts`:

- Storage key `tree-visibility`, holding the bare mode string. A missing or
  unknown value reads as `'full'`. The key is new and the game has no players
  yet, so there's nothing to migrate.
- `getTreeVisibility()` returns the cached value, read once at module load.
  `setTreeVisibility(mode)` updates the cache and writes to `localStorage`.
  Both wrap storage access in `try`, as `format-number.ts` does.

### 3. Settings modal

In [`settings-modal.ts`](../../client/src/ui/settings-modal.ts), add a third
section, **Upgrade Tree**, below Decimal Separator:

- Three `settings-chip` buttons with `data-tree-visibility`, labelled Full /
  Hidden / Peek, each with a one-line `chip-example`: "Every upgrade",
  "Only what you can reach", "Reachable + one step ahead".
- A click handler on `#tree-visibility-chips` calls `setTreeVisibility`, and
  `refreshModal` toggles `selected`, like the existing chips.
- The number preview is unrelated, so it stays where it is.

### 4. Rendering — `renderUpgradeTree`

[`components.ts`](../../client/src/ui/components.ts) gets an optional second
parameter, so existing callers and tests are unaffected:

```ts
interface UpgradeTreeOptions {
  readonly visible?: ReadonlySet<string> // absent = every upgrade
  readonly stubs?: boolean // draw dotted stubs toward hidden children (mode 2)
  readonly pulsing?: ReadonlySet<string> // ids that get the reveal pulse
}
```

- **Bounds** are computed from every positioned upgrade, as today. They ignore
  `visible`.
- **Nodes:** an upgrade outside `visible` renders nothing. A node in `pulsing`
  gets the extra class `revealed`.
- **Edges:** a prerequisite → upgrade line is drawn only when both ends are
  visible.
- **Stubs**, when `stubs` is set. For each hidden upgrade, and each of its
  prerequisite parents that is visible, draw a short dashed line:
  `<line class="stub" …>`. It starts `NODE_CLEARANCE` from the parent and runs
  `STUB_LENGTH` (about 50px) toward the child. It always uses the default
  stroke, never `.unlocked`. Skip it when the edge would be shorter than
  `2 × NODE_CLEARANCE`, the same rule today's edges use.

Mode 3 needs no stub logic. Every child of a revealed upgrade is visible in
peek, so the only hidden upgrades are children of peeked or hidden ones, and
those get no stubs by decision.

### 5. Panel — visible set and reveal pulse

[`upgrade-tree-panel.ts`](../../client/src/ui/panels/upgrade-tree-panel.ts)
reads the setting and owns the pulse timing, so `renderUpgradeTree` stays pure:

- On each `render()` and `update()`, compute
  `visibleUpgradeIds(state.upgrades, state.player, getTreeVisibility())` and
  pass `visible`, plus `stubs: mode === 'hidden'`.
- New module state next to `lastMatchId`: `seenIds: Set<string>` and
  `pulseUntil: Map<string, number>`.
- **Match boundary**, which `render()` already detects: seed `seenIds` with
  the current visible set, so round-start nodes don't pulse. Clear
  `pulseUntil`.
- **After that:** any visible id not in `seenIds` goes into `seenIds` and gets
  `pulseUntil.set(id, now + PULSE_MS)`. Pass `pulsing` = the ids whose
  `pulseUntil` is still in the future, and drop expired entries.
- The class has to stay on for the whole animation. `update()` runs on every
  state update, and `syncNodes` copies attributes from fresh markup, so
  removing `revealed` on the next tick would cut the pulse short. `PULSE_MS`
  matches the CSS animation length.
- A node revealed while the Upgrades tab is closed pulses the next time the
  tab renders, because `seenIds` is seeded only at the match boundary.
- In Full mode everything is visible from the start, so nothing ever pulses.

### 6. Styles

In [`style.css`](../../client/src/style.css), next to the tree rules:

- `.tree-edges line.stub { stroke-dasharray: 4 6; }`, with the same stroke as a
  locked edge.
- `.upgrade-btn.tree-node.revealed` runs a new `tree-reveal` keyframe of about
  900ms: a scale-in from 0.6 plus an accent `box-shadow` ring that fades out.
  The node is centered with `transform: translate(-50%, -50%)`, so the
  keyframes must include that translate, or the node jumps while it plays.
- `@media (prefers-reduced-motion: reduce)` drops the scale and keeps only the
  ring.

---

## Edge cases

- **Several parents (AND / OR).** Mode 2: a hidden child gets a stub from each
  visible parent. Mode 3: one revealed parent is enough to peek the child, even
  when an AND still needs the other parent. The popup's "Requires …" line says
  what's missing.
- **OR prerequisite with one hidden parent.** The child is revealed through
  parent A. Parent B is still hidden, so the B → child edge isn't drawn.
- **`meta` prerequisites** (`attacksSuffered`) have no parent node. No stub is
  drawn, and the upgrade isn't peeked. In modes 2 and 3 it appears, and
  pulses, once the counter is reached.
- **`minLevel` prerequisites.** The parent is owned but below the required
  level, so the child stays hidden. In mode 2 the stub tells the player to
  keep levelling.
- **`comingSoon` upgrades** follow the same rule: shown once revealed, styled
  `locked` as today.
- **Choice groups.** A sibling that's been locked out still has its
  prerequisites met, so it stays visible as `locked`. Hiding it would remove
  the explanation for why it can't be bought.
- **Goal trophy node.** It goes through the same filter. With prerequisites it
  can be hidden like any other upgrade, and the existing timed-goal exclusion
  is unchanged.
- **Open detail popup.** The popup only opens from a visible node. Nodes never
  become hidden mid-round, because prerequisites only get met, never unmet. So
  a popup can't point at a node that disappears.

---

## Tests

- **`tree-visibility.test.ts`** (pure, node tier):
  - `full` returns every id.
  - `hidden`: roots shown, an unmet child hidden, a met child shown.
  - `peek`: a child of a revealed upgrade shown, a grandchild hidden.
  - AND with one met parent: hidden in `hidden`, shown in `peek`.
  - OR with one met parent: shown in both.
  - `minLevel` not reached: hidden.
  - `meta` prerequisite not reached: hidden in both. It has no upgrade parent,
    so it isn't peeked either.
  - Storage: an unknown or missing value reads as `full`, and
    `setTreeVisibility` round-trips.
- **`components.test.ts`** (`renderUpgradeTree`):
  - Bounds are unchanged when some nodes are hidden.
  - A hidden node has no `<button>`, and its edges aren't drawn.
  - With `stubs`: one `line.stub` per (visible parent, hidden child). Without
    it: none.
  - A `pulsing` id gets the `revealed` class.
- **`upgrade-tree-panel.dom.test.ts`**:
  - In `hidden` mode, buying a parent makes the child appear with `revealed`.
  - Nodes visible at match start don't get `revealed`.
  - `revealed` survives an `update()` within `PULSE_MS` and is gone after it,
    using fake timers.
  - A new `matchId` re-seeds, so nothing pulses at the start of the next round.
- **New `settings-modal.dom.test.ts`**: the Upgrade Tree chips render with Full
  selected by default, and clicking Peek selects it and persists it.

No e2e test: every behaviour above can fail truthfully at the DOM tier
([testing instructions](../../.github/instructions/testing.instructions.md)).

---

## Implementation order

1. `docs(plans): 51 — tree visibility modes`
2. `feat(client): tree visibility rule and setting`: §1–§2 with
   `tree-visibility.test.ts`.
3. `feat(client): hide and peek modes in the upgrade tree`: §4, the visible-set
   half of §5, the stub style, `components.test.ts` and the panel tests.
4. `feat(client): pulse newly revealed upgrade nodes`: the rest of §5, the
   reveal keyframes, and the pulse panel tests.
5. `feat(client): upgrade tree visibility in settings`: §3 with its DOM test.

Each commit leaves the game working, and the default stays Full throughout.
Before pushing, run
`pnpm typecheck && pnpm format:check && pnpm lint && pnpm lint:css`. The
additions are small, but check that the build stays under the 60 kB
bundle-size warning.

---

## Open questions

1. **Chip example text.** "Only what you can reach" and "Reachable + one step
   ahead" are placeholders.
2. **Pulse look and length.** About 900ms of scale plus ring is a first guess
   to tune in playtests.
