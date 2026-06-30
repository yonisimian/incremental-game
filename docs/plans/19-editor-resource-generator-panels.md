# PLAN: Resource & Generator Panels in the Dev Editor

> **Status:** proposed — awaiting approval.
> **Scope:** turn the single-view tree editor into a multi-section editor that
> can author a mode's **resources** and **generators**, alongside the existing
> upgrade tree. One shared working copy, three sections, room to grow (attacks,
> goals…) without re-architecting.

---

## Motivation

The editor authors upgrades (mechanics + flavor) but the other halves of a
`ModeDefinition` — **resources** and **generators** — can only be edited by
hand-writing [shared/trees/idler.json](../../shared/trees/idler.json). That's the
exact failure mode the editor exists to remove: raw JSON is unvalidated until
load, and the cross-references between resources, generators, and upgrades are
easy to break (a generator that produces a deleted resource, an upgrade cost in a
currency that no longer exists, an effect targeting a renamed generator id).

The user's instinct — make the editor itself a set of panels, mirroring the
game's panel layout — is the right shape. This plan adopts it, with three
refinements that keep it maintainable as more authoring surfaces land:

1. an **editor shell** owns the single working copy + the file-level toolbar;
2. each section is a small **`EditorView`** (mount/refresh/unmount), mirroring the
   game's `Panel` contract;
3. **referential integrity** (rename/delete cascades across resources↔generators↔
   upgrades↔effects↔flavor) is centralized in `model.ts`, not duplicated per panel.

---

## Keystone decision: one working copy, many views

The three sections are **not** independent documents — they are views over the
same `TreeFile`. Resources, generators, and upgrades reference each other:

| Reference                                       | From                        | To                                                   | Notes                                                                                                  |
| ----------------------------------------------- | --------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `scoreResource`                                 | tree                        | a resource key                                       | must always point at a live resource                                                                   |
| `initialResources` keys                         | tree                        | resource keys                                        |                                                                                                        |
| `initialMeta.highlight`                         | tree                        | a resource key                                       | validated against `highlightEnabled` ([modes/index.ts](../../shared/src/modes/index.ts))               |
| `nativeModifiers[].field`                       | tree                        | resource key **or** `clickIncome`/`globalMultiplier` | rewrite only when it equals a resource key ([modifiers/types.ts](../../shared/src/modifiers/types.ts)) |
| `generators[].costCurrency`                     | generator                   | a resource key                                       |                                                                                                        |
| `generators[].production.resource`              | generator                   | a resource key                                       |                                                                                                        |
| upgrade `cost` keys                             | upgrade                     | resource keys (currencies)                           |                                                                                                        |
| `relativeModifier` `source`                     | upgrade **or mode** effects | `resource:<key>` (prefixed!) or `meta:peakCps`       | [addressable.ts](../../shared/src/effects/addressable.ts)                                              |
| `relativeModifier` `field`                      | upgrade **or mode** effects | bare resource key **or** generator id                |                                                                                                        |
| `generatorCost` / `generatorUnlock` `generator` | upgrade **or mode** effects | generator id                                         |                                                                                                        |
| `accessEnemyData` `data`                        | upgrade **or mode** effects | resource key (optionally `:rate`-suffixed)           | via `enemyDataResourceKey`                                                                             |
| `flavors[].resources[].key`                     | every flavor                | resource keys                                        |                                                                                                        |
| `flavors[].generators[].id`                     | every flavor                | generator ids                                        |                                                                                                        |

> **Effects live in two places.** Effect refs appear both on each upgrade
> (`upgrades[].effects`) **and** at the top level (`tree.effects`, mode-wide).
> `validateModeDefinition` checks both, so every cascade below must walk both.

So edits in one section must keep the others valid. The export boundary already
enforces this: [io.ts](../../client/src/dev/editor/io.ts) runs `toModeDefinition`
(`validateModeDefinition`) on every export/import and **throws** on any
inconsistency. We keep that as the backstop, but add _cascading_ model mutations
so the working copy stays loadable continuously — matching how `renameNode` /
`removeNode` already cascade across flavor + prerequisites today
([model.ts](../../client/src/dev/editor/model.ts)).

