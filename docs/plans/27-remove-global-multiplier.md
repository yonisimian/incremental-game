# 27 — Retarget `balancedGenerators` to resource rates, and remove `globalMultiplier`

## Status: Draft

---

## Goal

1. `balancedGenerators` stops emitting a `globalMultiplier` modifier and instead
   multiplies the **resource rates** (`r0`, `r1` in idler) directly.
2. With its only emitter gone, remove the `globalMultiplier` field from the
   modifier pipeline entirely.

---

## Audit: who actually uses `globalMultiplier`?

**Answer: nothing but `balancedGenerators`.** It is emitted in exactly one place
in the whole repo, and no authored mode data targets it.

Reproduce with:

```bash
grep -rn "globalMultiplier" --include=*.ts --include=*.json --include=*.md . \
  | grep -v node_modules | grep -v /dist/
```

| Category                | Where                                                                                                                                                                                                 | Verdict                                                                                                            |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Emitters (code)**     | [balanced-generators.ts](../../shared/src/effects/seed/balanced-generators.ts) — `{ stage: 'multiplicative', field: 'globalMultiplier', value }`                                                      | **The only one.** Removed by Part A.                                                                               |
| **Emitters (data)**     | none                                                                                                                                                                                                  | `shared/trees/idler.json` has **zero** `"globalMultiplier"` occurrences.                                           |
| **Reachable-by-author** | `nativeModifiers[].field`, `baseModifier.field`, `relativeModifier.field`, `enemyProductionModifier.field` — all plain strings validated against the catalogs                                         | A _capability_ nobody uses. Idler's only debuff (attack `a2`) targets `r0`; its native modifiers target `b0`/`b1`. |
| **Pipeline consumers**  | [pipeline.ts](../../shared/src/modifiers/pipeline.ts): `ctx.globalMultiplier` init, the standalone-track branch in `computeIncome`, `finalizeRate`'s trailing factor, `computeClickIncome`'s multiply | Part B.                                                                                                            |
| **Type surface**        | `ModifierContext.globalMultiplier` in [modifiers/types.ts](../../shared/src/modifiers/types.ts) (+ formula doc comments)                                                                              | Part B. Read only by the pipeline and its tests.                                                                   |
| **Catalogs**            | `addressableTargetsFor` and `enemyDebuffTargetsFor` in [addressable.ts](../../shared/src/effects/addressable.ts)                                                                                      | Part B. The editor dropdowns and the boot validator both derive from these.                                        |
| **Validation**          | `checkProductionField` + the enemy-debuff check in [modes/index.ts](../../shared/src/modes/index.ts) (two error strings name it)                                                                      | Part B — message text only; the logic is catalog-driven.                                                           |
| **Dev editor**          | comments in [effects-editor.ts](../../client/src/dev/editor/effects-editor.ts) and [model.ts](../../client/src/dev/editor/model.ts)                                                                   | Field dropdowns are built from the catalogs, so they update themselves. Comments need a pass.                      |
| **Tests**               | `pipeline.test.ts` (5 cases), `effects.test.ts` (balancedGenerators × 2, catalog × 1), `flavor.test.ts` (1 acceptance case)                                                                           | Part A/B — see Testing.                                                                                            |
| **Docs**                | `docs/plans/13`, `19`, `22`, `24`, `26` mention it                                                                                                                                                    | **Historical plans — do not rewrite.** `DESIGN.md` and `BALANCE.md` never mention it.                              |

There is also **no persistence risk**: the `/dev.html` editor has no
`localStorage` state, so nothing can be holding a saved tree that selected the
field. The only exposure is a locally-held `.json` tree an author never committed
— which, after Part B, fails `validateModeDefinition` loudly at boot rather than
silently landing on a dead field.

---

## Part A — `balancedGenerators` multiplies resource rates

### Decided: iterate `mode.resources`, don't hardcode `'r0'`/`'r1'`

Confirmed by the author — not an open question.

