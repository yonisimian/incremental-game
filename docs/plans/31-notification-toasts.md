# 31 — Notification toasts: a generic in-match event feed

## Status: Draft

---

## Goal

Give the match a **general-purpose toast system**: a stack of transient banners
that announce game events, tinted by severity. Four semantic variants:

| Variant   | Colour | CSS var     | Status             | Live trigger this plan?    |
| --------- | ------ | ----------- | ------------------ | -------------------------- |
| `info`    | blue   | `--info`    | **new var**        | none yet (future pacts)    |
| `success` | green  | `--success` | exists (`#4ade80`) | outgoing attack landed     |
| `warning` | orange | `--warning` | **new var**        | none yet (future incoming) |
| `danger`  | red    | `--danger`  | exists (`#f87171`) | incoming attack (you lost) |

The toast layer sits **in front of the panel container** (the play screen's main
content), stacks vertically, and each toast auto-dismisses after a few seconds.
No interaction, no history, no dismiss button — purely a glanceable feed.

**Honest scope note.** The user wants all four variants, and the primitive ships
with all four — but only **two fire today** (`success`/`danger`, from the attack
events that already exist). `info` and `warning` have no live trigger this plan;
they exist so the future pact / incoming-attack features drop in without
touching the primitive. That's a deliberate, user-requested bit of forward
capacity, not speculative plumbing — the cost is two CSS vars and two enum
members, nothing structural.

The user's motivating examples, and where each stands today:

| Example               | Underlying event exists?                                           |
| --------------------- | ------------------------------------------------------------------ |
| About to get attacked | **No** — opponent's `pendingAttacks` are redacted from the client. |
| Get attacked          | **Yes** — `incoming` `AttackEvent` (already a toast).              |
| My attack finishes    | **Yes** — `outgoing` `AttackEvent` (already a toast).              |
| Battery is full       | **Deferred** — derivable, but skipped this plan (see §3).          |
| Pact starts           | **No** — pacts have no lifecycle yet (unlockable ids only).        |
| Pact finishes         | **No** — same.                                                     |

So this plan builds the **infrastructure** plus the two triggers that are cheap
and real today, and explicitly **defers** the rest (including battery-full).
Building toast plumbing for pact-start when pacts do nothing would be
speculative — flagged below and left out.

---

## What already exists (verified)

- **`spawnAttackToast(text, 'incoming' | 'outgoing')`** in
  [ui/vfx/index.ts](../../client/src/ui/vfx/index.ts) — a stacking top-center
  banner. Incoming tints `--danger`, outgoing tints `--gold`. Styled by
  `.vfx-attack-toast*` in [style.css](../../client/src/style.css) (~L1489).
  Placed in the global `vfx-layer` (`getLayer()`), not the panel container.
- **`AttackEvent`** deltas on `STATE_UPDATE`
  ([messages.ts](../../shared/src/messages.ts)) → `showAttackEvents` in
  [game.ts](../../client/src/game.ts) (~L838) resolves flavor and spawns toasts.
  Incoming also `shakeScreen('medium')`.
- **Battery charge** is authoritative `meta.hlCharge`, extrapolated on a rAF loop
  in [ui/panels/battery-bar.ts](../../client/src/ui/panels/battery-bar.ts).
  `collectBatteryParams` yields `maxCharge`; `readBatteryCharge` reads current.
- **`#panel-container`** is rendered by `renderPanelContainer`
  ([ui/panels.ts](../../client/src/ui/panels.ts)); the play screen wraps it in
  [ui/playing.ts](../../client/src/ui/playing.ts).

The existing attack toasts are the seed of this feature — this plan generalises
them rather than adding a parallel system.

---

## Approach

### 1. A generic toast primitive (VFX layer)

Add `spawnToast` to `ui/vfx/` alongside the existing effects:

```ts
export type ToastVariant = 'info' | 'success' | 'warning' | 'danger'

export interface ToastOptions {
  /** Optional leading icon (emoji). */
  icon?: string
  /** Auto-dismiss delay; defaults to ~2.5s. */
  durationMs?: number
}

export function spawnToast(text: string, variant: ToastVariant, opts?: ToastOptions): void
```

