# PLAN: Edit Upgrade Flavor in the Dev Editor

> **Status:** implemented.
> **Scope:** a narrow, first-step authoring feature — edit an upgrade's display
> flavor (name, icon, description) from the editor inspector, for the current
> single-flavor setup. Multi-flavor authoring is out of scope.

---

## Motivation

The editor can already author an upgrade's mechanics (cost, prerequisites,
modifiers, effects, position, choice metadata) but not its **display flavor** —
the name, icon, and description the UI shows. So a node can be mechanically valid
yet have placeholder text, and the authoring surface is incomplete.

There is also a latent correctness gap: `validateModeDefinition` (via
[validateFlavor](../../shared/src/modes/index.ts)) **requires a flavor entry for
every upgrade**, but the editor creates nodes without one. Such a tree serializes
fine yet fails to load. Owning flavor in the editor lets us close that gap.

---

## Keystone decision: one source of truth

Flavor already lives in the mode flavor table, `flavors[].upgrades[]`
([schema](../../shared/src/tree/schema.ts)), and the runtime resolves names,
icons, and descriptions **only** from there
([shared/src/flavor.ts](../../shared/src/flavor.ts)).

Therefore the editor edits that table **directly**. We do **not** add a parallel
per-node copy of the flavor fields: a second store would be redundant (the
runtime never reads it), would need reconciliation on every parse/serialize, and
would only model `flavors[0]` — silently breaking the multi-flavor model the
schema is built for.

| #   | Decision                                                                                                                    |
| --- | --------------------------------------------------------------------------------------------------------------------------- |
| F1  | Flavor stays solely in `flavors[].upgrades[]`. The inspector reads/writes the entry for the selected node.                  |
| F2  | One-flavor pass: the inspector targets `flavors[0]`. A flavor selector is future work (the same seam `getModeFlavor` uses). |
| F3  | Adding a node seeds a default flavor entry so the tree stays loadable; removing a node drops its entry.                     |
| F4  | No tree-file schema change, no codec migration, no hydrate/sync step — the table is already serialized and validated.       |

---

## Scope

**In scope**

- A Flavor section in the inspector with name / icon / description controls.
- Editing writes through to `flavors[0].upgrades[]` on the working tree and marks it dirty.
- Node add seeds a flavor entry; node delete removes it (keeps the tree exportable + loadable).

**Out of scope**

- Multi-flavor editing or a per-flavor selector in the editor.
- Any change to the runtime flavor-resolution path or the tree-file schema.
- Flavor migration tooling.

---

## Implementation

### Phase 1 — Seed/drop flavor entries with the node lifecycle

In [client/src/dev/editor/model.ts](../../client/src/dev/editor/model.ts):

- `addNode` ensures `flavors[0].upgrades[]` has an entry for the new id
  (idempotent, so re-parenting an existing node does not duplicate it).
- `removeNode` already prunes prerequisite refs; also drop the flavor entries for
  the removed subtree.

### Phase 2 — Inspector Flavor section

In [client/src/dev/editor/inspector.ts](../../client/src/dev/editor/inspector.ts),
add a `Flavor` section (Name input, Icon input, Description textarea) for the
selected node. It reads the current entry from `flavors[0].upgrades[]` and writes
edits straight back, reusing the inspector's existing `onChange` (mark dirty +
re-render). The inspector context gains the working `tree` so the section can
reach the flavor table.

### Phase 3 — Validate and test

- Schema/codec: unchanged — confirm the existing round-trip tests still pass.
- Model: `addNode` seeds an entry; `removeNode` drops entries for the subtree.
- Inspector: the flavor helper resolves the table entry (with a sensible default
  when missing).

---

## Files changed

- [client/src/dev/editor/model.ts](../../client/src/dev/editor/model.ts) — seed/drop flavor entries.
- [client/src/dev/editor/inspector.ts](../../client/src/dev/editor/inspector.ts) — Flavor section + table-entry helper.
- [client/src/dev/editor/index.ts](../../client/src/dev/editor/index.ts) — pass `tree` into the inspector context.
- Tests: editor model + inspector coverage.

---

## Success criteria

A user can select an upgrade in the editor, edit its name / icon / description,
and have those values persist in `flavors[].upgrades[]` across an export →
import round-trip and render correctly in-game — with newly added nodes always
carrying a flavor entry so the tree stays loadable.
