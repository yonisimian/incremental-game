---
description: 'How to decide which test tier a change belongs in (logic unit / DOM unit / server unit / e2e), plus the conventions each tier follows. Use when adding or moving tests, or when a feature needs coverage.'
name: 'test-tier boundaries'
applyTo: 'client/tests/**,server/tests/**,shared/tests/**,e2e/**'
---

# Test-tier boundaries

The repo has **four** test tiers. Detail on running them lives in
[CLAUDE.md](../../CLAUDE.md); this file is the decision framework for **where a
test belongs** and how each tier is written.

| Tier            | Runner / env        | Owns                                                                                         | Example                                                                                                                                    |
| --------------- | ------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **Logic unit**  | Vitest, node        | Pure functions: game math, modifier pipeline, reconciliation, codecs, string-render panels   | [shared/tests](../../shared/tests), [client/tests/mode-ui.test.ts](../../client/tests/mode-ui.test.ts)                                     |
| **DOM unit**    | Vitest, happy-dom   | One module that mounts real nodes: append/class/text, eviction, dataset guards, cleanup      | [client/tests/toast.dom.test.ts](../../client/tests/toast.dom.test.ts), [client/tests/vfx.dom.test.ts](../../client/tests/vfx.dom.test.ts) |
| **Server unit** | Vitest, node        | Match loop, validation, anti-cheat, attack resolution — logic with a fake socket             | [server/tests/match.test.ts](../../server/tests/match.test.ts)                                                                             |
| **e2e**         | Playwright, browser | Cross-boundary orchestration: client↔server over a real WS, two players, round timer, layout | [e2e/tests](../../e2e/tests)                                                                                                               |

## The rule

**Write the test at the lowest tier where it can fail truthfully — and no lower.**

"Truthfully" is load-bearing. A test at too low a tier passes by mocking away the
thing that actually breaks (you test the mock); a test at too high a tier is slow
and flaky for a failure a cheaper tier could catch. The real question is never
"unit or e2e?" — it's **what capability must be _real_ for this failure to
surface?**

| The failure needs…                                                                                | Tier       |
| ------------------------------------------------------------------------------------------------- | ---------- |
| only values / strings                                                                             | logic unit |
| a live DOM node — append, class, `addEventListener`, dataset guard, `onfinish` cleanup            | DOM unit   |
| the network, server authority, the round clock over the wire, two players, real pixels/compositor | e2e        |

## Deciding for a new feature

Walk these in order; stop at the first "yes". A feature may land in **more than
one** tier (pure core + a thin DOM/e2e seam).

1. **Pure logic** (formula, reducer, validator, codec)? → **logic unit**, always.
   Cheapest and most stable; the bulk of coverage lives here.
2. **Interesting DOM mutation** — appends, evicts, guards double-removal, wires
   cleanup, unlocks a panel by id-matching? → **DOM unit**, one file per module.
   (This tier caught the toast eviction-freeze bug the day it was added.)
3. **Worth depends on a real boundary** — the WS, server authority, the round
   timer, two players, real layout? → **one e2e happy-path**, not a matrix. e2e
   proves the wire is connected; it must not re-test logic a unit already covers.
4. **Refactor gate:** if the interesting logic is only reachable through a real
   browser, that's a smell — extract it into a pure function (tier 1) and leave a
   thin DOM/e2e seam.

## UI wiring (`screens.ts` / `playing.ts` / `end.ts`)

This glue is `getElementById().addEventListener(...)`. Split each listener by what
its handler asserts — the dividing line is **does the assertion cross the
client/server boundary?**

- **No** (handler calls a pure function, toggles a class, opens a panel) → **DOM
  unit**: mount the fragment, dispatch a real `click`, assert the DOM/state
  change. Fully reproducible without a server.
- **Yes** (click → message → `STATE_UPDATE` → screen reconciles) → **e2e**. A
  DOM-unit version must mock the socket, which tests the mock, not the wiring.

## Anti-patterns (name and avoid)

- Pushing a formula into e2e "to be safe" — slow, flaky, wrong tier.
- Mocking a socket in a DOM test to fake a round-trip — tests the mock.
- A DOM test for pure string-rendering a node test already covers.
- An e2e matrix re-testing logic combinations a unit owns.

## DOM-unit conventions (happy-dom)

- Opt a file in with `// @vitest-environment happy-dom` on line 1; name it
  `*.dom.test.ts`. No config split — one `pnpm --filter client test` runs
  everything. The DOM-free guard case (asserting `hasDom()` no-ops) stays a
  **node** file (no docblock).
- happy-dom ships **no** `Element.animate`. Use `installAnimateShim()` from
  [client/tests/dom-harness.ts](../../client/tests/dom-harness.ts): it fires
  `onfinish` via `setTimeout(duration)`, so with `vi.useFakeTimers()` a single
  `vi.advanceTimersByTime()` drives both the code's own dismiss timer and the
  exit animation to completion. Assert the **observable end state** (node gone),
  not `onfinish` wiring.
- Mount with `mountToastLayer()` in `beforeEach`, tear down with `resetDom()` in
  `afterEach`. Reset any module-level state (e.g. `resetCombo()`).
- happy-dom returns `0` for `getBoundingClientRect`/`offsetHeight`. That's fine as
  long as no assertion checks a coordinate — pixel geometry and real motion belong
  in e2e. Only add a layout stub when a test genuinely needs a real pixel value.
- Effects that only animate an existing element (pulse, flash, bump, shake) are
  asserted by spying `animate` on the target and checking the no-op-when-absent
  path — not by inspecting keyframes.

## Scope notes

- `dev/**` tooling (queue-sim, chart, editor DOM) is **out of scope** for the DOM
  tier — dev-only, unshipped, partly covered by editor-model unit tests.
- Rebuild `@game/shared` before running server/client tests that exercise changed
  shared code (they import `shared/dist`, not source) — see CLAUDE.md.
