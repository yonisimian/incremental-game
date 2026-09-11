# 34 — Highlight debuff scales the _bonus_, not the whole factor

## Status: Proposed — not implemented

Nothing below is built. This documents a semantic change to the
`highlightFactor` target of `enemyProductionModifier`, the formula it needs, and
everything that has to move to support it. The current behaviour described under
"Where it stands today" is verified against `tal/main` as of 2026-09-11.

---

## Goal

An incoming highlight debuff should scale the **bonus the highlight grants**, not
the factor as a whole, with a hard floor at ×1 (neutral).

| Victim's factor | Authored `value` | Today | Wanted |
| --------------- | ---------------- | ----- | ------ |
| ×2              | 0.5              | ×1    | ×1.5   |
| ×4              | 0.5              | ×2    | ×2.5   |
| ×4              | 0.9              | ×3.6  | ×3.7   |
| ×2              | → 0              | → ×0  | → ×1   |

The motivation is that the debuff currently gets _stronger the less the victim
has invested_, in the sense that matters: against a ×2 highlight, `value: 0.5`
erases the entire bonus, while against a ×8 highlight the same authored number
leaves ×4 standing. Scaling the bonus makes one authored `value` mean the same
thing — "your highlight investment is worth N% less" — at every point on the
victim's curve, and makes the floor a property of the mechanic rather than
something the author has to avoid stumbling past.

---

## Where it stands today

The authored debuff value is applied to the highlighted resource's rate
verbatim, which is arithmetically the same as scaling the whole factor.

