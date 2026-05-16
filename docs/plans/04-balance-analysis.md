# PLAN: Dev Panel — Balance Analysis

## Commit Goal

Add a `/dev.html` page that runs idler simulations in-browser, renders
interactive charts (score, income, resources over time), and lets the user
export results as CSV. Zero impact on the main game bundle.

---

## Architecture

### Entry point: separate Vite page

```text
client/
  index.html          → /           (game — unchanged)
  dev.html            → /dev.html   (dev panel — new)
  src/
    main.ts            (game entry — unchanged)
    dev/
      main.ts          (dev panel entry)
      strategies.ts    (idler strategy definitions, ported from scripts/)
      simulate.ts      (simulation engine — runs in browser)
      chart.ts         (uPlot wrapper — render time-series)
      ui.ts            (DOM: controls, strategy checkboxes, chart containers)
      dev.css          (minimal styling for the panel)
```

Vite config adds a second `input` entry — Rollup builds two independent
bundles. The game bundle is byte-identical to today.

### Dependencies

- **uPlot** (`pnpm --filter client add uplot`) — ~35KB, canvas-based,
  zoom/pan/hover/tooltips. Dev-only (only referenced from `dev/`).
  Vite tree-shakes it out of the game bundle since `index.html` never
  imports it.

### What imports what

```text
dev/main.ts
  ├── dev/ui.ts              (DOM setup, event wiring)
  ├── dev/strategies.ts      (strategy definitions)
  ├── dev/simulate.ts        (tick loop, uses @game/shared)
  │     └── @game/shared     (createInitialState, collectModifiers,
  │                           applyPassiveTick, applyPurchase,
  │                           computePassiveRates, getModeDefinition,
  │                           TICK_INTERVAL_MS)
  └── dev/chart.ts           (uPlot wrapper)
        └── uplot
```

---

## File-by-File Plan

### 1. `client/vite.config.ts` (~8 lines)

Add multi-page input:

```typescript
import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        dev: resolve(__dirname, 'dev.html'),
      },
    },
  },
})
```

### 2. `client/dev.html` (~15 lines)

Minimal HTML shell:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>incremenTal — Dev Panel</title>
  </head>
  <body>
    <div id="dev-app"></div>
    <script type="module" src="/src/dev/main.ts"></script>
  </body>
</html>
```

### 3. `client/src/dev/strategies.ts` (~80 lines)

Port the strategy definitions from `scripts/simulate-idler.ts`:

```typescript
export interface StrategyAction {
  type: 'buy' | 'set_highlight'
  upgradeId?: string
  highlight?: string
}

export interface Strategy {
  name: string
  actions: StrategyAction[]
}

const buy = (id: string): StrategyAction => ({ type: 'buy', upgradeId: id })
const hl = (h: string): StrategyAction => ({ type: 'set_highlight', highlight: h })

export const IDLER_STRATEGIES: Strategy[] = [
  { name: 'No upgrades', actions: [hl('wood')] },
  { name: 'SA only', actions: [hl('wood'), buy('sharpened-axes')] },
  // ... same list as scripts/simulate-idler.ts
]
```

### 4. `client/src/dev/simulate.ts` (~80 lines)

Core simulation engine. Port from `scripts/simulate-idler.ts`, but returns
per-tick snapshots instead of a final summary:

```typescript
export interface TickSnapshot {
  tick: number
  timeSec: number
  score: number
  resources: Record<string, number>      // { r0: ..., r1: ... }
  incomePerSec: Record<string, number>   // computed from modifiers
  event: string                          // "buy:sharpened-axes" or ""
}

export interface SimResult {
  name: string
  snapshots: TickSnapshot[]
  finalScore: number
  purchaseLog: { id: string; timeSec: number }[]
}

