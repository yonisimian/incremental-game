# PLAN: Group the Editor's "Add Effect" Dropdown

## Problem

In the upgrade-tree inspector, the **+ effect** picker
([inspector.ts](../../client/src/dev/editor/inspector.ts), `buildEffectsSection`)
lists every registered effect type in one flat, alphabetically-sorted `<select>`.
The list has grown to 13 entries spanning unrelated subsystems (production
modifiers, generator tweaks, unlocks, PvP intel), so finding the right effect
is a scan.

`listEffectTypes()` ([shared/src/effects/registry.ts](../../shared/src/effects/registry.ts))
returns `[...registry.keys()].sort()` — a flat sorted array. Today the inspector
maps each entry to a bare `<option>`.

## Goal

Render the picker as `<optgroup>`-separated sections with human-readable group
titles, keeping effects of the same subsystem together. No behaviour change
otherwise: the selected `value` is still the effect `type`, and adding an effect
works exactly as before.

## Keystone decision: grouping is a UI-only concern, lives in the client

The grouping is purely an authoring affordance — it doesn't affect validation,
serialization, or runtime. So the group definition lives in the **client editor**,
not in the shared registry. The registry stays the single source of _which_
effects exist; the editor decides how to _present_ them.

To avoid silent drift (a newly-registered effect not appearing because someone
forgot to add it to a group), the grouping is **partition-by-membership with an
`Other` fallback**: any registered type not named in an explicit group is
collected into a trailing "Other" group, sorted. This guarantees every
`listEffectTypes()` entry is always offered.

## Group definition

A small ordered table in [inspector.ts](../../client/src/dev/editor/inspector.ts)
(near `buildEffectsSection`):

| Group label | Effect types (in intended display order)                                                        |
| ----------- | ----------------------------------------------------------------------------------------------- |
| Production  | `baseModifier`, `relativeModifier`                                                              |
| Highlight   | `highlightMultiplier`                                                                           |
| Generators  | `generatorCost`, `generatorUnlock`, `lowerTierBoost`, `dominantGenerator`, `balancedGenerators` |
| Unlocks     | `panelUnlock`, `systemUnlock`, `unlockAttack`, `unlockPact`, `accessEnemyData`                  |
| Other       | _(any registered type not listed above, sorted)_                                                |

(Grouping mirrors each effect's output `kind`: production modifiers, generator
cost/unlock, the unlock family, and enemy-data intel.)

## Implementation sketch

1. Add a module-level constant in `inspector.ts`:

   ```ts
   const EFFECT_GROUPS: readonly { readonly label: string; readonly types: readonly string[] }[] = [
     { label: 'Production', types: ['baseModifier', 'relativeModifier'] },
     { label: 'Highlight', types: ['highlightMultiplier'] },
     {
       label: 'Generators',
       types: [
         'generatorCost',
         'generatorUnlock',
         'lowerTierBoost',
         'dominantGenerator',
         'balancedGenerators',
       ],
     },
     {
       label: 'Unlocks',
       types: ['panelUnlock', 'systemUnlock', 'unlockAttack', 'unlockPact', 'accessEnemyData'],
     },
   ]
   ```

2. Add a small pure helper `groupEffectTypes(available: readonly string[])`
   that walks `EFFECT_GROUPS`, keeps only types present in `available`, and
   appends a trailing `{ label: 'Other', types: [...leftovers].sort() }` group
   when any registered type wasn't matched. Skips empty groups.

3. In `buildEffectsSection`, replace the flat option loop with one `<optgroup>`
   (label = group label) per non-empty group, each holding its `<option>`s.
   The `add` button's `disabled` check stays `types.length === 0`.

## Tests

Add a focused unit test (new `client/tests/editor-effect-groups.test.ts`, or
extend an existing editor test) for the pure `groupEffectTypes` helper — which
means exporting it:

- Known types land in the right group, in declared order.
- An unknown/extra type falls into a sorted `Other` group.
- Groups with no available members are omitted.
- Every input type appears exactly once across the output groups.

(The DOM wiring itself stays thin; the helper carries the logic worth testing.)

## Out of scope

- No change to `listEffectTypes()` or the shared registry.
- No optgroup styling beyond the browser default (the existing `.ed-input`
  select styling already applies). If the default optgroup label contrast looks
  off against the dark dev theme, a follow-up CSS tweak can address it.