| #   | Decision                                                                                                                                                                                                                                                                                             |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| K1  | A single `TreeFile` working copy stays owned by the editor shell. Sections never own their own copy.                                                                                                                                                                                                 |
| K2  | The file-level toolbar (Import / Export / Copy JSON / Reset / dirty status) is **promoted to the shell**, persistent above the section switcher. Add/Delete-node move into the tree section's own local toolbar.                                                                                     |
| K3  | Each section implements a common `EditorView` interface; the shell mounts the active one lazily and tears it down on switch (same pattern as `switchTab` in [ui.ts](../../client/src/dev/ui.ts)).                                                                                                    |
| K4  | Resource/generator rename + delete cascade through new `model.ts` helpers so the working copy is **always** loadable; `io.ts`'s `assertLoadable` stays the final guard.                                                                                                                              |
| K5  | The generators section embeds a **live preview** built on a new **pure** `renderGeneratorCardView(def, flavor, nums)` extracted from the game panel — it takes explicit params, does **no** registry/`state` lookup (the working tree is never registered), so both the game and the editor feed it. |
| K6  | No tree-file schema change, no codec migration. Resources/generators/flavor are already serialized and validated.                                                                                                                                                                                    |
| K7  | Resource invariants: a mode keeps **≥1 resource**; `scoreResource` always points at a live resource. Delete is blocked when it would violate either.                                                                                                                                                 |

---

## Naming

The dev page's top-level tabs are already "Simulation / Live / Editor". To avoid
"tabs inside tabs", the editor's inner switcher is styled and named differently —
call them **sections** (Resources · Generators · Upgrade Tree). The switcher
renders as a left rail or a segmented control distinct from `.dev-tabs`.

---

## Architecture

```text
ui.ts (dev page)
└─ Editor tab → initEditor(pane)              ← becomes the SHELL
   ├─ owns: EditorState { tree, dirty, activeSection, currentView }
   ├─ shell toolbar: Import / Export / Copy / Reset / status   (K2)
   ├─ section switcher: Resources · Generators · Upgrade Tree
   └─ active EditorView (mounted lazily)        (K3)
      ├─ ResourcesView   (new: views/resources.ts)
      ├─ GeneratorsView  (new: views/generators.ts)
      └─ TreeView        (existing canvas+inspector, extracted from index.ts)
```

### The `EditorView` contract (new — `views/types.ts`)

```ts
export interface EditorContext {
  /** The shared mutable working copy. */
  readonly tree: TreeFile
  /** Mark the document dirty + refresh the shell status line. */
  markDirty(): void
  /** Re-render *other* sections after a cross-cutting change (e.g. a resource
   *  rename that the generators section displays). */
  requestRefresh(): void
}

export interface EditorView {
  mount(host: HTMLElement, ctx: EditorContext): void
  /** Re-render in place (called when another section changed shared data). */
  refresh?(): void
  unmount(): void
}
```

The existing tree editor (canvas + pan/zoom + inspector + add/delete) is wrapped
as `TreeView` implementing this interface. Its current pan/zoom teardown becomes
`unmount`. **No behavior change** to the tree editor itself — it's a move + thin
adapter so the shell can host it next to the new sections.

> **Canvas-mount caveat.** Today the editor mounts only when its tab becomes
> visible, so pan/zoom sees real viewport dimensions (the `editorTeardown ??=`
> guard in [ui.ts](../../client/src/dev/ui.ts)). The same constraint now applies
> one level down: `TreeView.mount` must run when the **tree section** is switched
> into (and visible), not when the Editor tab opens — otherwise pan/zoom
> initializes against a zero-size host. The shell's lazy mount-on-switch (K3)
> preserves this as long as the tree section's host is the one being shown.

### Shell responsibilities (`index.ts`)

- Build the shell layout (toolbar + section switcher + a `#ed-section-host`).
- Own `cloneTree` working copy + `dirty`.
- Wire Import/Export/Copy/Reset against the shared tree (unchanged logic, just
  lifted out of the tree view).
- On section switch: `currentView.unmount()`, then `nextView.mount(host, ctx)`.

---

## Section 1 — Resources

A small table/form, not a canvas. Each row = one resource.

**Columns / fields per resource** (mechanics + primary-flavor display joined,
exactly like `treeCurrencies` does today in `index.ts`):

- `key` (stable id, e.g. `r0`) — editable via a **rename** that cascades (K4).
- `displayName`, `icon`, `className?` (from `flavors[0].resources[]`).
- `initialResources[key]` (starting amount; absent ⇒ 0).
- flags derived from the key: **is score resource?** (radio across rows, writes
  `scoreResource`).

