# Plan: Add generator-affecting upgrades to Idler

TL;DR: Extend the shared modifier collection so upgrades can target generator IDs, then add new Idler upgrades that modify generator output instead of only base income.

**Steps**

1. Update `shared/src/modes/index.ts` `collectModifiers` to recognize generator IDs in upgrade modifiers and apply them to generator output before emitting passive resource rates.
   - Keep existing upgrade behavior for resource-targeted modifiers unchanged.
   - Collect generator-specific modifiers separately, then compute each owned generator's effective output.
   - Emit generator output as additive resource-rate modifiers after applying generator-targeted additive/multiplicative effects.
2. Add one or two new Idler upgrades in `shared/src/modes/idler.ts` whose `modifiers` target generator IDs such as `g0`, `g1`, `g2`, or `g3`.
   - Update `idlerFlavor.upgrades` descriptions so they describe the new generator bonuses clearly.
3. Add tests to verify generator-targeted upgrade behavior.
   - Update `shared/tests/modes.test.ts` with a `collectModifiers` case covering a generator-targeted upgrade plus owned generators.
   - If needed, add a simple pipeline test in `shared/tests/pipeline.test.ts` or reuse mode tests.
4. Run shared tests and a focused validation of Idler mode.
   - `pnpm --filter @game/shared test` or equivalent.

**Relevant files**

- `shared/src/modes/index.ts` — modify `collectModifiers` to support generator-targeted upgrade modifiers.
- `shared/src/modes/idler.ts` — add generator-affecting upgrade definitions and flavor descriptions.
- `shared/tests/modes.test.ts` — add regression coverage for new generator-targeted modifier semantics.

**Verification**

1. `pnpm --filter @game/shared test` passes.
2. New test confirms that if a player owns both a generator and a generator-targeted upgrade, the generator's resource output is adjusted.
3. Existing Idler behavior for base income upgrades remains unchanged.

**Decisions**

- Use generator IDs as modifier target fields (`field: 'g0'`) because that matches current `Modifier.field` semantics and avoids broad engine changes.
- Keep compute/pipeline functions intact; handle generator modification in `collectModifiers` only.
- Add the new upgrades in Idler rather than changing Clicker or the whole engine.

**Further Considerations**

1. If you want later, we can also expose per-generator upgrade UI hints by showing generator-targeted effects in generator flavor text.