Reuses the existing lazy-container + enter/hold/exit WAAPI keyframes from
`spawnAttackToast`. Toasts are appended **directly** to the `#toast-layer` overlay
(see placement) — no separate inner stack element. The only real changes from
`spawnAttackToast` are: four variants instead of two, an optional icon slot, a
**soft visible cap** (see below), and **anchoring to the panel container** rather
than the global screen.

**Placement (decided: A).** A dedicated `.toast-layer` element is rendered inside
the play screen's content wrapper — a sibling overlay of `#panel-container`, both
inside a `position: relative` parent. This keeps the toast visually bound to the
panel region across viewport sizes without measuring `getBoundingClientRect` per
spawn, and it's automatically torn down when the play screen unmounts. This is the
more professional of the two options considered (the alternative — keeping toasts
in the global `vfx-layer` and positioning them over the panel's bounding box —
leaks geometry math and screen coupling into the VFX module). Concretely: render
an empty `<div class="toast-layer" id="toast-layer" aria-live="polite">` next to
`renderPanelContainer()` in [playing.ts](../../client/src/ui/playing.ts), and have
`spawnToast` target `#toast-layer` (falling back to `getLayer()` in tests / when
absent).

**Must not block input.** The overlay sits _in front of_ the panel container, so
`.toast-layer` needs `pointer-events: none` (individual toasts inherit it) or it
swallows every click/tap meant for the panel beneath — the same guard the current
`.vfx-attack-toasts` already uses. This is a correctness requirement, not a
polish item.

**Soft cap (decided).** Cap the visible stack at **4** toasts. On spawn, if the
stack already holds 4, immediately remove the oldest (fast fade) before appending
the new one — so an attack flurry can't build a wall of banners. The cap is a
single constant checked in `spawnToast`; no queue, no history.

The `aria-live="polite"` region makes toasts screen-reader-announced without
stealing focus — a small correctness win over the current `vfx-layer` toasts,
which are silent to assistive tech.

### 2. Migrate attack toasts onto it

Replace `spawnAttackToast` with `spawnToast`:

- `outgoing` → `spawnToast(..., 'success')` (your attack landed — good for you).
- `incoming` → `spawnToast(..., 'danger')` + keep `shakeScreen('medium')`.

Delete `spawnAttackToast` and its `.vfx-attack-toast*` CSS (folded into the new
`.toast*` styles). `showAttackEvents` in [game.ts](../../client/src/game.ts) keeps
its flavor-resolution logic; only the spawn call changes.

**Colour flip (decided).** Outgoing is currently tinted `--gold`; it flips to
`success` (green), the better fit for "your strike landed." This removes the
toast's only use of `--gold` — but note `--gold` is **not** deleted from the
theme: it's still used by `bumpScore`, the streak animation, `.resource-item.gold`,
and `.upgrade-detail-cost`. "Delete gold" is therefore scoped to _the toast's_
gold usage; the variable stays. (Flagged in the review — the literal reading
"delete the `--gold` variable" would break four unrelated call sites.)

### 3. Deferred triggers (explicitly out of scope)

- **About to get attacked.** Requires surfacing the opponent's `pendingAttacks`
  (or a redacted "incoming strike ETA") over the wire — a new field on
  `OpponentView`/`STATE_UPDATE` and an intel-gating decision (should you always
  see it, or unlock it like other enemy intel?). That's a game-design + server
  change, not a UI one. **Not in this plan.**
- **Pact start / finish.** Pacts have no runtime behavior (per
  [types.ts](../../shared/src/types.ts): "Pacts have no behavior yet"). There is
  no start/finish event to hook. Revisit when pacts gain a lifecycle.
- **Battery full.** Derivable client-side from `meta.hlCharge >= maxCharge`, but
  **skipped this plan** by decision — the battery bar already communicates fullness,
  so a toast risks being noise. Trivially addable later: an edge-detect + latch in
  [battery-bar.ts](../../client/src/ui/panels/battery-bar.ts) calling
  `spawnToast('🔋 Battery full', 'warning')`. No infrastructure blocks it.

Leaving hooks/stubs for these now would be speculative "in case we need it" work.
The `spawnToast` primitive is all that a future pact/incoming-attack feature
needs from the UI side; those features add their own triggers when they exist.

