# 24 — Base production as a first-class producer (`b*` field namespace)

Status: **Implemented (PR #110).** Supersedes PR #107 (`feat/modifier-scope`),
now closed.

> **How the implementation diverged from this plan.** Two decisions were taken
> during implementation and approved after the fact. This plan below is the
> _original_ design; read these deltas first — the sections further down still
> describe the superseded three-layer / migration approach and are kept only as
> a design-history record.
>
> 1. **Two layers, not three.** The pipeline ships with `base` / `global` per
>    resource, **not** `base` / `generator` / `global`. The generator _aggregate_
>    layer had no emitter — per-generator bonuses fold inside `collectModifiers`
>    before the pipeline, and no effect targets the generator aggregate — so its
>    multiplier was a permanently-`1` dead cell. Folded generator output is
>    additive into `global`; the leak fix is identical with less machinery and
>    **zero** `collectModifiers` change. There is therefore no `gN` pipeline
>    field and no `generator` `LayerAccumulator`; the "Pipeline math" and
>    "Changes" sections below overstate the layer count.
> 2. **No version bump / migration.** The tree shape is unchanged
>    (`{ stage, field, value }`, `field` still a string) and legacy `r0` already
>    resolves to the `global` layer, so old trees load and behave identically
>    with no migration code. The `V3 → V4` codec migration and the `tree.test.ts`
>    migration test described below were **not** built; `CURRENT_TREE_VERSION`
>    stays `3`.
>
> Everything else landed as written: the `bK`/`rK` field namespace, the
> field-shape boot validation (extended to also cover the previously-unchecked
> `nativeModifiers`), the shared addressable catalog surfacing `bK`, the idler
> re-authoring (🌱 base-economy branch → `b*`, 🌳 global upgrade → `r*`), and the
> editor field-picker + rename-cascade updates.

## Problem

A per-resource production bonus and a base-economy bonus share the same target
today. On `main` every modifier that names a resource lands in one flat bucket:

```ts
// shared/src/modifiers/pipeline.ts (main)
ctx.rates[m.field] = (ctx.rates[m.field] ?? 0) * m.value // multiplicative
```

Generators fold their output into that same `rates[resource]` bucket
(`collectModifiers`, "Generator modifiers" loop). So a "Sharpen Axe" upgrade
authored as `{ stage: multiplicative, field: r0, value: 1.1 }` — intended to
buff the **base** wood income — also multiplies **generator** wood output. The
leak is live: idler has ≥4 such `×1.1` modifiers on `r0`/`r1`.

PR #107 fixed this with a `scope: base | generator | global` enum on every
modifier. Rejected because: (a) `(scope × field)` has nonsensical cells
(`scope=base, field=g0`), forcing a boot-time coherence check; (b) it taxes
**every** effect author with a scope decision; (c) `scope=generator, field=r0`
("aggregate of all generators of a resource") is used by **zero** effects —
unused generality. See the review in the session that produced this doc.

## Decision

Encode the production layer in the **field namespace** instead of a separate
enum. One dimension, no invalid combinations, and base production becomes a
first-class, player-visible producer (its own upgrade branch already exists;
attack-immunity to be documented when attacks land).

### Field namespace

| Field              | Layer it targets                                                                         |
| ------------------ | ---------------------------------------------------------------------------------------- |
| `bK`               | **Base** producer of resource `K` (native floor + `b`-mods). One per resource, implicit. |
| `gN`               | A **specific** generator `gN`.                                                           |
| `rK`               | **Global** for resource `K`: all production (base + every generator).                    |
| `globalMultiplier` | Everything (unchanged).                                                                  |
| `clickIncome`      | Click income axis (unchanged; already rejected on production modifiers).                 |

`bK` targets the base layer of `mode.resources[K]` (index-parallel: `b0 → r0`,
`b1 → r1`). This does **not** assume resource string names — `bK` means "base
layer of the K-th resource". Generators keep addressing their resource via
`production.resource` (a string id), so `rK`/generator folding are unchanged.

There is deliberately **no** field for "aggregate of all generators of a
resource" (scope's unused cell). Dropped.

### Pipeline math (per resource `K`)

Structurally identical to what any leak-fix requires — the base and generator
sub-sums must stay separate so a global multiplier can wrap both:

```text
rate_K = ( base_K + gens_K + globalAdd_K ) · globalMult_K · globalMultiplier

base_K  = ( nativeFloor_K + Σ additive bK-mods ) · Π multiplicative bK-mods
gen_g   = ( rate_g·owned  + Σ additive gN-mods ) · Π multiplicative gN-mods
gens_K  = Σ_{g produces K} gen_g
globalAdd_K / globalMult_K  ← additive / multiplicative rK-mods
```

The **only** difference from PR #107: the layer is chosen by parsing the field
prefix, not by reading a separate `scope` property. `Modifier` loses `scope`.

## Changes (file by file)

Types & pipeline — `shared/src/modifiers/`

- `types.ts`: **no** `scope` added. `Modifier` stays `{ stage, field, value }`.
  Replace `ModifierContext.rates: Record<string, number>` with a per-resource
  layered accumulator (`base` / `generator` / `global`, each `{ add, mult }`) —
  the same `ResourceLayers` shape PR #107 introduced, minus the enum.
- `pipeline.ts`: `computeIncome` routes each modifier by a `parseField(field)`
  helper → `{ layer, resourceIndex | generatorId }`. Add `finalizeRate(layers,
globalMultiplier)` implementing the formula above. `computePassiveRates` calls
  it per resource. `computeClickIncome` unchanged.

Collection — `shared/src/modes/index.ts`

- `collectModifiers`: generator-id modifiers still fold into per-generator
  accumulators (unchanged path — `lowerTierBoost` / `dominantGenerator` /
  `balancedGenerators` keep emitting `field: gen.id`). Folded generator output is
  pushed as an **additive `gN`-scoped** contribution (currently pushed as
  `field: resource`); the base floor and `b`-mods route to the base layer.
- `computeRateBreakdown`: the existing `base` / `generators` / `upgrades`
  differencing still telescopes; "base" now means the `b`-producer. Verify the
  differencing isolates the base layer correctly (small change, buckets must
  still sum to `total`).

Validation — `shared/src/modes/index.ts`

- Replace PR #107's `(scope, field)` coherence check with a **field-shape**
  check: a production modifier's `field` must be `bK` (K a valid resource
  index), a declared generator id, a declared resource id, or `globalMultiplier`
  — else throw at boot naming the offending effect. `clickIncome` rejection on
  production modifiers stays. No combination matrix to validate.