In idler `mode.resources` **is** exactly `['r0', 'r1']`, so this produces the
requested behaviour today, while staying correct for a mode with different or
additional resources. Hardcoding two literals in a generic seed effect would be
the one place in the effects layer that can't survive a new mode. (If per-resource
targeting is ever wanted, add an optional `resources?: string[]` param that
defaults to all of them — a schema-compatible change, and the `/dev.html` form
picks it up automatically.)

### The change

`apply` returns `Modifier[] | null` (like `dominantGenerator` already does) and
the final line becomes:

```ts
// Multiply each resource's rate rather than the pipeline-wide `globalMultiplier`:
// the per-resource `global` layer scales base producers + generator output for
// that resource, which is what this bonus is about. Click income is deliberately
// untouched.
return mode.resources.map((r) => ({ stage: 'multiplicative', field: r, value }))
```

Everything above it — `balanceRatio`, the `total <= 0` / `balanceRatio <= 0`
`null` bail-outs, the `Math.max(0, p.multiplier - 1)` clamp — is unchanged. The
effect's doc comment needs its "global multiplicative production bonus" wording
updated to say it scales every resource rate.

### Why the passive numbers don't move

`finalizeRate` computes
`(base.add·base.mult + global.add) · global.mult · globalMultiplier`, and
`resolveField` routes a raw resource id (`r0`) to that resource's **`global`
layer**. So a multiplicative `r0` modifier lands on `global.mult` — the same
position in the same product as the `globalMultiplier` factor it replaces.
Multiplication commutes, so for every resource in `mode.resources` the rate is
**bit-identical** to today, including how it stacks with `highlightMultiplier`,
generator-fold output, and enemy debuffs.

`computeRateBreakdown` differences whole pipeline runs, so the bonus keeps
cancelling across buckets exactly as before — no display change.

### Decided: this effect must never touch click power

`globalMultiplier` also multiplied `clickIncome` (`computeClickIncome` =
`ctx.clickIncome · ctx.globalMultiplier`), so today `balancedGenerators` silently
boosts clicking. Dropping that is **an explicit requirement of this plan**, not an
incidental side effect: `balancedGenerators` is a generator-production bonus and
must leave click income alone. Emitting a `clickIncome` modifier from this effect —
now or later, for any reason — is out of bounds; see Risks for what to do instead
if `balance-g` needs compensating.

The nerf affects exactly one authored upgrade: **`balance-g`** in
[idler.json](../../shared/trees/idler.json) — cost `500 r0 + 500 r1`,
`purchaseLimit: 1`, `multiplier: 2`, in choice group `g-choice`. Its two rivals
are `higher-g` (`dominantGenerator ×3`, targets a generator field) and `lower-g`
(`lowerTierBoost`) — **neither touches click income**. So the change makes the
choice group internally consistent: all three options are generator-production
plays, and the "balanced" branch stops being the only one that secretly doubled a
click build too. A click-heavy strategy that bought `balance-g` for its click
multiplier loses that; that's the intended nerf, not a regression.

No bundled strategy in [shared/strategies/idler/](../../shared/strategies/idler/)
buys `balance-g` (`grep -rl balance-g shared/strategies/idler` → nothing), so the
committed reference sims and the envelope gate are unaffected. Worth one manual
Queue-Sim run with a `balance-g` + high-CPS strategy to see the delta with your
own eyes before merging.

---

## Part B — remove `globalMultiplier`

Do this only after Part A lands, so nothing emits the field while it's being
deleted.

### [shared/src/modifiers/pipeline.ts](../../shared/src/modifiers/pipeline.ts)