- `enemyProductionModifier` with `field: "highlightFactor"` emits a `Modifier`
  naming that virtual field
  ([seed/enemy-production-modifier.ts:53](../../shared/src/effects/seed/enemy-production-modifier.ts#L53)).
  The value guard forces a multiplicative debuff into `(0, 1)`
  ([modifiers/value-guard.ts:31](../../shared/src/modifiers/value-guard.ts#L31)),
  and `validateModeDefinition` rejects any stage but `multiplicative` for this
  target
  ([modes/index.ts:358-361](../../shared/src/modes/index.ts#L358-L361)).
- [`resolveEnemyDebuffs`](../../shared/src/modes/index.ts#L1177) rewrites the
  virtual field to whichever resource the victim is holding, **passing `value`
  through unchanged** ([modes/index.ts:1189](../../shared/src/modes/index.ts#L1189)),
  and drops the entry entirely while the highlight is released
  ([:1188](../../shared/src/modes/index.ts#L1188)).
- The victim's own factor — `highlightMultiplier` effects
  ([seed/highlight-multiplier.ts](../../shared/src/effects/seed/highlight-multiplier.ts))
  and the battery
  ([modes/index.ts:837-841](../../shared/src/modes/index.ts#L837-L841)) — reaches
  the pipeline as `multiplicative` modifiers on that same resource id, so both it
  and the debuff land in the one `global.mult` accumulator, which multiplies its
  inputs ([pipeline.ts:65-67](../../shared/src/modifiers/pipeline.ts#L65-L67)).

Hence ×2 with `value: 0.5` composes to ×1. The current doc comment
([modes/index.ts:1158-1165](../../shared/src/modes/index.ts#L1158-L1165)) calls
this substitution "exact, not an approximation" and states that the composite
factor is **deliberately never read** — that is the property this plan gives up,
and it is the crux of the work.

---

## The formula

Let `F` be the victim's composite highlight factor (battery × all their
`highlightMultiplier` effects) and `v` the authored debuff value. The bonus above
neutral is `F - 1`, so:

```text
F' = 1 + (F - 1) · v
```

- `F = 2, v = 0.5` → `1 + 1 · 0.5` = **1.5**
- `F = 4, v = 0.5` → `1 + 3 · 0.5` = **2.5**
- `v → 0` → `F' → 1`; since the guard forces `v > 0`, the floor is approached but
  never reached or crossed. `F' ≥ 1` is structural, not clamped.

`F'` is **not** the number to hand the pipeline. `F` is already a multiplicative
term on the highlighted resource, so the modifier pushed in has to be the ratio:

```text
m = F' / F = v + (1 - v) / F
```

| `F` | `v` | `F'` | `m`    |
| --- | --- | ---- | ------ |
| 2   | 0.5 | 1.5  | 0.75   |
| 4   | 0.5 | 2.5  | 0.625  |
| 4   | 0.9 | 3.7  | 0.925  |
| 8   | 0.5 | 4.5  | 0.5625 |

**Multiple debuffs compose on the bonus, not on the ratio.** Fold
`v = v₁ · v₂ · …` first, then compute `m` once:

```text
F' = 1 + (F - 1) · ∏ vᵢ
```

Resolving each debuff to its own ratio and letting the pipeline multiply them is
_wrong_ — every ratio is measured against the full `F`, so the second one would
re-divide by it. Two `value: 0.5` attacks against ×4 give `1 + 3 · 0.25` = ×1.75,
whereas per-debuff ratios would give `4 · 0.625²` ≈ ×1.56.

### Guards

- **Released highlight** → emit nothing, exactly as today
  ([:1188](../../shared/src/modes/index.ts#L1188)).
- **`F ≤ 1`** → emit nothing. No bonus to cut, and it keeps the division safe.
  (`F < 1` is not currently reachable — `highlightMultiplier` requires
  `multiplier > 1` and the battery factor never dips below 1 — but without the
  guard the formula would turn such a factor into a _boost_, `m > 1`.)
- `m · F = F'` only to floating-point precision. Nothing downstream compares for
  equality, so this is benign; it does mean the data panel should compute its
  displayed factor from the same helper rather than re-deriving it a second way.

### The coupling this introduces

`m` is only correct if the `F` used to build it is _exactly_ the composite the
pipeline applies. [`getHighlightMultiplier`](../../shared/src/modes/index.ts#L634)
already returns precisely that (battery × effects, compounded by owned count to
match `collectModifiers` — see its doc comment), so the pieces line up today. But
this makes the debuff silently wrong if the two ever drift — a future highlight
multiplier routed into `collectModifiers` without being mirrored in
`getHighlightMultiplier` would be invisible to the debuff. Worth a test that pins
the two against each other rather than only asserting `m` in isolation.

---

## Changes required

### 1. `resolveEnemyDebuffs` reads the composite

[modes/index.ts:1177](../../shared/src/modes/index.ts#L1177). Needs `mode` in its
signature so it can call `getHighlightMultiplier(victim, mode)`. Restructured to
accumulate the product of all `highlightFactor` entries and emit **at most one**
modifier, per the folding note above — today it maps one-to-one.

The doc comment at
[:1158-1165](../../shared/src/modes/index.ts#L1158-L1165) has to be rewritten;
its central claim (composite deliberately unread, substitution exact) is exactly
what's being inverted. So does the one-line summary at
[effects/addressable.ts:34](../../shared/src/effects/addressable.ts#L34) and
[:122](../../shared/src/effects/addressable.ts#L122).

### 2. Thread `mode` through the call sites

All six already have a mode definition in scope, so this is mechanical:

| Call site                                                          | Mode in scope   |
| ------------------------------------------------------------------ | --------------- |
| [match.ts:528](../../server/src/match.ts#L528)                     | `this.modeDef`  |
| [match.ts:638](../../server/src/match.ts#L638)                     | `this.modeDef`  |
| [match.ts:792](../../server/src/match.ts#L792)                     | `this.modeDef`  |
| [game.ts:892](../../client/src/game.ts#L892)                       | `modeDef`       |
| [playing.ts:57](../../client/src/ui/playing.ts#L57)                | `activeModeDef` |
| [data-panel.ts:477](../../client/src/ui/panels/data-panel.ts#L477) | `modeDef`       |

The wire format does **not** change: `debuffs?: Modifier[]` still carries the
_unresolved_ form ([match.ts:715](../../server/src/match.ts#L715)), and the reason
for that gets stronger, not weaker — resolution now depends on the victim's own
live factor, so each side must resolve against the state it holds.

### 3. `highlightDebuffFactor` forks — the real design decision

[modes/index.ts:1203](../../shared/src/modes/index.ts#L1203) returns the raw
product `∏ vᵢ`, which today _is_ the factor by which the highlight is reduced.
Under the new rule it is only the factor by which the **bonus** is reduced, and
its two consumers want different things:

- [data-panel.ts:539-551](../../client/src/ui/panels/data-panel.ts#L539-L551)
  multiplies it into `getHighlightMultiplier` to display the debuffed multiplier.
  That arithmetic needs `m` (or `F'` directly) — `v` would show ×1.8 where the
  truth is ×1.9.
- [espionage-panel.ts:103](../../client/src/ui/panels/espionage-panel.ts#L103)
  turns it into a "reduced by X%" standing warning, **deliberately shown while
  the highlight is released** (see its doc comment — that's when it matters most).
  But `getHighlightMultiplier` returns `1` when nothing is held
  ([:637](../../shared/src/modes/index.ts#L637)), so there is no live `F` to
  report `F'` against in that state.

**Recommendation:** keep `highlightDebuffFactor` returning `v`, re-document it as
the _bonus_ scale, and reword the espionage line to "your highlight **bonus** is
cut by N%". That statement is release-independent and stays true at every `F`,
which is the whole point of the change. The data panel then computes
`1 + (F - 1) · v` itself for its own row. The alternative — a state-aware helper
returning `F'` — makes the data panel trivial but leaves the espionage panel with
nothing honest to print while released.

### 4. The multiplicative-only restriction survives, its reasoning doesn't

[modes/index.ts:355-361](../../shared/src/modes/index.ts#L355-L361) rejects a
non-multiplicative stage on this target because "`resolveEnemyDebuffs`
deliberately never reads the composite — so an additive debuff on it has nothing
to subtract from". Once the composite _is_ read, an additive debuff becomes
implementable as `F' = max(1, F + v)` (with `v < 0` per the guard). Keeping the
restriction is fine — one way to author a thing is a feature — but the comment
must be re-justified or the check relaxed. Note that additive would need a real
clamp, where multiplicative gets its floor for free.

### 5. Effect schema documentation

[seed/enemy-production-modifier.ts:22-33](../../shared/src/effects/seed/enemy-production-modifier.ts#L22-L33)
documents the target as "10% off their highlight factor". Becomes "10% off their
highlight _bonus_", with the worked example spelled out — this doc block is the
closest thing authors have to a spec, and the `/dev.html` editor form is generated
from the same schema.

---

## Design consequence to decide on first

Today a heavy debuff can push the effective factor below ×1, which makes
**releasing the highlight a genuine counter-play**: `resolveEnemyDebuffs` drops
the entry when nothing is held, so releasing dodges the debuff at the cost of the
bonus. Two things are built around that escape hatch — the drop at
[:1188](../../shared/src/modes/index.ts#L1188) and the always-visible espionage
warning, whose doc comment says the release case is exactly when the player needs
to see it.

With `F' ≥ 1`, holding is never worse than releasing, so releasing becomes
strictly dominated and the escape hatch is dead code in practice. The attack stops
being a mind-game about when to let go and becomes flat attrition.

That's a legitimate design choice, but it is a different game than the one the
surrounding code was written for, and it should be settled before any of the
above is written. If the mind-game is worth keeping, an alternative shape is a
floor below ×1 (`F' = max(floor, 1 + (F - 1) · v)` with `floor < 1`), which keeps
one authored `value` meaningful across the curve _and_ preserves a reason to
release under heavy pressure.

---

## Tests to update

- [shared/tests/modes.test.ts:372-455](../../shared/tests/modes.test.ts#L372-L455)
  encodes the current pass-through arithmetic directly — `resolveEnemyDebuffs`
  returning the authored modifier verbatim with the field swapped, and
  `highlightDebuffFactor` compounding to 0.9 / 0.45. Both the shape (one-to-one
  mapping) and the numbers change.
- [client/tests/highlight-debuff.dom.test.ts:128](../../client/tests/highlight-debuff.dom.test.ts#L128)
  asserts `×1.8` for a ×2 factor under `value: 0.9` — becomes `×1.9`. The
  compounded espionage figure at
  [:88-97](../../client/tests/highlight-debuff.dom.test.ts#L88-L97) ("14.5%")
  stays as-is if the bonus-scale wording in §3 is adopted, since `∏ vᵢ` is
  unchanged.
- [server/tests/match.test.ts:352](../../server/tests/match.test.ts#L352),
  [:378](../../server/tests/match.test.ts#L378) exercise the debuff end-to-end
  through a match; the debuffed rates they assert shift.
- [shared/tests/flavor.test.ts:459](../../shared/tests/flavor.test.ts#L459) carries
  a comment restating the "never reads the composite" rationale.
- **New:** a test pinning `getHighlightMultiplier` against the composite
  `collectModifiers` actually applies, per the coupling note above; and one
  covering two simultaneous highlight debuffs, which is the case the folding rule
  exists for and which no current test exercises.

---

## Open questions

1. **Floor at ×1, or below?** See the design-consequence section — this decides
   whether releasing keeps a purpose.
2. **Does `highlightDebuffFactor` stay value-shaped or become state-aware?** §3
   recommends value-shaped with reworded UI copy.
3. **Relax the additive restriction while we're in here, or leave it?** Nothing
   authored needs it; the idler tree carries no highlight debuff at all today.
