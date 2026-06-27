# PLAN: Timer Correctness (split into 3 PRs)

## Goal

The current branch `feat/timer-centiseconds` (open as PR #74) bundles a feature
(centisecond readout) together with three independent timing changes. Playtesting
surfaced a new, unacceptable bug (the timer **jumps ~7s → ~5s** mid-match), which
means the bundle is not safe to merge as-is.

**Decision:** revert PR #74 to **only this plan doc**, then deliver the work as
**three independent PRs**, opened and merged **strictly one at a time** — each PR
is opened only after the previous one is merged. The four reverted commits are
preserved (see _Recoverable commits_) so PRs cherry-pick rather than rewrite.

> Guiding principle: **fix the model, not the symptom.** Each PR should leave the
> timer's state machine more correct, not paper over a visible glitch.

> Why three, not four: the "~7s → ~5s" jump only exists _because_ of the
> centiseconds work — rAF interpolation does not exist on `main`; it is introduced
> by the centiseconds commit. So the jump is a regression internal to that feature
> and its fix is **folded into the centiseconds PR**, not a standalone PR.

---

## Background: what we know (evidence, not guesses)

Three distinct problems were observed and investigated:

### A. The "stuck at 0:00" dwell (server-side, root cause proven)

The server ran **two independent clocks for the same deadline**:

- **Displayed clock** — broadcast as `endAtMs - Date.now()` every 500ms. Punctual.
- **Authoritative round end** — a separate one-shot `setTimeout(durationMs)`.

Instrumented logs from a real localhost bot match caught the failure: the
`setInterval` tick (250ms) and broadcast (500ms) timers fired **with zero gaps**,
the tick clock hit 0 at only `+59ms` past `endAtMs`, but the one-shot `setTimeout`
fired **2554ms late** (`lateBy=2554ms`). So the client correctly showed `0:00`
and then waited ~2.5s for a late `ROUND_END`.

**Conclusion:** ending the round from the already-punctual tick loop (off the same
`endAtMs` anchor) eliminates the dual-source-of-truth and bounds any residual
dwell to ≤1 tick (~250ms). Proven sufficient by the logs.

**Still unexplained:** _why_ a one-shot `setTimeout` lags seconds while
`setInterval` stays punctual under a healthy event loop. Leading suspect is the
dev runtime (`tsx watch` and/or an attached V8 inspector). Not proven — flagged
as a follow-up audit (other one-shot `setTimeout`s in the server may be exposed
to the same lag).

### B. The "~7s → ~5s" jump (client-side, suspected, NOT yet proven)

Observed twice in local play: the displayed timer skipped ~1–2 seconds mid-match,
**above** the 10s centisecond window. Critically, **`main` has no rAF
interpolation at all** — it is introduced by the centiseconds commit. So the jump
is a regression that exists _only_ once interpolation is added: above 10s the
timer used to display the raw server broadcast (server-driven, cannot skip); the
new code predicts `anchorValue - elapsed` locally for the whole match, which can
drift and then **snap** when a broadcast or a stalled `requestAnimationFrame`
frame corrects it. A 1–2s snap matches that failure mode.

**Not yet confirmed** — must be reproduced with instrumentation before fixing, to
avoid another wrong-footed assumption. Because the jump is internal to the
centiseconds feature, both the investigation and the fix live in that PR.

### C. The start-of-match swallow (client-side, dev-hack)

With `COUNTDOWN_SEC = 0` (a temporary dev setting), `startCountdown` waited a full
1000ms interval before transitioning to `playing`, swallowing the match's first
second. This is entangled with a dev-only config value, not a shipping concern.

---

## Current branch state

`feat/timer-centiseconds` (open as PR #74) contains 4 commits:

| #   | SHA       | Commit                                                                 | Concern                    |
| --- | --------- | ---------------------------------------------------------------------- | -------------------------- |
| 1   | `0f8acde` | `feat(client): show centiseconds in the timer's final 10 seconds`      | centiseconds feature       |
| 2   | `ac79ed2` | `fix(client): start match immediately when no countdown is configured` | COUNTDOWN_SEC dev-hack     |
| 3   | `c5c40fd` | `fix(client): keep timer interpolation running for the whole match`    | prime suspect for jump (B) |
| 4   | `f96ed7e` | `fix(server): end rounds from the tick loop to stop the 0:00 dwell`    | core server timing (A)     |

## Recoverable commits

Before reverting PR #74, the four commits above are preserved on an **archive tag**
(`archive/timer-centiseconds-v1`, pointing at `f96ed7e`) so no validated work is
lost. The PRs below **cherry-pick** from these SHAs rather than rewriting:

- **PR 1** ← `f96ed7e` (server tick-end). Clean, take as-is.
- **PR 2** ← `0f8acde` (centiseconds readout) + `c5c40fd` (interpolation), but the
  interpolation is **re-worked to be windowed/jump-free**, not taken verbatim.
- **PR 3** ← new work (no source commit).
- `ac79ed2` (COUNTDOWN dev-hack) is intentionally **not** shipped (see _Excluded_).

---

## The three PRs (strictly sequential — open each only after the previous merges)

### PR 1 — Server: end rounds from the tick loop

- **Source:** `f96ed7e`.
- **What:** Replace the one-shot `setTimeout` round-end with an `endAtMs` check
  inside the existing 250ms tick loop. Remove `scheduleRoundEnd` and the
  `roundTimer` field; update `pause`/`resume`/`clearTimers` accordingly.
- **Impact:** Worst-case dwell drops from ~2.5s to ≤250ms. Single source of truth
  for the deadline.
- **Tradeoffs (accepted):**
  - Round end is quantized to a tick boundary (ends at `endAtMs`..`endAtMs+250ms`).
  - Passive income/bot/target-score checks stop the instant time hits 0 (the old
    lagging timeout used to award income during its overrun) — arguably _more_
    correct.
- **Risk:** Low. Self-contained, no client coupling. Server suite (107 tests) green.
- **Dependencies:** none.
- **Order:** **First.** Independent and proven.
- **Follow-up (separate, optional):** audit other one-shot `setTimeout`s in the
  server for the same lag exposure; investigate _why_ one-shot timers lag in dev.

### PR 2 — Feature: centisecond timer readout (final 10s), jump-free

Combines the centiseconds readout with the **fix for the jump (B)** — they are the
same feature, so they ship together.

- **Source:** `0f8acde` (readout) + a re-worked version of `c5c40fd`.
- **Step 1 — investigate the jump FIRST:** reproduce with instrumentation (log
  each rendered value, `predictedTimeLeft`, the anchor, `performance.now` deltas,
  and gaps between rAF frames) to confirm the mechanism. **No fix before repro.**
- **Step 2 — windowed interpolation:** interpolate locally **only inside the
  centisecond window (<10s)**; above 10s, display the raw server `timeLeft` (the
  jump-free `main` behaviour). Above 10s `M:SS` only changes once per second, so
  frame-accurate interpolation adds drift/snap risk for zero visible benefit.
- **Step 3 — readout:** below 10s, switch `M:SS` → `S:CC` (`9:99 → 0:00`).
- **Impact:** Cosmetic tension/polish in the final 10s, **without** the mid-match
  second-skipping. Resolves the most "unacceptable" symptom.
- **Risk:** Medium until the jump mechanism is confirmed.
- **Dependencies:** PR 1 merged.
- **Order:** Second.

### PR 3 — UX: "gathering results" interstitial (deferred / lower priority)

- **What:** Add an explicit client state between `playing` and `ended` for the
  window after the local clock reaches 0:00 but before `ROUND_END` arrives. Models
  the genuinely-distinct "time up, awaiting authoritative result" state instead of
  conflating it with "playing with 0s left."
- **Primary justification — weak-signal PvP, not localhost:** with PR 1 the
  server's own contribution to the gap is ≤250ms, and on **localhost bot matches
  there is effectively no gap** (no network). The interstitial's real value is
  **real PvP over weak connections**, where the authoritative result legitimately
  takes >1s. It buys little locally — hence **lower priority / candidate to defer**
  until real-network PvP testing shows it's needed.
- **Scope — timed expiry only:** target-score and buy-upgrade goals end on a
  decisive **win event** (target reached / trophy bought); the server already
  knows the result, so there is no "awaiting result" ambiguity. The interstitial
  must apply **only to timed-goal expiry** (and the safety-cap timeout) — never
  after an instant, decisive win.
- **Behaviour requirements:**
  - **Signal-driven**, NOT a fixed-length screen: dismisses when `ROUND_END`
    actually arrives.
  - **Deferred display, not a min-visible floor:** show the interstitial **only
    if** `ROUND_END` has not arrived within a short threshold (~200ms) after local
    0:00. Good connections never see it (no latency tax on the common case); weak
    connections get the graceful state. (Contrast: a blanket min-visible floor
    would add ~350ms to _every_ match end — rejected.)
  - **Input locked at 0:00** (no further clicks counted client-side), to stay
    consistent with the server, which already stops counting at its tick-end.
  - **Naming:** use a screen-state name distinct from the existing `waiting`
    (matchmaking) state — e.g. `tallying` or `results-pending`. Verify against the
    actual `screen` union before committing.
  - **No interpolated clock assumed:** if shipped before/without PR 2's
    interpolation, trigger off the broadcast/render that would show 0:00, not an
    interpolated prediction.
- **Impact:** Turns the weak-signal gap from a broken-looking frozen `0:00` into
  intentional, professional behaviour. Industry-standard pattern.
- **Does NOT fix:** the jump (B) or the start swallow (C). Pairs with PR 1.
- **Risk:** Medium — new screen state, render path, transitions, tests.
- **Dependencies:** PR 1 merged. Independent of PR 2.
- **Order:** Third. May be **deferred** pending real-network PvP testing.

### Excluded — the COUNTDOWN_SEC=0 start swallow (`ac79ed2`)

- This is a **dev-only** workaround tied to a temporary `COUNTDOWN_SEC = 0`
  setting. Do **not** ship it inside a timer-correctness PR. Keep it as a local
  dev patch, or address properly when the countdown is restored to 3 before
  publishing (see the TODO already documented on `COUNTDOWN_SEC` in
  `shared/src/game-config.ts`). Tracked here so it isn't lost.

---

## Recommended sequence (strictly one at a time)

1. **PR 1** (server tick-end) — proven, independent, biggest worst-case win.
   Open → review → merge.
2. **PR 2** (centiseconds, jump-free) — open **only after PR 1 merges**.
   Investigate the jump, ship windowed interpolation + the readout.
3. **PR 3** (gathering-results interstitial) — open **only after PR 2 merges**;
   may be deferred pending real-network PvP testing.

> No parallel work. Each PR is opened only after the previous one is merged, per
> the agreed workflow.

---

## Open questions

- **Root cause of one-shot `setTimeout` lag (A):** dev runtime artifact, or a real
  production risk? Needs a plain-`node` (no `tsx`, no inspector) repro to settle.
- **Jump mechanism (B):** prediction drift, rAF stall, or re-anchor snap? Decide
  only after instrumented repro (in PR 2).
- **Interstitial input policy (PR 3):** confirmed lean is "lock input at 0:00" to
  match the server — verify this is fair for all goal types (timed / target-score
  / buy-upgrade).

---

## Validation gates (every PR)

- `pnpm --filter server test` and/or `pnpm --filter client test`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm lint:exports` (knip — runs in the pre-commit hook; has bitten us before)
- `pnpm lint:css`
- `pnpm format:check`