- Drop `globalMultiplier: 1.0` from the `ctx` initializer.
- Delete the `if (m.field === 'globalMultiplier') { … }` branch in `computeIncome`.
  (`clickIncome` stays — it's a genuine standalone track.)
- `finalizeRate(layers)` loses its second parameter and its trailing
  `* globalMultiplier`; update its formula doc comment to
  `(base.add·base.mult + global.add) · global.mult`.
- `computeClickIncome` returns `ctx.clickIncome`.
- `computePassiveRates` calls `finalizeRate(ctx.resources[key])`; drop the
  "globalMultiplier is applied to each rate" line from its doc comment.
- Update the `resolveField` doc comment (it names `globalMultiplier` as
  separately handled).

### [shared/src/modifiers/types.ts](../../shared/src/modifiers/types.ts)

- Remove `globalMultiplier: number` from `ModifierContext`.
- Fix the two doc comments: the `Modifier.field` list ("the two standalone
  tracks" → one) and the `ResourceLayers` formula.

### [shared/src/effects/addressable.ts](../../shared/src/effects/addressable.ts)

- `addressableTargetsFor`: drop the `{ key: 'globalMultiplier', … }` entry.
  `clickIncome` stays first.
- `enemyDebuffTargetsFor`: drop it too — the catalog becomes resource rates only.
  Update its doc comment, which currently explains _why_ `globalMultiplier` is
  included.

**This is a strict improvement to the plan-22 invariant.** That plan's
"why this is complete" argument was: debuffs can only target resource rates +
`globalMultiplier`, which is exactly what `computePassiveRates` consumes, so
merging server-sent debuffs into the client's own rate display closes the gap.
After this change the catalog is _just_ resource rates — the same argument holds
with one less case, and the victim's header stays correct. Nothing in
[playing.ts](../../client/src/ui/playing.ts) or `broadcastState` needs to change.

### [shared/src/modes/index.ts](../../shared/src/modes/index.ts)

Logic is catalog-driven, so only two message strings and their comments change:

- `checkProductionField`: `… (expected a resource rate 'rK', base producer 'bK', generator id, or 'clickIncome')`.
- The enemy-debuff check: `… (only resource rates can be debuffed)`, plus the
  block comment above it that spells out the subset.

Behaviour worth stating plainly: after this, a tree authored with
`"field": "globalMultiplier"` **throws at boot** instead of being accepted. That's
the desired direction (fail loud), and `project.test.ts` — which boots every
registered mode — is the net that proves the committed trees are clean.

### Dev editor

[effects-editor.ts](../../client/src/dev/editor/effects-editor.ts) and
[model.ts](../../client/src/dev/editor/model.ts) build their `field` dropdowns
from the catalogs, so the option disappears on its own; both have comments naming
`globalMultiplier` as one of "the specials" that need a wording pass. `model.ts`'s
resource-rename logic ("rewrite only when the field equals a resource key") keeps
working — it now has one special to skip instead of two.

---

## What capability is being given up

`globalMultiplier` was the pipeline's only single-lever "scale **every** resource
rate _and_ click income" factor. After removal, the same effect must be authored
as N+1 modifiers (one multiplicative per resource, one on `clickIncome`) — more
verbose, and it drifts if a mode gains a resource later.

That is an acceptable trade for deleting an otherwise-unused branch from the
hottest path in the game, but it's a real capability, so: **if a future mechanic
genuinely needs one global lever (a prestige multiplier, a round-wide buff), the
right move is to reintroduce the field, not to fan out N modifiers at every call
site.** Re-adding it is ~10 lines and reverses cleanly — this plan is the record
of how.

---

## Testing

`server`/`client` import compiled shared output — `pnpm --filter @game/shared build`
before their suites.

### Part A — [shared/tests/effects.test.ts](../../shared/tests/effects.test.ts)

- Rewrite the two `balancedGenerators` assertions (currently
  `toEqual({ stage, field: 'globalMultiplier', value })`) to expect an **array of
  one modifier per `mode.resources` entry**, all sharing the same `value`, with
  fields `['r0', 'r1']` for idler. Derive the expected fields from
  `mode.resources` rather than literals, matching how the partially-balanced case
  already derives its expected value from the generator count.
- Keep the three `null` cases as-is (`multiplier <= 1` throws, too-skewed →
  `null`, nothing owned → `null`) — they're the reason the effect is safe when
  counts drop.
- **New (equivalence pin):** for a balanced state, `computePassiveRates` with the
  new modifiers equals `computePassiveRates` with the old single
  `globalMultiplier` modifier of the same value. Write this test **before** Part B
  removes the field, and delete it as the last step of Part B — it's the proof
  that Part A is numerically inert, and it can only be expressed while both forms
  exist.
- **New (permanent invariant, not a one-off delta check):** `computeClickIncome`
  is **unchanged** by a `balancedGenerators` bonus, asserted from a
  perfectly-balanced state where the bonus is at its maximum. This test outlives
  Part B — it's what stops a future change from quietly reattaching click power to
  this effect. Assert that no emitted modifier has `field: 'clickIncome'` too, so
  the guarantee holds at the effect boundary and not just through the pipeline.

### Part A — production still composes

In [pipeline.test.ts](../../shared/tests/pipeline.test.ts) or
[rate-breakdown.test.ts](../../shared/tests/rate-breakdown.test.ts): with
`balance-g` owned and generators balanced, each resource's rate is `× value`
versus the same state without the upgrade, and `computeRateBreakdown` still
satisfies `total === base + generators + upgrades`.

### Part B — removals

- [pipeline.test.ts](../../shared/tests/pipeline.test.ts): delete/adapt the five
  `globalMultiplier` cases — `ctx.globalMultiplier` init, the additive+multiplicative
  track test, "scales base, generators, and global together", "applies
  globalMultiplier to clickIncome", and the `applyPassiveTick` case. Keep each
  test's _other_ assertions; several cover unrelated behaviour and shouldn't be
  lost wholesale.
- **New:** a modifier naming `globalMultiplier` is now **inert** — it neither
  scales rates nor click income (it falls through `resolveField` to `continue`).
  This is the regression test that the branch is really gone.
- [effects.test.ts](../../shared/tests/effects.test.ts) catalog case: drop the
  `{ key: 'globalMultiplier', label: 'Global multiplier' }` line from the expected
  `addressableTargetsFor(['r0'], ['g0','g1'])` array.
- [flavor.test.ts](../../shared/tests/flavor.test.ts): the test named "accepts an
  enemyProductionModifier debuffing the globalMultiplier" **inverts** — rename it
  to "rejects …" and assert `toThrow(/only resource rates can be debuffed/u)`. Add
  (or confirm) a sibling case that a resource-rate debuff is still accepted, so the
  catalog narrowing is pinned from both sides.
- [project.test.ts](../../shared/tests/project.test.ts) / mode boot: unchanged and
  must stay green — it proves the committed trees never used the field.

Full gate: `pnpm typecheck && pnpm format:check && pnpm lint && pnpm lint:css`
plus all three suites. `pnpm lint:exports` (knip) will flag anything left
orphaned by the removal.

---

## Implementation order

1. **Part A**, with the equivalence test written first (it must pass against the
   _old_ implementation to be worth anything — write it, watch it pass, then change
   the effect and watch it still pass).
2. Update the `balancedGenerators` doc comment + the effect's flavor text in
   [idler.json](../../shared/trees/idler.json) if it promises a global bonus (the
   `balance-g` description reads "Gain a boost that grows the more evenly your
   generators are owned" — accurate as written, so likely no edit needed; check the
   flavor for a "everything" claim).
3. Ship Part A on its own — it's a gameplay change and deserves its own commit and
   its own line in any balance notes.
4. **Part B**: pipeline → types → addressable → modes validation → editor comments,
   then the test sweep. One commit; `pnpm typecheck` drives the file list.
5. Delete the temporary equivalence test as the final step of Part B.

---

## Risks / deferred

- **Balance:** the click nerf to `balance-g` is the whole gameplay content of this
  plan, and it is intended. If the upgrade turns out to be underpowered afterwards,
  compensate on the **generator** side — raise `multiplier` or lower the cost in
  [idler.json](../../shared/trees/idler.json). Do **not** reintroduce
  `globalMultiplier`, and do **not** give `balancedGenerators` a `clickIncome`
  output. If a click bonus is genuinely wanted on that specific upgrade, it belongs
  as its own separate effect ref in the upgrade's `effects` array, where it is
  visible in the data and in the editor — never buried inside this effect.
- **Not doing:** per-resource targeting params on `balancedGenerators` (optional
  `resources?: string[]`), and any change to `dominantGenerator` /
  `lowerTierBoost` — they target generator fields and are already
  `globalMultiplier`-free.
- **Historical plans keep the old wording** on purpose. If plan 22's invariant
  section is ever used as a spec again, note that this plan narrowed its catalog.
