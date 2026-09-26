# 34 — Highlight debuff scales the _bonus_, not the whole factor

## Status: Implemented

The `highlightFactor` target of `enemyProductionModifier` now scales the
highlight **bonus** rather than the whole factor. This doc records the goal, the
formula, and the design decisions that were open before the work and are now
settled.

---

## Goal

An incoming highlight debuff scales the **bonus the highlight grants**, not the
factor as a whole — so one authored `value` means the same thing ("your
highlight investment is worth N% less") at every point on the victim's curve,
instead of erasing a small factor while barely denting a large one.

| Victim's factor | Authored `value` | Old (whole-factor) | Now (bonus-scale) |
| --------------- | ---------------- | ------------------ | ----------------- |
| ×2              | 0.5              | ×1                 | ×1.5              |
| ×4              | 0.5              | ×2                 | ×2.5              |
| ×4              | 0.9              | ×3.6               | ×3.7              |

Under the old behaviour the debuff got _stronger the less the victim had
invested_ — against a ×2 highlight, `value: 0.5` erased the entire bonus, while
against a ×8 the same number left ×4 standing.

---

## The formula

Let `F` be the victim's composite highlight factor (battery × all their
`highlightMultiplier` effects, exactly what `getHighlightMultiplier` returns) and
fold the incoming highlight debuffs into a multiplicative product `vₘ` (each in
`(0,1)`) and an additive sum `vₐ` (each `< 0`):

```text
F' = max(1, 1 + (F − 1)·vₘ + vₐ)
```

`F` is already a multiplicative term on the highlighted resource, so the modifier
handed to the pipeline is the **ratio** `m = F' / F`, folded into a single
multiplicative modifier on the held resource. Folding to one modifier — rather
than one per debuff — is deliberate: each ratio is measured against the full `F`,
so emitting several and letting the pipeline multiply them would re-divide by `F`
each time.

A multiplicative debuff can only shrink the bonus (`(F−1)·vₘ > 0`, so `F' > 1`);
an **additive** debuff subtracts from the factor and can cancel the bonus
entirely, but the floor holds it at neutral — never a penalty.

### Guards

- **Released highlight** → emit nothing. There is no bonus to scale.
- **`F ≤ 1`** (uninvested highlight) → return `F` unchanged, so an uninvested
  player takes no debuff and the `F' / F` ratio stays safe.

### The coupling this introduces

`m` is only correct if the `F` used to build it is exactly the composite the
pipeline applies. `getHighlightMultiplier` returns precisely that today, but the
debuff goes silently wrong if the two ever drift — a future highlight multiplier
routed into `collectModifiers` without being mirrored in
`getHighlightMultiplier` would be invisible to the debuff. A test in
`shared/tests/modes.test.ts` pins the two against each other.

---

## Decisions (previously open questions)

1. **Floor at ×1 (neutral).** `HIGHLIGHT_DEBUFF_FLOOR = 1`. An incoming debuff
   can cancel the highlight bonus but never invert it into a penalty, so a
   debuffed highlight is never _worse_ than releasing. (An earlier iteration set
   the floor below ×1 to keep releasing a live counter-play; that was reverted —
   the owner preferred the debuff never punish holding below neutral.)

2. **The additive restriction is relaxed.** Both `multiplicative` and `additive`
   stages are legal on `highlightFactor`. The two are distinct levers: a
   multiplicative debuff scales the bonus proportionally (structurally `> 1`),
   while an additive one subtracts a flat amount from the factor — able to cancel
   a small highlight to exactly ×1 while barely denting a large one (both clamped
   at neutral). The idler tree authors one of each (`less-highlight-power`,
   `less-highlight-power-add`) so the path is used, not speculative.

3. **`highlightDebuffFactor` stays value-shaped.** It returns the multiplicative
   bonus-scale (`∏ vₘ`) for the espionage panel's release-independent "your
   highlight bonus is cut by N%" warning — the same meaning whether or not a
   resource is held. Additive highlight debuffs are state-dependent (their bite
   depends on the live `F`), so they have no release-independent percentage and
   surface in the data panel's debuffed multiplier instead.

---

## Where it lands in the code

- `debuffedHighlightFactor(F, debuffs)` and `resolveEnemyDebuffs(debuffs, victim, mode)`
  in `shared/src/modes/index.ts` (the resolver now takes `mode` so it can read the
  victim's composite `F`). Every call site — the server's passive tick, click
  credit, and spied-rate projection; the client's header, rate breakdown, click
  prediction, and data panel — passes `mode`.
- The wire still carries debuffs **unresolved**: resolution depends on the
  victim's own live factor, so each side must resolve against the state it holds.
- `validateModeDefinition` allows both stages on `highlightFactor`; the value
guard already constrains multiplicative debuffs to `(0,1)` and additive ones to
`< 0`.
</content>

</invoke>
