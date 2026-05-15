Added the following changes:

- Added `u8` (`Resource Hoarders`) and `u9` (`Cellar Masters`) to `shared/src/modes/idler.ts`.
- Updated `collectIdlerDynamic` to grant multiplicative bonuses for banked `r0`/`r1` when those upgrades are owned.
- Added regression tests in `shared/tests/modes.test.ts` for the new `u8` and `u9` bonuses.
- Updated `client/tests/components.test.ts` expectations to account for the expanded idler upgrade tree.

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
