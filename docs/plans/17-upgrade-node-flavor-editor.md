# PLAN: Upgrade Node Flavor Editing in the Dev Editor

## Goal

Allow the dev editor to configure an upgrade node’s display flavor data (name, icon, description) while the mode still uses a single flavor for now.

This is intentionally a narrow, first-step feature:

- every upgrade node will carry its own flavor data in the authoring model
- the editor will edit flavor text for the current one-flavor setup only
- multi-flavor support is out of scope for this pass
- the goal is to make the authoring workflow usable without changing the runtime flavor model yet
- when copied/exported, that per-node flavor data will still be written into the existing separate flavor JSON structure in the mode file

---

## Why this is needed

Today the editor can change the mechanical shape of an upgrade node (cost, prerequisites, modifiers, effects, position, choice metadata), but it cannot edit the cosmetic display metadata that the UI uses for names, icons, and descriptions.

That means:

- the authoring flow is incomplete for visual polish
- a node can be valid mechanically but still have poor or placeholder display text
- the tree JSON and the editor UI are not yet aligned on the full authoring surface

---

## Scope for this plan

### In scope

- Add mandatory flavor fields to each authored upgrade node
- Expose those fields in the dev editor inspector
- Persist the values in the tree JSON format
- Use the values in the runtime path for the default/only flavor in this pass
- Keep the implementation simple and local to the current one-flavor setup

### Out of scope

- Multi-flavor editing (e.g. per-flavor override maps or a flavor selector in the editor)
- Full flavor migration tooling
- Reworking the flavor schema into a more general override system
- Changing the visual theme system beyond what is needed for this feature

---

## Current baseline

- The tree file schema already supports mode-level flavor data in [shared/src/tree/schema.ts](shared/src/tree/schema.ts).
- The dev editor inspector in [client/src/dev/editor/inspector.ts](client/src/dev/editor/inspector.ts) edits mechanical node fields only.
- The runtime flavor helpers in [shared/src/flavor.ts](shared/src/flavor.ts) resolve names/icons/descriptions from the mode flavor tables.
- The editor currently has no node-level flavor editing path, so the authoring UI cannot update display metadata for a node.

---

## Target behavior

1. When a user selects an upgrade node in the dev editor, the inspector shows a small Flavor section.
2. That section lets the user edit the minimal flavor fields:
   - name
   - icon
   - description
     These fields are mandatory and should always be populated with the current flavor text for the node (for example, the existing name/icon/description values such as "Wood Axe"), not left blank.
3. The edits are saved into the authored tree JSON.
4. For this first pass, the editor uses the existing single flavor model and writes those values into the current flavor entry for that upgrade.
5. The runtime continues to use the same flavor resolution path, with no need for a separate flavor-selection UI in this stage.

---

## Implementation plan

### Phase 1 — Extend the authoring schema

Add mandatory node-level flavor fields to the upgrade-node authoring schema in [shared/src/tree/schema.ts](shared/src/tree/schema.ts).

Decision for this pass:

- the editor will keep each node’s flavor values in the node authoring model
- export/copy will still serialize them into the mode’s separate flavor structure, matching the current tree-file format

Recommended shape for this pass:

- flavorName: string
- flavorIcon: string
- flavorDescription: string

These fields are mandatory in the authoring model and should always show the current flavor text for the node (for example, the existing name/icon/description values), not be empty.

### Phase 2 — Preserve the fields in the tree codec

Update the tree parsing / serialization path in [shared/src/tree/codec.ts](shared/src/tree/codec.ts) so the new node flavor fields survive the JSON round-trip and are available to the editor/runtime.

The main rule for this pass:

- each node carries its own flavor metadata in the editor model
- export/copy should still write that flavor data into the existing separate flavor JSON structure
- the flavor fields are mandatory and must not be blank in the authored data
- if no node-level flavor data exists, the existing mode-level flavor data remains the fallback

### Phase 3 — Add inspector controls

Extend [client/src/dev/editor/inspector.ts](client/src/dev/editor/inspector.ts) to add a Flavor section for the selected upgrade node.

The section should contain only the minimal flavor fields:

- Name input
- Icon input
- Description textarea

The existing edit pattern in the inspector should be reused so changes immediately update the working in-memory tree and mark it dirty.

### Phase 4 — Wire runtime usage for the one-flavor path

Update the flavor application path so the editor-authored node flavor values are used when the current mode is running with the existing single flavor setup.

This should be implemented as a narrow merge step rather than a full multi-flavor override system.

### Phase 5 — Validate and test

Add or update tests to cover:

- the schema accepts node flavor fields
- the editor inspector renders the flavor section
- exported/imported tree JSON preserves the flavor values
- the runtime uses the node flavor data in the single-flavor path

---

## Design choice for the one-flavor pass

To keep this feature manageable, the implementation should treat the node-level flavor fields as a direct override of the current/default flavor entry for that upgrade.

That means:

- no flavor-id map is needed yet
- no UI for choosing among multiple flavors is needed yet
- the system behaves as if there is exactly one flavor active for the mode

This keeps the change small, reduces risk, and gives us a clean foundation for a future multi-flavor version.

---

## Files likely to change

- [shared/src/tree/schema.ts](shared/src/tree/schema.ts)
- [shared/src/tree/codec.ts](shared/src/tree/codec.ts)
- [client/src/dev/editor/inspector.ts](client/src/dev/editor/inspector.ts)
- [client/src/dev/editor/index.ts](client/src/dev/editor/index.ts) (if the inspector context needs extra data)
- existing tests around tree parsing / editor behavior

---

## Validation

Before considering this feature done, we should verify:

1. the tree file still parses successfully
2. the editor can edit and save node flavor fields
3. the flavor values are preserved in exported JSON
4. the current one-flavor runtime path still works

---

## Success criteria

The feature is complete when a user can open the dev editor, select an upgrade node, edit its flavor name/icon/description, and have those values survive the tree file round-trip in the current one-flavor setup.