---

## Files touched

| File                         | Change                                                                                                                               |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `client/src/ui/vfx/index.ts` | Add `spawnToast` + `ToastVariant` (4 variants, icon, soft cap); remove `spawnAttackToast`.                                           |
| `client/src/ui/playing.ts`   | Render `#toast-layer` overlay (aria-live) beside the panel container.                                                                |
| `client/src/game.ts`         | `showAttackEvents` calls `spawnToast` (outgoing→success, incoming→danger).                                                           |
| `client/src/style.css`       | Add `--info`/`--warning` vars; new `.toast-layer` (pointer-events: none) / `.toast` / `.toast--*` styles; drop `.vfx-attack-toast*`. |

No `shared/` or `server/` changes — everything here is client-side rendering of
data that already arrives. No `battery-bar.ts` change (battery-full deferred).

## Data / type changes

- New client type `ToastVariant` (client-only). **No wire or shared-type
  changes.** The deferred triggers (§3) would add wire fields when built; this
  plan doesn't.
- **Two new CSS custom properties** `--info` (blue) and `--warning` (orange).
  `--success` (`#4ade80`) and `--danger` (`#f87171`) already exist and are
  reused; `--gold` is left untouched. Pick `--info` ≈ `--accent`'s blue family
  and `--warning` ≈ an orange between `--gold` and `--danger`.

## Complexity check

- **One new abstraction:** `spawnToast`. Justified — it replaces the narrower
  `spawnAttackToast` and is the single seam every future notification uses.
  Net primitive count is unchanged (one in, one out).
- **New DOM element** `#toast-layer`: one empty div in the play screen. Cheap,
  and it's what makes "in front of the panel container" true without per-spawn
  geometry math.
- **Two idle variants** (`info`, `warning`) with no live trigger yet: justified
  by the user's explicit 4-variant request and the near-zero cost (two vars, two
  enum members). Reassess if they're still unused after pacts land.
- **Soft cap:** one constant + an oldest-eviction check in `spawnToast`. No queue.
- **Deliberately NOT built:** battery-full trigger, wire fields for
  incoming-attack warning, pact lifecycle events, toast history, dedupe,
  per-toast duration config. Add when a concrete need appears.

## Test strategy

- **Unit ([client/tests](../../client/tests)):** `spawnToast` creates a toast
  with the right variant class and text under the jsdom setup (mirror existing
  VFX tests). Assert the stack container is reused across calls and the element
  is removed on animation finish (existing tests fake WAAPI — follow their
  pattern).
- **Soft cap:** spawn 5 toasts, assert at most 4 remain in the stack and the
  oldest was evicted.
- **Attack migration:** update the existing attack-toast expectations to the new
  class names/variants (`.toast--success` / `.toast--danger`).
- **E2E:** the existing attack-strike e2e (`server/tests/match.test.ts` drives
  the events; e2e asserts the toast) — update selectors from `.vfx-attack-toast`
  to `.toast`. Add a light assertion that a toast appears over `#panel-container`.
- Run `pnpm --filter @game/client test` while iterating; full `pnpm build` +
  suites once before calling it done.

## Decisions (resolved)

1. **Colour palette** → add `--info` and `--warning` theme vars; reuse existing
   `--success` / `--danger`; **don't** repurpose `--gold`.
2. **Outgoing-attack colour** → **flip** to green `success`. `--gold` stays in the
   theme (used by 4 other call sites); only the toast stops using it.
3. **Placement** → **(A)** `#toast-layer` overlay inside the play screen.
4. **Stacking** → **soft cap of 4** visible toasts, evict oldest on overflow.
   Default duration ~2.5s (unchanged from today).
5. **Battery-full** → **skipped** this plan (deferred, see §3).

---

## Recommendation

Ship §1–§2 (the toast primitive + attack migration, with the outgoing colour
flip folded into the migration) as one small, self-contained client change. It
delivers the reusable four-variant system the user asked for and converts the two
events that actually exist today, honestly deferring the rest (pacts,
incoming-attack warning, battery-full) until their mechanics exist. The heaviest
"cost to the next dev" is the new `#toast-layer` element and two idle variants —
a fair, cheap price for correct placement and drop-in future triggers.