**Actions**

- **Add resource** → next free `rN` key + a default flavor entry in _every_
  flavor (mirrors `ensureNodeFlavor`); seeds `initialResources` to 0.
- **Remove resource** → blocked with an inline reason if it's the **last**
  resource, the current `scoreResource`, or referenced by a generator
  (`costCurrency`/`production.resource`), an upgrade cost, a native modifier
  field, `initialMeta.highlight`, or an effect (`relativeModifier`
  source/field, `accessEnemyData`). Otherwise cascades the delete: drops flavor
  entries in all flavors, the `initialResources` key, and native modifiers whose
  `field` equals the key (never the `clickIncome`/`globalMultiplier` specials).
- **Rename key** → rewrites **every** reference above, including the
  `resource:`-prefixed `relativeModifier` source, the bare-key `field` target,
  `initialMeta.highlight`, and both upgrade-level and **mode-level** effects.

### New `model.ts` helpers (resources)

```ts
listResources(tree): ResourceRow[]            // key + joined primary flavor + initial
addResource(tree): string                     // returns new key
renameResource(tree, oldKey, newKey): boolean // cascades; false if blank/dupe
removeResource(tree, key): string[] | { blocked: string }  // reasons if referenced
setResourceFlavor(tree, key, {displayName, icon, className?})
setInitialResource(tree, key, amount)
setScoreResource(tree, key)
resourceReferences(tree, key): string[]       // human list of what blocks delete
```

The rename/remove cascades walk: `scoreResource`, `initialResources`,
`initialMeta.highlight`, `nativeModifiers` (resource-key fields only),
`generators[]` (`costCurrency` + `production.resource`), every upgrade `cost`,
both `tree.effects` **and** `upgrades[].effects` (`relativeModifier`
source+field, `accessEnemyData`), and `flavors[].resources[]`. All pure,
mutate-in-place, symmetrical with the existing upgrade helpers.

---

## Section 2 — Generators

A two-column layout: an **authoring list** (left) + a **live preview** (right).

**Authoring fields per generator** (`GeneratorSchema` + `flavors[0].generators[]`):

- `id` (`g0`…) — rename cascades (effects `generatorCost`/`generatorUnlock`
  `generator` param, `relativeModifier` `field` targets equal to the id, in
  both `tree.effects` and `upgrades[].effects`, plus flavor) (K4).
- `name`, `icon` (flavor).
- `baseCost`, `costScaling`, `costCurrency` (dropdown of resource keys).
- `production.resource` (dropdown of resource keys) + `production.rate`.

**Live preview (K5)** — reuse the game's generator render so the preview is
honest and maintenance-free. Note the working tree is **never registered** as a
mode, so the game panel's path (`getModeDefinition(state.mode!)` +
`getModeFlavor` + `state.player`) can't be called directly. Instead:

1. Extract a **pure** `renderGeneratorCardView(def, flavor, nums)` from
   [generators-panel.ts](../../client/src/ui/panels/generators-panel.ts) that
   takes the `GeneratorDefinition`, the resolved `ModeFlavor`, and the
   already-computed display numbers (owned/nextCost/affordable/…) as explicit
   params — **no** `state`, **no** registry lookup. The game panel keeps its
   number-crunching and calls this for markup; behavior is unchanged.
2. The editor builds a throwaway `ModeDefinition` via `toModeDefinition(tree)`,
   reads `flavors[0]`, and feeds each generator a synthetic
   "unlocked, zero-owned" `nums` so the preview shows every card. If
   `toModeDefinition` throws (tree mid-edit/invalid), the preview shows the
   validation message instead — the same text export would surface.

### New `model.ts` helpers (generators)

```ts
listGenerators(tree): GeneratorRow[]
addGenerator(tree): string                    // next gN, default flavor in all flavors
renameGenerator(tree, oldId, newId): boolean  // cascades effects + flavor
removeGenerator(tree, id): string[] | { blocked: string }
setGeneratorField(tree, id, patch)            // baseCost/costScaling/currency/production
setGeneratorFlavor(tree, id, {name, icon})
generatorReferences(tree, id): string[]
```

Cascade targets for generator rename/delete: effect refs of type
`generatorCost` / `generatorUnlock` (the `generator` param) and `relativeModifier`
targets whose `field` equals the generator id — in **both** `tree.effects` and
`upgrades[].effects` — plus `flavors[].generators[]`.

