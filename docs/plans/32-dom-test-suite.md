# 32 — A DOM test suite for the client

## Status: Phases 1–3 complete (infra + toasts + rest of VFX). Phase 4 deferred

---

## Problem

The client has a whole tier of code that **no test touches**: everything that
manipulates a live DOM. Today the client's Vitest suites run in the default
**node** environment with no `document`, so every DOM path is either:

- **guarded off** — VFX and toasts open with `if (!hasDom()) return`, so in tests
  they no-op and assert nothing ([vfx/index.ts](../../client/src/ui/vfx/index.ts),
  [vfx/toast.ts](../../client/src/ui/vfx/toast.ts)); or
- **string-only** — panels/components render to HTML **strings**
  (`renderTimer`, `renderUpgradeTree`, the panels), which the existing tests
  assert on as text. That's real coverage, but it never mounts a node, never
  fires an event, never checks that `spawnToast` actually appends a tinted
  banner or that the cap evicts the oldest.

We just built the toast system (plan 31) with **zero** automated coverage of its
DOM behaviour — cap eviction, idempotent removal, variant class, icon prefix,
layer fallback. The only safety net is the Playwright e2e suite, which is a real
browser but slow, heavy, and integration-scoped (it asserts _a_ toast appears,
not the unit logic). This plan adds the missing **middle tier**: fast, unit-level
tests that mount real DOM nodes.

**This tier already earned its keep before it exists.** Red-teaming this plan
surfaced a live freeze bug: the cap-eviction loop counted every `.toast-slot`,
but since the collapse-slot refactor `removeToast` defers the node removal to an
animation callback, so a fifth spawn onto a full stack re-selected the same
already-removing slot forever — an infinite loop that pins the tab. Fixed in
`da97644` (count only `:not([data-removing])` slots). The toast suite's
cap-eviction test (Phase 2, case 3) is the regression guard for exactly this, and
is the concrete evidence that the middle tier pays for itself.

**This reverses a documented convention.** The repo was deliberately DOM-free at
the unit level (jsdom was tried and removed). Adding a DOM environment is a
conscious reversal, at the owner's request. The cost is one dev dependency, a
second test environment, and the discipline to keep these tests deterministic
(see §4). None of it touches the shipped bundle — test deps aren't bundled.

---

## The crux: node can't run this code, but neither can jsdom (fully)

The DOM-manipulating code leans on **two browser capabilities that headless DOM
implementations don't fully provide**:

| Capability                                           | Used by                                                   | jsdom        | happy-dom    | real browser |
| ---------------------------------------------------- | --------------------------------------------------------- | ------------ | ------------ | ------------ |
| **Web Animations API** (`Element.animate`)           | every VFX + toast enter/exit                              | ❌ absent    | ⚠️ partial   | ✅           |
| **Layout** (`offsetHeight`, `getBoundingClientRect`) | toast slot collapse, click-popup positioning, `bumpScore` | ❌ returns 0 | ❌ returns 0 | ✅           |

So a pure jsdom/happy-dom run can verify **structure and logic** (what nodes
exist, their classes/text, that eviction removes the oldest, that removal is
idempotent) but **not** real animation timing or layout geometry. Those are only
truthfully testable in a real browser (Playwright, or Vitest browser mode).

**This is fine, because the two are worth testing in different places:**

- The **logic** worth unit-testing doesn't need real layout. "A `toast--info`
  banner with text `X` was appended", "the 5th spawn evicts the 1st", "calling
  `removeToast` twice removes the slot once" — all structural.
- The **visuals** (does it slide smoothly, is it positioned right) aren't
  meaningfully unit-assertable anyway. Those stay in Playwright e2e, where a real
  compositor exists.

### Decision: happy-dom, cheapest-that-works; a WAAPI shim only if the spike forces it

Recommended environment: **happy-dom**. The animation-timing question is settled
by a **Phase-1 spike, not up front** — default to the lightest approach and only
add machinery if it fails:

- **Default (try first): happy-dom's own `element.animate` + `vi.useFakeTimers()`.**
  The dismiss is driven by a `setTimeout`; fake timers advance it deterministically.
  Tests assert the **observable end state** (the slot is gone from the DOM), not
  the internal `onfinish` wiring. If happy-dom drives `animate().onfinish` on
  timer/microtask flush, this needs no shim at all.
- **Fallback (only if the spike shows the default can't finish removals
  deterministically): a small test-owned WAAPI shim** replacing
  `Element.prototype.animate` with a fake exposing `finish()`, plus a
  `flushAnimations()` the test calls to run pending `onfinish` synchronously.

The shim is real machinery — the kind this codebase accumulates and regrets — so
it stays **contingent**. Lead with the 30-minute spike; let it decide. The tests
assert the same end state either way, so the environment choice doesn't leak into
the test bodies.