Effects — `shared/src/effects/`

- `base-modifier.ts`, `relative-modifier.ts`: **no schema change** (no `scope`
  field). They already take a free-form `field`; `b*` values just work once the
  pipeline understands the prefix. The editor's field input needs the new `b*`
  options surfaced (see below).
- Generator/highlight/enemy effects: unchanged.

Data & migration — `shared/trees/`, `shared/src/tree/`

- Bump tree schema version `3 → 4`. Re-author `shared/trees/idler.json`:
  - `nativeModifiers`: `r0 → b0`, `r1 → b1` (the floor **is** base production;
    behavior-preserving — global `rK` mods still wrap the base layer).
  - **Base-economy upgrade branch** → retarget resource fields to `b*`. This is
    the intentional balance fix (behavior-**changing** for those upgrades: they
    stop buffing generators). Needs the authoring decision below.
- Migration `V3 → V4` in `codec.ts`: keep it **dumb and behavior-preserving** —
  map every legacy resource-targeting field to `rK` (global), preserving the
  leak for unknown old trees. The leak _fix_ lives entirely in the hand-authored
  idler edit, so migration and balance change stay separately reviewable. (Only
  idler exists today, so migration is really just editor back-compat; if we
  decide old trees can hard-fail, we can drop the migration and reject V3.)

Editor — `client/src/dev/editor/`

- The field input for `baseModifier` / `relativeModifier` should offer `b*`
  alongside `r*` / `g*`. Confirm whether the editor derives field options from
  the mode (auto) or needs a code touch.

Client UI — `client/src/ui/`

- Rate-breakdown "base" row is now "the base producer". Mostly labeling; confirm
  the panel reads the (renamed-meaning) base bucket. No new buy button (see
  "Not doing").

## Authoring decision (resolved)

Which idler upgrades are **base** (`b*`) vs **global** (`r*`)? Resolved as
proposed, confirmed against the shipped flavor text:

- Base-economy branch (`+base`, `×base`, "bank" — 🌱) → `b0`/`b1`.
- 🌳 "Work optimization" (`r0 ×1.1` **and** `r1 ×1.1` together) → stays
  `r0`/`r1` (global).
- The `a2` enemy debuff stays on `r0` (debuffs hit the global layer only).

## Not doing (scope guard)

- **No `BaseProducer` entity** with owned-counts / buy button. Base production
  stays "native floor + `b`-targeted upgrades". Revisit only if you want buyable
  base levels.
- **No aggregate-generators-of-resource** field (scope's unused cell).
- **No attack changes now.** Base is already un-targetable (attacks feed only
  `r*` / `globalMultiplier`); immunity gets documented when attacks land.

## Test plan

- `pipeline.test.ts`: base-only mod does **not** scale generator output; global
  `rK` mod scales base **and** generators; `globalMultiplier` scales all.
- `modes.test.ts`: boot validation rejects a bad `field` (unknown `bK`, generator
  under wrong prefix) with a helpful message.
- `rate-breakdown.test.ts`: base / generator buckets sum to total after the
  relabel; a `b`-mod lands in `base`, a `g`-mod in `generators`.
- `tree.test.ts`: V3→V4 migration is behavior-preserving on a legacy tree.
- Update `_stub-mode.ts` and any test asserting the old flat `rates` map.
- Full gate: `pnpm typecheck && pnpm test && pnpm format:check && pnpm lint`.

## Open questions (resolved)

1. Base-producer addressing: **index-parallel `bK ↔ resources[K]`** was chosen
   (terser, matches the `b0/b1` sketch) over an explicit `base:<resourceId>`
   namespace.
2. Migration: **dropped** — the tree shape is unchanged and legacy `r0` already
   resolves to `global`, so no `V3 → V4` migration is needed (`CURRENT_TREE_VERSION`
   stays `3`).
3. Authoring split: confirmed as in "Authoring decision (resolved)" above.
