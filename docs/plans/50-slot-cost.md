# 50 — Slot cost: how much of the limit each attack and pact takes

## Status: Implemented

As built, following the plan. The editor rounds a typed slot cost to a whole
number. Open questions 1–2 (content, glyph) remain for the balance pass.

Builds on [38 — attack limit](38-attack-limit.md) and
[49 — pact limit](49-pact-limit.md). Today every held attack or pact fills
exactly one slot of its kind's budget. This plan lets each one say how many
it takes — 1, 2, or 14 — so a strong attack can cost a whole loadout.

---

## Goal

An optional **`slotCost`** on `AttackDefinition` and `PactDefinition`
(positive integer, default `1`). A player's held count for a kind becomes
the **sum of the slot costs** of what they hold, and a purchase is refused
when that sum plus the slot costs of what it would newly unlock exceeds the
limit.

---

## Decisions

| Question                          | Decision                                                                                                                          | Why                                                                                                                                                                                         |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Where the weight lives            | On the attack / pact definition (`slotCost`), not on the unlock upgrade.                                                          | It is a property of what is held; two routes to the same attack must charge the same.                                                                                                       |
| Default                           | Absent = `1`.                                                                                                                     | Every existing tree keeps its meaning with no edit.                                                                                                                                         |
| Shape                             | Positive integer (`z.number().int().positive()`).                                                                                 | Slots are whole; `0` would be a free attack in a capped kind — omit the cap instead.                                                                                                        |
| Allowed on an uncapped kind?      | Yes, inert.                                                                                                                       | The cap is opt-in per mode; a tree can author weights before it authors budgets.                                                                                                            |
| An attack/pact that can never fit | **Boot error** when `slotCost` exceeds the kind's greatest reachable limit (base + every grant × its purchase limit).             | Its unlock would be bought never — the dead-weight class the validator already rejects elsewhere. Infinite purchase limits make the reachable limit infinite, so nothing is rejected there. |
| Starting unlocks                  | The boot over-budget rule sums slot costs, not counts.                                                                            | Same rule, weighted.                                                                                                                                                                        |
| Display                           | Headings keep `held / limit` (now weighted). A card whose slot cost is not 1, in a capped kind, shows `◼ 2` — the slots it takes. | The player sees why one unlock ate the budget.                                                                                                                                              |
| Shared code                       | One helper, `slotCostOf` in `slots.ts`, beside the budget it feeds.                                                               | Two call sites each; the attack and pact slot functions stay mirror images.                                                                                                                 |

---

## Approach

### 1. Data

- `AttackDefinition.slotCost?` / `PactDefinition.slotCost?` in
  [types.ts](../../shared/src/types.ts), documented as "slots of its kind's
  budget this takes while held; default 1".
- `AttackSchema` / `PactSchema`: `slotCost: z.number().int().positive().optional()`.
  No tree version bump (optional field).

### 2. Rules

- `slots.ts` (the one budget algorithm attacks and pacts share):
  `slotCostOf(def) = def.slotCost ?? 1`.
  - `held` sums slot costs of the unlocked entities of the kind.
  - `hasSlotsFor` sums the slot costs of the entities it would newly unlock
    (still de-duplicated by id).
- `attacks.ts` / `pacts.ts`: `attackSlotsHeld`, `hasAttackSlotsFor` and their
  pact twins inherit the weighting from `slots.ts`; the client badge reads
  `slotCostOf` straight from the barrel.

### 3. Boot validation (`validateModeDefinition`)

- Starting-unlock rule for attacks and pacts sums slot costs.
- New: for each capped kind, the greatest reachable limit is
  `base + Σ over upgrades (grant × purchaseLimit)`; an attack or pact of that
  kind whose `slotCost` exceeds it throws ("can never be held").
- A programmatic mode with a non-integer / non-positive `slotCost` throws
  (the schema covers files).

### 4. Client

- Attack card and pact card: `◼ N` badge when the kind is capped and
  `slotCost !== 1`.
- Editor: "Slot cost" number input on attack and pact rows (clearing on `1`
  or less, so the file stays minimal).

---

## Tests

- `attacks.test.ts` / `pacts.test.ts`: held sums weights; a weight-2 unlock
  is refused with one slot free and allowed with two; a second route to a held
  weighted attack still charges nothing; unlock-and-grant still works.
- `flavor.test.ts`: starting unlocks over budget by weight throw; a slot cost
  beyond the reachable limit throws; one within it (with raises) is accepted;
  an infinite purchase limit never throws; bad programmatic values throw.
- `tree.test.ts`: schema accepts a positive int, rejects 0 / 1.5.
- Client: badge shown only for a capped kind and a weight other than 1;
  editor setter writes / clears.

---

## Implementation order

1. `docs(plans): 50 — slot cost`
2. `feat(slots): slotCost on attacks and pacts` — §1–§3 with tests.
3. `feat(client): slot cost badge and editor field` — §4.

---

## Open questions

1. **Content** — no idler attack or pact gets a weight yet; candidates are
   `termite-swarm` (67s window) and Drum Accord. Left for the balance pass.
2. **Badge glyph** — `◼ N` is a placeholder.
