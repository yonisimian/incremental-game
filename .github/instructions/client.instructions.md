---
description: 'Conventions for client/src (vanilla-TS browser UI, panels, client-side prediction, VFX). Use when editing UI, panels, networking/reconciliation, or the dev tools.'
name: 'client package conventions'
applyTo: 'client/src/**'
---

# `client/` conventions

Vanilla DOM, no framework. Depth lives in [CLAUDE.md](../../CLAUDE.md); these are the
rules that bite.

## State & networking

- **Server-authoritative, client-predicted.** [game.ts](../../client/src/game.ts) holds
  optimistic local state; [network.ts](../../client/src/network.ts) batches timestamped
  actions (~500ms) and reconciles on `STATE_UPDATE` using `ackSeq` (re-apply local
  actions with `seq > ackSeq`). Don't add UI that assumes the server echoes instantly.
- Never trust the client for scoring or the win decision — the server owns those.

## Panels

- Implement the `Panel` interface (`render` + optional `update`/`bind`) in
  `client/src/ui/panels/`, then place it via `configurePanels` in the 5×2 tab grid
  (driven per-mode by [ui/mode-ui.ts](../../client/src/ui/mode-ui.ts)).
- To gate a tab behind an upgrade, the panel's stable `id` **must** match the `panel`
  field of a `panelUnlock` effect, or it never unlocks (or unlocks unconditionally).
  Unlocks are monotonic (locked → unlocked, never back).
- Derive panels/hotkeys/cards from the `ModeDefinition`; don't hard-code mode specifics.

## Build

- **Bundle-size budget** (custom Vite plugin): warns at 60 kB, fails at 80 kB raw.
  Keep additions lean; prefer reusing existing utilities over new deps.
- ESM with explicit `.js` import extensions, same as `shared/`.
- Lint (non-test): `eqeqeq`, `prefer-template`, `no-floating-promises`, `no-console`.
