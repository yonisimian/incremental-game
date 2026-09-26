# Cleanup log

Read this before scanning. Keep it short: git and the PRs hold the details.

## Standing rejections

Checked and rejected. Don't re-propose them without new evidence.

- **Merging the unlock effects** (panel, generator, attack, pact, system,
  enemy-data) **or the steal effects** into parameterized ones. The gates
  already share `gateIndex`, and each seed file is about 6 lines of logic.
  Merging would change the JSON schema and blur real differences:
  default-open vs. default-hidden gates, and integer generator counts.
- **Merging the two `formatRate`s** (`data-panel.ts`, `playing.ts`). The data
  panel's version is deliberately fixed at 1 decimal.
- **`renderSection` ×3** (attack, data and relations panels). They diverged on
  purpose: collapsible vs. plain sections.
- **Merging the bot and the simulator.** The bot is real-time and tick-based;
  the simulator is timeline-free.
- **`statusBroadcast` in `main.ts`** stays hand-rolled so it stringifies once
  for all clients.
- **False leads, don't re-check:**
  - `.mode-chip` and `.goal-chip` already share their rules.
  - `RoundStats` has about 10 call sites.
  - `.ed-effect-check` is in use.
- **Comments to keep:**
  - The tree codec's V1→V4 migration docs.
  - The settings `LEGACY MIGRATION` block, which is real code.
  - Rationale comments of the form "instead of…" / "rather than…".

## Backlog (unverified leads for the next run; replace, don't append)

- **Dev editor views clone each other** (jscpd): `attacks` ↔ `pacts` (5
  blocks), with `resources` as the base for `pacts`, `envelopes` and `attacks`.
  Also `resourceSelect` in `attacks` and `generators`, `cell` in `envelopes`
  and `resources`, and a second `field` in `envelopes.ts` with a different
  class. This is likely a missing shared row/card builder, the biggest lead.
- **`escapeHtml` defined 4 times**: `ui/helpers.ts`, `dev/editor/canvas.ts`,
  `dev/queue-envelope.ts`, `dev/queue-sim.ts`. Separately, a jscpd block is
  shared between `queue-envelope.ts` ≈L177 and `queue-sim.ts` ≈L887.
- **`renderLocked` 3 times**: attack, espionage and relations panels.
- **`targetLabel` twice, with divergent output**: the data panel shows `🪵`,
  the relations panel `🪵 production`.
- **`components.ts` ≈L164 ↔ `upgrade-detail.ts` ≈L57** (jscpd).
- **`computeClickIncome`** in both `client/src/game.ts` and
  `shared/src/modifiers/pipeline.ts`: does the client re-implement it?
- **Bot click-window pruning** in `match.ts` ≈L529 duplicates `isValidClick`'s.
- **CSS selectors declared twice in the same file**:
  - `dev.css`: `.ed-gen-root`, `.q-form > select`
  - `style.css`: `.upgrade-detail-cancel`, `.vfx-shockwave-text`
- **`UpgradePrerequisites = PrerequisiteExpression`** looks like a leftover
  alias.
- **Owner decisions** (report only): `COUNTDOWN_SEC = 0`, the disconnect grace
  period TODO in `match.ts`, and the TODO in `lint-css.ts`.

## History

- **2026-09, PR #155.** Main changes:
  - One modal shell.
  - One held-effect walker, which fixed the mode-level `generatorCost` bug.
  - Typed server sends.
  - Shared editor DOM helpers and a single dev-tab style.
  - Ghost-comment and plan-ID scrub.

  Two latent bugs were fixed, and the second review pass found two more.
