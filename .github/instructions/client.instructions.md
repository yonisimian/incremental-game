---
description: 'Conventions for client/src (vanilla-TS browser UI, panels, client-side prediction, VFX). Use when editing UI, panels, networking/reconciliation, or the dev tools.'
name: 'client package conventions'
applyTo: 'client/src/**'
---

# `client/` conventions

Vanilla DOM, no framework. Full detail: the **Client UI structure** and **Extending the
game** sections of [CLAUDE.md](../../CLAUDE.md) (the authoritative source). Reinforce at
edit time:

- **Server-authoritative, client-predicted.** [game.ts](../../client/src/game.ts) holds
  optimistic state; [network.ts](../../client/src/network.ts) reconciles on `STATE_UPDATE`.
  Never trust the client for scoring or the win decision.
- **Panel-unlock gating is easy to break:** a panel's stable `id` must match its
  `panelUnlock` effect's `panel` field, or the tab never unlocks.
- **Bundle-size budget** is enforced by a Vite plugin — keep additions lean and prefer
  existing utilities over new deps.