---

## Section 3 — Upgrade Tree

Unchanged functionality. Extracted from `index.ts` into `views/tree.ts` as
`TreeView` implementing `EditorView`. The canvas, inspector, pan/zoom, and
add/delete node behavior are preserved verbatim; only their _host wiring_ moves
behind the interface. The node inspector's currency dropdown already reads
`treeCurrencies(tree)` — once the Resources section can add/rename resources,
those dropdowns reflect it automatically via `requestRefresh`.

---

## Cross-section refresh

When a section mutates shared data that another section displays (rename a
resource → generators' currency dropdown; add a generator → tree's
`generatorUnlock` effect options), the mutating view calls `ctx.requestRefresh()`.
The shell calls `currentView.refresh?.()`. Inactive views simply re-read the tree
on their next `mount`. No global event bus — one callback, like the existing
`onChange` in the inspector.

---

## Files

**New**

- `client/src/dev/editor/views/types.ts` — `EditorView`, `EditorContext`.
- `client/src/dev/editor/views/resources.ts` — Resources section.
- `client/src/dev/editor/views/generators.ts` — Generators section + preview.
- `client/src/dev/editor/views/tree.ts` — `TreeView` wrapper around today's canvas/inspector.

**Changed**

- `client/src/dev/editor/index.ts` — becomes the shell (toolbar + switcher + host).
- `client/src/dev/editor/model.ts` — add resource/generator helpers + cascades.
- `client/src/ui/panels/generators-panel.ts` — extract a pure `renderGeneratorCardView(def, flavor, nums)` (no `state`/registry) for reuse (K5); the game panel keeps its number-crunching and calls it.
- `client/src/dev/dev.css` — section switcher + resource/generator table styles.

**Unchanged**

- Tree-file schema, codec, runtime flavor resolution (K6).
- `io.ts` (still the export/import validation backstop).

---

## Testing

Mirrors the existing editor test suites
([editor-model.test.ts](../../client/tests/editor-model.test.ts),
[editor-io.test.ts](../../client/tests/editor-io.test.ts)).

- **Model (resources):** add → unique key + flavor in all flavors + initial=0;
  rename cascades to every reference kind (generators, upgrade costs, native
  modifiers, `initialMeta.highlight`, `scoreResource`, the `resource:`-prefixed
  `relativeModifier` source + bare `field`, `accessEnemyData`, and both
  `tree.effects` + `upgrades[].effects`); remove blocked for each blocking case
  (last resource, score resource, each reference kind) and succeeds + cascades
  otherwise; `setScoreResource` is exclusive.
- **Model (generators):** add → unique `gN` + flavor; rename cascades to
  `generatorCost`/`generatorUnlock`/`relativeModifier` field/flavor across both
  effect locations; remove cascades.
- **Loadability invariant:** after any model mutation, `toModeDefinition(tree)`
  succeeds (a property-style guard reused across cases).
- **Preview:** `renderGeneratorCardView` produces markup identical to the game
  panel's previous output given the same def/flavor/nums (extraction is
  behavior-preserving).
- **Shell:** switching sections mounts/unmounts views without leaking listeners
  (jsdom: spy on `unmount`); the tree section's pan/zoom initializes only once
  its host is visible (canvas-mount caveat).

`pnpm typecheck && pnpm test` green before marking implementation ready.

---

## Out of scope

- Multi-flavor editing (still targets `flavors[0]`, consistent with plan 17).
- Editing attacks, goals, native modifiers, or `initialMeta` (future sections —
  the `EditorView` seam is what makes them cheap to add later).
- Drag-reordering resources/generators (rows render in array order).
- Any change to the live game UI beyond extracting `renderGeneratorCardView`.

---

## Rollout

1. Extract pure `renderGeneratorCardView` from the game panel (behavior-preserving) + test.
2. Add `EditorView`/`EditorContext` + extract `TreeView` from `index.ts`; shell
   hosts only the tree section → **no user-visible change yet** (safe checkpoint).
   Verify the tree section's pan/zoom still initializes correctly (canvas-mount caveat).
3. Add resource/generator model helpers + cascades + tests (walk both effect locations).
4. Build Resources section, wire into the switcher.
5. Build Generators section + live preview, wire in.
6. `dev.css` polish.

Each step keeps the editor working and the suite green.