**Spike outcome (Phase 1):** happy-dom `^20.11.2` ships **no** `Element.animate`
(`el.animate is not a function`), so the default path can't run at all — the
contingent shim is **required, not optional**. The harness installs a minimal
`installAnimateShim()` that replaces `Element.prototype.animate` with a fake whose
`onfinish` fires via `setTimeout(duration)`. Because the toast dismiss is _also_ a
`setTimeout`, a single `vi.advanceTimersByTime()` drives both the dismiss timer and
the exit animation to completion — no bespoke `flushAnimations()` needed. Spike
(`client/tests/toast-spike.dom.test.ts`) proves the end state (0 slots after
advance) deterministically.

Why happy-dom over jsdom: lighter, faster, no native deps, and the repo's
earlier friction was specifically an install failure — happy-dom sidesteps it.
(jsdom would also work; happy-dom is the lower-cost default.)

**Rejected alternative — Vitest browser mode / Playwright CT.** A real Chromium
(via the Playwright provider the repo already has) would give true WAAPI +
layout. But it's a heavier runner, slower per test, and overlaps the existing
e2e suite. For _unit_ logic it's overkill. Keep real-browser assertions in the
e2e suite that already exists; use happy-dom for the fast inner loop. Revisit
browser mode only if we find logic that genuinely can't be asserted without real
layout (none identified so far).

---

## Approach

### Coexist with the node suite — don't convert it

The existing DOM-free tests are correct and fast; they must keep running in node.
Two ways to add a DOM environment; recommend the **lightest**:

- **(A, recommended) Per-file environment docblock.** A DOM test opts in with
  `// @vitest-environment happy-dom` at the top of the file, named `*.dom.test.ts`
  by convention. No config split, one `pnpm --filter client test` command still
  runs everything. The WAAPI shim installs itself only when `document` exists, so
  it's a no-op in node files.
- **(B) A second Vitest project.** `vitest.config.ts` gains a `projects` array
  (node + dom) with separate `setupFiles`. Cleaner separation, but more config
  and a heavier mental model for a handful of files. Overkill now; revisit if the
  DOM suite grows past ~10 files.

Go with **(A)**. It's the minimal change that keeps one test command.

### New test infrastructure (small, shared)

`client/tests/dom-harness.ts` — the one shared helper the DOM tests import.
**Phase 1 ships only what Phase 2 uses** — the mount/reset utilities. Anything
speculative (layout stubbing, the WAAPI shim) is added **only when a real test
reaches for it**, not before:

```ts
// Mount/reset utilities for happy-dom tests. No-op unless a document exists.

/** Fresh #toast-layer attached to document.body, auto-cleaned between tests. */
export function mountToastLayer(): HTMLElement

/** Remove all children of document.body between tests. */
export function resetDom(): void
```

Tests call `mountToastLayer()` in `beforeEach` and `resetDom()` in `afterEach`.
Dismissals are advanced with Vitest fake timers.

**Deferred until a test needs them (not Phase 1):**

- `installWaapiShim()` / `flushAnimations()` — added **only if** the Phase-1
  spike shows happy-dom + fake timers can't finish removals deterministically.
- `stubLayout(px)` — happy-dom returns `0` for `offsetHeight`/`getBoundingClientRect`,
  which turned out fine for the structural toast **and** VFX tests: the collapse
  keyframe is `0px → 0px` and no VFX assertion checks a coordinate, so Phase 3
  shipped **without** it. It stays deferred until a test genuinely needs a real
  pixel value.

### Phasing (each phase is a separate, shippable commit)

| Phase    | Scope                                                                                            | Value    |
| -------- | ------------------------------------------------------------------------------------------------ | -------- |
| **1** ✅ | Infra: add `happy-dom` dev dep, minimal `dom-harness.ts`, spike proving `animate` + fake timers  | unblocks |
| **2** ✅ | **Toasts** — the feature we just built, currently 0% covered                                     | **high** |
| **3** ✅ | Rest of `vfx/index.ts` — click popup, combo counter, `shakeScreen`, `flashPurchase`, `bumpScore` | medium   |
| **4**    | _(optional, flag first)_ UI wiring — `screens.ts`/`playing.ts`/`end.ts` event listeners          | low–med  |

Phases 1–2 are the committed scope of this plan. 3 is a fast follow. **4 is
explicitly deferred** and may not be worth it — see §5. `dev/**` (queue-sim,
chart, editor DOM) is **out of scope**: dev-only tooling, not shipped, already
partially covered by editor model tests.

---

## What the toast suite (Phase 2) asserts

Concrete cases for `client/tests/toast.dom.test.ts` — all structural, all
deterministic via the shim:

1. **Append + variant.** `spawnToast('hi', 'info')` adds one `.toast-slot`
   containing a `.toast.toast--info` whose text is `hi`.
