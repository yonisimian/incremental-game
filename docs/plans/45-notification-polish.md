# 45 — Notification polish: placement, timing, interaction, accessibility

## Status: Implemented

---

## Problem

The toast primitive ([toast.ts](../../client/src/ui/vfx/toast.ts)) works, but it
reads as a prototype:

1. **Too short.** One flat 2500 ms for every severity. A loss ("🗡️ Raid: lost
   ×2 🪚 Sawmill") gets the same glance-time as "nothing to steal", while the
   player's eyes are on the buttons they're clicking.
2. **No way to hold or dismiss.** The user asked for pause-on-hover and a close
   control. Both are blocked by placement: the layer overlays the panel region
   with `pointer-events: none` ([style.css](../../client/src/style.css) `.toast-layer`),
   and that `none` is load-bearing — an interactive toast there would steal
   clicks meant for buy buttons.
3. **Accessibility defects.**
   - `aria-live="polite"` sits on the layer, and the sticky incoming-attack
     toast rewrites its text every snapshot → a screen reader re-announces the
     countdown every ~500 ms.
   - No `prefers-reduced-motion` handling. WAAPI animations ignore CSS media
     queries, so this has to be checked in JS; the incoming-hit `shakeScreen`
     is the worst offender.
4. **Layout details.**
   - `white-space: nowrap` inside an `overflow: hidden` layer clips long
     messages on narrow screens.
   - Countdown digits have no `tabular-nums`, so the sticky toast's width
     jitters while the rest of the numeric UI is steady.
   - Icons are inlined into the text by every caller, doubling up in the
     warning ("⚠️ 🗡️ Raid in 4.0s"), while the `icon` option goes unused.
5. **Sticky warnings drift.** They're appended like any toast, so as the
   transient toasts above them expire, they slide up — the one notification
   that stays is the one that keeps moving.

## Approach

### 1. Placement: gutter on wide screens, overlay (as today) on narrow

`#app` is capped at `max-width: 420px`, so on desktop the game is a narrow
centred column with empty gutters. On wide screens, move the layer into the
**right gutter** (decided), aligned to the top of the panel region. There it
overlaps nothing clickable, so it can become interactive.

Pure CSS, no DOM move, no JS branch:

```css
@media (min-width: 1080px) {
  .toast-layer {
    inset: 0 auto auto calc(100% + 1.5rem); /* right of the column */
    width: 18rem;
    padding: 0;
    overflow: visible;
    pointer-events: auto;
  }
  .toast {
    cursor: pointer;
  }
}
```

- **The layer itself takes the pointer, not just each toast.** The gap between
  toasts is slot padding. If only `.toast` were hit-testable, moving the cursor
  between two toasts would fire `pointerleave` on the layer and resume the
  timers mid-read. In the gutter the layer is sized to its content and overlaps
  nothing, so making the whole layer interactive is safe.
- **No `(hover: hover)` / `(pointer: fine)` in the query.** In the gutter nothing
  sits underneath, so interactivity is safe for any input. A landscape tablet
  (≥ 1080px, coarse pointer) gets the gutter plus tap-to-dismiss rather than a
  toast over its buttons.

- **Why `absolute` off `.panel-region`, not `position: fixed`:** `shakeScreen`
  animates `transform` on `.playing-screen`, and a transformed ancestor becomes
  the containing block for `fixed` descendants. A fixed toast would jump from
  the viewport corner into the column for 300 ms on every incoming hit —
  exactly when a danger toast spawns. Anchoring to `.panel-region` (the full
  column width) with `left: calc(100% + gap)` puts the toast in the gutter
  _and_ shakes it with the scene, which is coherent.
- **1080px threshold:** `.panel-region` is the column minus `#app`'s padding,
  388px wide. The toast's right edge sits at centre + 194 + 24 + 288 = centre +
  506px, so it fits once vw / 2 ≥ 506, i.e. vw ≥ 1012. 1080 leaves about 34px
  of margin and no horizontal scrollbar.
- **Narrow (< 1080px): unchanged.** The toast overlays the panel top and ignores
  the pointer. There's no free space on a phone. Because interactivity comes
  only from `pointer-events`, the hover and click handlers below never fire on
  narrow layouts, with no media query in JS. **Consequence:** below 1080px no
  toast can be paused or closed, including the incoming-attack warning. That
  also covers a narrow desktop window. This is the price of not stealing
  clicks, and it's accepted here.

### 2. Interaction (wide layout only, by construction)

- **Hover pauses the whole stack.** `pointerenter` on the layer pauses every
  live timer; `pointerleave` resumes each with its remaining time, floored at
  1000 ms so nothing vanishes the instant the cursor leaves. Pausing the stack
  rather than one toast keeps the order from shifting under the reader. A toast
  spawned while paused starts paused.
- **Click any toast to dismiss it, sticky ones included** (decided). The whole
  banner is the target. **No ✕ button** (rejected, see below). Closing an
  incoming-attack warning hides nothing unique: the espionage panel's
  always-shown "Enemy Attacks" section carries the same countdown. The caller's
  handle already copes with a user-closed toast: `game.ts` keeps the entry in
  `incomingAttackToasts`, so later `update()` calls write to a detached node
  (harmless). The strike's key stays in the map until it lands, so the warning
  is **not respawned** on the next snapshot, and the eventual `dismiss()` is a
  no-op thanks to the `data-removing` guard.
- **The cap still evicts while hovered.** A burst past 4 removes the oldest
  transient toast even if the reader is on it. Bursts are rare (see
  "Coalescing" below), and letting a paused stack grow without bound is worse.

**State.** One `WeakMap<HTMLElement, { paused: boolean }>` keyed by layer does
double duty: its presence means the listeners are bound, and it holds the pause
flag. The play screen re-renders `#toast-layer` every match, so a module-level
flag would leak a stale `paused = true` from a layer torn down mid-hover into
the next match, and every new toast would stay forever. Per slot, `{
remainingMs, startedAt, timeoutId }` in a `WeakMap<HTMLElement, …>` replaces
the bare `setTimeout`.

**Reset on empty.** When the last slot leaves the layer, set `paused = false`.
Closing the last toast shrinks the layer to zero height under a stationary
cursor, and engines differ on whether they fire `pointerleave` before the next
mouse move. Without the reset, the next toast could spawn paused and never
leave.

### 3. Timing: per-severity defaults

| Variant   | Now     | New     | Why                                           |
| --------- | ------- | ------- | --------------------------------------------- |
| `info`    | 2500 ms | 3000 ms | Low stakes ("nothing to steal", pact signed). |
| `success` | 2500 ms | 3500 ms | Confirms something the player just did.       |
| `warning` | 2500 ms | 4500 ms | Intel ("attack repelled") worth reading.      |
| `danger`  | 2500 ms | 5000 ms | A loss — the player needs the numbers.        |

A `Record<ToastVariant, number>` replaces `TOAST_DEFAULT_MS`. Delete the
`durationMs` option — no caller uses it, and the table covers what it was for.

**Considered and rejected: a reading-time formula** (`base + ms × chars`).
Current copy is 20–45 characters, so the severity floors would dominate every
real message. That's extra machinery for no visible change.

### 4. Accessibility

- **Announcer split.** The visual layer becomes `aria-hidden="true"`. A
  separate visually-hidden `aria-live="polite"` element (`#toast-announcer`,
  rendered beside the layer in [playing.ts](../../client/src/ui/playing.ts))
  gets a child node appended on spawn and removed with the toast. `update()`
  only touches the visual node, so the sticky countdown is announced once, on
  arrival. Needs a new `.sr-only` utility class (none exists). With no
  `#toast-announcer` (tests, non-play screens) nothing is announced.
  - **Not `role="status"`:** that role implies `aria-atomic="true"`, so every
    append would re-read _all_ live toasts. A bare `aria-live="polite"`
    defaults to non-atomic and to `aria-relevant="additions text"`, so each
    spawn reads once and removals stay silent.
  - Closing by click is a mouse/touch convenience only: toasts aren't
    focusable, and keyboard users rely on auto-dismiss. Stickies still leave
    when their strike lands, so nothing gets stuck. Because nothing inside the
    `aria-hidden` layer is focusable, axe's `aria-hidden-focus` rule stays
    satisfied.
- **Reduced motion.** New `prefersReducedMotion()` in
  [vfx/shared.ts](../../client/src/ui/vfx/shared.ts) (a `matchMedia` read).
  When true, enter/exit are an opacity fade only. On exit the slot is removed
  when the fade finishes, with no height collapse, so the stack below jumps
  instead of sliding. `shakeScreen` becomes a no-op. Other VFX (floaters,
  combo, bumps) are **out of scope** and flagged as a follow-up. happy-dom's
  `matchMedia` reports `matches: false`, so existing VFX DOM tests are
  unaffected.

### 5. Layout and structure

- Toast markup becomes `<span class="toast-icon">` + `<span class="toast-text">`
  as a two-column flex row, so wrapped text hangs under the text instead of
  under the icon. `update()` rewrites only `.toast-text`.
- Callers in [game.ts](../../client/src/game.ts) pass the subject's icon via
  `opts.icon` and keep only words and quantities in the text. Resource and
  generator icons inside a quantity ("50 🪵", "×2 🪚 Sawmill") stay inline.

  | Toast               | Icon        | Text (before → after)                                             |
  | ------------------- | ----------- | ----------------------------------------------------------------- |
  | Attack event        | attack icon | `🗡️ Raid: stole 50 🪵` → `Raid: stole 50 🪵`                      |
  | Pact signed         | pact icon   | `🤝 🌾 Accord signed by the enemy` → `Accord signed by the enemy` |
  | Warning, revealed   | attack icon | `⚠️ 🗡️ Raid in 4.0s` → `Raid lands in 4.0s`                       |
  | Warning, unrevealed | `⚠️`        | `⚠️ Incoming attack in 4.0s` → `Enemy attack lands in 4.0s`       |

  The warning copy is aligned with the espionage panel's line ("Enemy attack
  lands in 4.0s."), so the two readouts of one countdown say the same thing.
  The `🤝` goes because the variant tint and "signed by the enemy" already say
  what it said.

- `.toast`: `white-space: normal`, `max-width: 100%`, `font-variant-numeric:
tabular-nums`. Slot collapse already reads `offsetHeight`, so multi-line
  toasts need no change there.

### 6. Sticky toasts pinned to the top

A sticky slot is inserted before the first non-sticky slot rather than
appended, so warnings hold a fixed position at the head of the stack and the
transient toasts churn below them. One `insertBefore` in `spawnToast`.

## Explicitly not in this plan

| Item                                    | Why not                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ✕ close button                          | A small target nobody will aim at mid-race on a toast that leaves on its own. Clicking the whole toast does the same job with a larger target and no extra chrome.                                                                                                                                                                       |
| Pausing toasts with the game pause      | Toast timers are wall-clock and the PAUSED banner already takes over the screen. Toasts expiring during a pause loses nothing that isn't shown elsewhere.                                                                                                                                                                                |
| Victim-side debuff countdown            | The real fix for "the toast is the only place the debuff duration appears" ([game.ts](../../client/src/game.ts) `showAttackEvents` comment). But the victim receives resolved `Modifier[]` with no expiry — `activeDebuffs` live on the attacker. Needs a wire field (like `incomingPurchaseLocks[].untilSec`), so it gets its own plan. |
| Coalescing identical toasts (`×3`)      | Attack cooldowns (43) and the attack limit (38) make real bursts rare. Exact-text merging would miss most cases anyway (amounts differ), and merging amounts needs structured payloads. Revisit if the cap is ever hit in play.                                                                                                          |
| Draining progress bar on sticky warning | Snapshot cadence plus game pause means the bar has to re-sync every update, or it drains during a pause. The text countdown (now `tabular-nums`) plus the espionage panel line are adequate.                                                                                                                                             |
| Notification history / log              | Useful only once some toast is the sole source of something. After the debuff-countdown plan, none is.                                                                                                                                                                                                                                   |

## Files touched

| File                                       | Change                                                                                                                                                            |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `client/src/ui/vfx/toast.ts`               | Per-variant durations, pausable timers, per-layer state (hover/click binding + pause flag), announcer mirror, icon/text spans, sticky pinning; drop `durationMs`. |
| `client/src/ui/vfx/shared.ts`              | `prefersReducedMotion()`; `shakeScreen` early-returns on it.                                                                                                      |
| `client/src/ui/playing.ts`                 | `aria-hidden` on `#toast-layer` (drop its `aria-live`); add `#toast-announcer` (`aria-live="polite"`, `.sr-only`).                                                |
| `client/src/game.ts`                       | Pass icons via `opts.icon`; new copy per the §5 table.                                                                                                            |
| `client/src/style.css`                     | Gutter media query, `.toast` wrap + tabular-nums + icon/text layout, `.sr-only`.                                                                                  |
| `client/tests/toast.dom.test.ts`           | New cases below; update the icon and sticky-update assertions for the span markup.                                                                                |
| `client/tests/attack-alert.test.ts`        | Update expected text/opts for the new warning copy and `icon`.                                                                                                    |
| `client/tests/attack-event-toasts.test.ts` | Update expected text and assert `opts.icon`.                                                                                                                      |
| `client/tests/vfx.dom.test.ts`             | Reduced-motion `shakeScreen` case.                                                                                                                                |
| `e2e/tests/notifications.spec.ts` (new)    | Desktop placement + hover + click-away (NOTIF-01).                                                                                                                |
| `e2e/tests/mobile.spec.ts`                 | Tap pass-through (MOB-05).                                                                                                                                        |

No `shared/` or `server/` changes. No wire changes.

## Data / type changes

- `ToastOptions`: remove `durationMs`. `icon` and `sticky` stay.
- `ToastHandle`: unchanged.

## Complexity check

- **Pausable timers** (per-slot WeakMap + per-layer pause flag) replace a
  one-line `setTimeout`. This is the real cost of the hover request, and it's
  justified only because placement now makes hover reachable. Without step 1 it
  would be wasted.
- **Per-layer state map**: one structure instead of a `WeakSet` plus a flag. It
  exists because the layer is re-created every match.
- **Announcer element**: one extra DOM node and a mirror append/remove. It's
  the smallest fix for the re-announce bug that doesn't depend on AT timing
  quirks (setting `aria-hidden` after insertion races the reader).
- **`prefersReducedMotion()`**: one helper, two call sites.
- **Deleted:** `durationMs`, `TOAST_DEFAULT_MS`. Allowing sticky toasts to be
  closed also removes a special case: one click handler for every toast.
- No new abstractions beyond these. Coalescing, progress bar and history are
  explicitly left out.

## Test strategy

### DOM unit (`toast.dom.test.ts`, happy-dom + the harness `animate` shim)

- Per-variant durations: danger is alive at 4.9 s and gone after 5 s plus the
  exit; info is gone after 3 s plus the exit.
- `pointerenter` on the layer freezes dismissal; `pointerleave` resumes with
  the remaining time, floored at 1 s.
- A toast spawned while paused stays until leave.
- Pause resets when the last slot leaves: after close-by-click empties a
  hovered layer, a new toast auto-dismisses on schedule.
- A fresh layer (new match) starts unpaused even if the previous one was torn
  down while paused.
- Click closes a transient toast **and** a sticky one; a later `update()` /
  `dismiss()` on the sticky's handle doesn't throw or resurrect it.
- A sticky is inserted ahead of existing transient toasts and after existing
  stickies.
- The announcer gets one node on spawn, is unchanged by `update()`, and loses
  it when the toast leaves. No announcer means no error.
- The icon renders in `.toast-icon` and `update()` preserves it.
- Existing cases keep passing: cap/eviction, idempotent removal, sticky never
  evicted, fallback layer.

### Other units

- `vfx.dom.test.ts`: with `matchMedia` stubbed to reduce, `shakeScreen` doesn't
  call `animate`.
- `attack-alert.test.ts` / `attack-event-toasts.test.ts`: new copy plus
  `opts.icon` (these mock `spawnToast` and assert exact strings, so they break
  first and must change with `game.ts`).
- `toast-guard.test.ts`: unchanged, no-DOM guard.

### E2E (decided: yes)

**Trigger: a mutual pact, not an attack.** No e2e test fires an active attack.
The cheapest live one (`a0`) costs 1000 🪵 with a 6 s prepare, which is too slow
and flaky to reach in a 35 s round. Instead, player A buys `ir-unlock` →
`pact-node-2` (both free; the latter unlocks `p1`, which is `mutual: true`).
The server then puts `p1` in B's `opponent.pacts` (`sharedPacts`), and
`showSharedPactsSigned` spawns an `info` toast on B. That's deterministic, uses
only free upgrades, and goes through the real server path.

- **NOTIF-01** (new `notifications.spec.ts`; runs on Chromium, Firefox and
  WebKit at 1280×800, so the gutter layout applies):
  1. The toast becomes visible on B.
  2. Its bounding box doesn't intersect `#panel-container`'s.
  3. Hover it, hold past the info duration (≈ 4 s via `expectUnchanged`), and
     it's still visible. This is the real-engine check that `pointerenter`
     reaches the layer. happy-dom can't prove that; the three engines can.
  4. Click it; it's gone within the exit time.
- **MOB-05** (in `mobile.spec.ts`, Pixel 7, overlay layout): same trigger.
  At the toast's centre, `document.elementFromPoint` must resolve **outside**
  `.toast-layer`, so taps reach the panel beneath.

## Decisions

1. **E2E: yes.** Via the mutual-pact trigger above.
2. **Gutter side: right.**
3. **Incoming-attack warnings are closable** by click, like every toast, but
   only in the ≥ 1080px gutter layout (see §1 consequence).

## Risks

- **NOTIF-01 timing.** The 3 s timer starts when the toast spawns on B, and
  `hover()` lands within tens of ms of `toBeVisible()`, so there's close to 3 s
  of margin, even on WebKit in CI. Pre-hovering isn't an option: the gutter
  layer has zero height when it's empty. If it flakes, investigate. Don't
  lengthen the duration for a test.
- **Pact copy dependency.** The e2e asserts on a toast existing, not on its
  text, so flavor renames don't break it.
- **Tree dependency.** If `pact-node-2` stops being free or `p1` stops being
  mutual, NOTIF-01 fails loudly at the purchase step. That's the right failure.