export function simulate(strategy: Strategy, mode: GameMode): SimResult { ... }
```

The tick loop is identical to the current `simulate()` function in
`scripts/simulate-idler.ts`, but adds a `snapshots.push(...)` call
after each tick. Income rates are computed via `computePassiveRates()`
which already exists in `@game/shared`.

### 5. `client/src/dev/chart.ts` (~40 lines)

Thin wrapper around uPlot. Exposes one function:

```typescript
export function renderChart(
  container: HTMLElement,
  title: string,
  series: { label: string; data: number[] }[],
  xData: number[], // time_sec values
  xLabel?: string,
): void
```

Creates a uPlot instance with standard options (legend, zoom, tooltips).
Destroys previous chart in `container` before rendering a new one.

### 6. `client/src/dev/ui.ts` (~100 lines)

Builds the DOM and wires events:

**Layout:**

```text
┌──────────────────────────────────────────────┐
│  incremenTal — Dev Panel                     │
├──────────────────────────────────────────────┤
│  Mode: [Idler ▾]     [▶ Run]  [📥 CSV]      │
├──────────────────────────────────────────────┤
│  Strategies:                                 │
│  ☑ No upgrades    ☑ SA only    ☑ HL only     │
│  ☑ SA→HL          ☑ HL→SA     ☑ RB→MC×1→... │
│  ...                                         │
├──────────────────────────────────────────────┤
│  ┌─────────── Score ──────────────┐          │
│  │  (uPlot chart)                 │          │
│  └────────────────────────────────┘          │
│  ┌──────── Income/sec ────────────┐          │
│  │  (uPlot chart)                 │          │
│  └────────────────────────────────┘          │
│  ┌──────── Resources ─────────────┐          │
│  │  (uPlot chart)                 │          │
│  └────────────────────────────────┘          │
├──────────────────────────────────────────────┤
│  Summary table (same as console output)      │
│  Strategy | Score | % Best | Purchase log    │
└──────────────────────────────────────────────┘
```

**Logic:**

- On "Run": call `simulate()` for each checked strategy, call `renderChart()`
  3 times (score, income, resources), populate summary table.
- On "CSV": generate CSV string from snapshots, trigger download via
  `Blob` + `URL.createObjectURL` + hidden `<a>`.
- Mode selector: currently only "idler" is enabled. Clicker is a greyed-out
  option (future commit).

### 7. `client/src/dev/main.ts` (~10 lines)

```typescript
import './dev.css'
import { initDevPanel } from './ui.js'
initDevPanel(document.getElementById('dev-app')!)
```

### 8. `client/src/dev/dev.css` (~50 lines)

Minimal styling: dark background, flex layout for charts, basic form controls.
Does NOT import the game's `style.css` — fully independent.

---

## CSV Export Format

Download produces one CSV per strategy (or a combined multi-sheet approach).
Simplest: one CSV with a `strategy` column, all strategies concatenated:

```csv
strategy,tick,time_sec,score,r0,r1,income_r0,income_r1,event
No upgrades,0,0.25,0.25,1.25,1.25,1.00,1.00,
No upgrades,1,0.50,0.50,2.50,2.50,1.00,1.00,
SA only,0,0.25,0.25,1.25,1.25,1.00,1.00,
...
```

This is the most useful format for pandas/spreadsheets — filter by strategy
column to compare.

---

## Chart Details

### Purchase timing markers

All 3 charts draw vertical dashed lines (or dots) at tick positions where an
upgrade was purchased. Label = upgrade abbreviation (SA, HL, etc.). Without
these, inflection points in the curves are unexplainable.

Implemented via uPlot `drawAxes` hook — iterate `purchaseLog`, draw vertical
lines at the corresponding x positions.

### Legend & series toggling

uPlot supports legend clicks to toggle series visibility. With 12 strategies
overlaid, this is essential for readability. Each series gets a distinct color
from a palette. The legend is always visible below each chart.

---

## Cleanup

This commit **deletes `scripts/simulate-idler.ts`** and removes the
`sim:idler` script from `package.json`. The dev panel fully replaces the CLI
simulator. Keeping both would create two copies of the simulation logic that
drift apart when mechanics change.

---

## What This Commit Does NOT Include

- Clicker simulation (needs click-rate parameter + generator buy strategies)
- Constants editing (costs, durations, rates) — commit 3
- Import/export of constant presets — commit 3
- Auth/login — deferred indefinitely

---

## Future: Constants Editing (Commit 3 Architecture Notes)

### Level 1 — Simulation-only ("what if" analysis)

The dev panel deep-clones the `ModeDefinition`, lets the user edit fields
(upgrade costs, generator rates, round duration, etc.) via input controls,
and runs simulations with the modified clone. The live game is unaffected.

When the user finds numbers they like, they can export the modified constants
as a JSON preset and import it later to resume tuning.

> Note: `ModeDefinition` is deeply `readonly`. The constants editor will
> need to `structuredClone()` and cast to mutable before modifying fields.

### Level 2 — Live game testing (future, optional)

Both `/` and `/dev.html` share the same `localStorage` domain.

- The dev panel writes overrides:
  `localStorage.setItem('dev:overrides', JSON.stringify(patch))`
- The game's `getModeDefinition()` checks on startup:
  `const raw = localStorage.getItem('dev:overrides')` → apply patch if present
- The game shows a small banner: "⚠️ Dev overrides active" so players/devs
  don't forget they're running with modified constants
- A "Clear overrides" button in both the dev panel and the game banner

This requires no coupling between the two bundles — just a shared key in
`localStorage`. The game bundle gains ~5 lines (read + banner), not a full
constants editor UI.

---

## Strategy Maintenance Note

Strategy definitions are hand-written and mode-specific. Every time an
upgrade is added/renamed, `strategies.ts` must be updated manually. This
is fine for 6 upgrades / 12 strategies but won't scale to 20+. A future
enhancement could be a strategy _builder_ in the dev panel UI, but that's
not this commit.

---

## Estimated Scope

| File                        | Lines                           |
| --------------------------- | ------------------------------- |
| `vite.config.ts`            | ~8                              |
| `dev.html`                  | ~15                             |
| `dev/main.ts`               | ~10                             |
| `dev/strategies.ts`         | ~80                             |
| `dev/simulate.ts`           | ~80                             |
| `dev/chart.ts`              | ~50 (includes purchase markers) |
| `dev/ui.ts`                 | ~100                            |
| `dev/dev.css`               | ~50                             |
| **Total new**               | **~390 lines**                  |
| `scripts/simulate-idler.ts` | **deleted (~310 lines)**        |
| `package.json`              | remove `sim:idler` script       |

Net: ~+80 lines, plus a new uPlot dependency (dev-panel only).

---

## Steps

- [ ] Install uPlot
- [ ] Update `vite.config.ts` for multi-page build
- [ ] Create `dev.html`
- [ ] Create `dev/strategies.ts` (port strategy definitions)
- [ ] Create `dev/simulate.ts` (port + enhance simulation engine)
- [ ] Create `dev/chart.ts` (uPlot wrapper + purchase markers)
- [ ] Create `dev/ui.ts` (DOM + event wiring + CSV export)
- [ ] Create `dev/main.ts` + `dev/dev.css`
- [ ] Delete `scripts/simulate-idler.ts` + remove `sim:idler` from package.json
- [ ] Verify: `pnpm dev` → open `/dev.html` → run simulation → see charts
- [ ] Verify: main game bundle unchanged (no uPlot in game build)
- [ ] Commit