2. **Icon prefix.** `spawnToast('hi', 'success', { icon: '🏗️' })` → text
   `🏗️ hi`.
3. **Cap eviction terminates and evicts the oldest.** Spawn 5 with
   `TOAST_MAX_VISIBLE = 4`; the call **returns** (regression guard for the
   `da97644` infinite loop) and — after the dismiss/flush — 4 slots remain with
   the first-spawned gone. A pre-fix run of this test hangs, which is the point:
   it locks in the fix.
4. **Idempotent removal.** The auto-dismiss timer and a cap eviction targeting
   the same slot remove it exactly once (`dataset.removing` guard) — spy that
   `slot.remove()` runs once.
5. **Exit completes.** After the dismiss timer fires (fake timers) the slot is
   gone from the DOM.
6. **Layer fallback.** With no `#toast-layer`, toasts append to the global
   `getLayer()` container (the test-and-non-play-screen path).
7. **`hasDom()` guard.** (node file, no docblock) `spawnToast` is a no-op when
   `document` is undefined — keeps the existing guarantee.

Wiring-level (attack → toast) is **already** covered server-side
([match.test.ts](../../server/tests/match.test.ts)) and end-to-end in Playwright;
this suite owns the client primitive only.

---

## Files touched

| File                             | Change                                                                                            |
| -------------------------------- | ------------------------------------------------------------------------------------------------- |
| `client/package.json`            | add `happy-dom` to `devDependencies`.                                                             |
| `client/tests/dom-harness.ts`    | **new** — Phase 1: `mountToastLayer` + `resetDom` only. Shim/`stubLayout` added later, if needed. |
| `client/tests/toast.dom.test.ts` | **new** — Phase 2 suite (cases above).                                                            |
| `client/tests/vfx.dom.test.ts`   | **new, Phase 3** — popup/combo/shake/flash/bump; adds `stubLayout` to the harness.                |
| `client/vitest.config.ts`        | none if we go with per-file docblocks (A); else add `projects` (B).                               |
| `docs/DESIGN.md` / `CLAUDE.md`   | one line noting the client now has a DOM test tier + the happy-dom convention.                    |

No production code changes. If a function proves genuinely untestable without a
refactor (e.g. hard-coded `document` lookups), that refactor gets its **own**
plan — this one adds tests around code as-is.

---

## Complexity check

- **New dependency (`happy-dom`).** Dev-only, unbundled. Justified: it's the
  price of testing the DOM tier at all. Cheaper than jsdom (the earlier friction)
  and far cheaper than routing every VFX assertion through Playwright.
- **New abstraction (`dom-harness.ts`).** Phase 1 ships only `mountToastLayer` +
  `resetDom` (~20 lines). Justified: the mount/reset boilerplate would otherwise
  be copy-pasted into every DOM test. It's a test util, not production coupling.
- **The WAAPI shim is deliberately _not_ in Phase 1.** It's the one genuinely
  non-obvious piece, so it stays contingent on the spike: default to happy-dom's
  `animate` + fake timers asserting end state, and only build the shim if that
  can't finish removals deterministically. Refusing to pre-build it is the whole
  point — unused machinery is the recurring cost here.
- **`stubLayout` is deferred to Phase 3**, where the first test that reads
  `getBoundingClientRect` actually needs it. Not shipped speculatively.
- **No speculative generality.** The harness ships only the helpers the current
  phase uses. No "assert on keyframes" API, no snapshot machinery.

---

## Open questions

1. **happy-dom vs jsdom** — recommend happy-dom (lighter, install-friendlier).
   Any objection to the dependency? The Phase-1 spike confirms happy-dom's
   `element.animate` + fake timers finish a toast removal deterministically; if
   it can't, the fallback is the contingent WAAPI shim (jsdom is also a drop-in
   with the same harness).
2. **Per-file docblock (A) vs projects (B)** — recommend A for now. OK to defer B
   until the suite grows?
3. **Is Phase 4 (UI wiring tests) wanted at all?** These modules are thin
   `getElementById().addEventListener` glue whose real value is integration,
   which Playwright already covers. My lean: **skip** unless a specific bug makes
   a case. Confirm.
4. **Coverage expectations.** Do we want a coverage threshold on the new DOM
   files, or just "tests exist and pass"? I'd start with the latter — thresholds
   invite gaming.

---

## Recommendation

Adopt Phases 1–2 (infra + toasts) as the committed scope; land Phase 3 as a fast
follow; defer Phase 4 pending a concrete need. Environment: happy-dom, opted into
per-file via `// @vitest-environment happy-dom`, with dismissals advanced by
Vitest fake timers; a WAAPI shim only if the Phase-1 spike proves it necessary.
This buys real unit coverage of the toast primitive we just shipped — including a
regression guard for the `da97644` eviction freeze — keeps the fast node suite
intact, and leaves real-browser assertions where they already live (Playwright).
