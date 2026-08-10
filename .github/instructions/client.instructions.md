---
description: 'Conventions for client/src (vanilla-TS browser UI, panels, client-side prediction, VFX). Use when editing UI, panels, networking/reconciliation, or the dev tools.'
name: 'client package conventions'
applyTo: 'client/src/**'
---

# `client/` conventions

Vanilla DOM, no framework. Full detail: the **Client UI structure** and **Add a panel**
sections of [CLAUDE.md](../../CLAUDE.md) (the authoritative source). Reinforce at edit
time:

- **Server-authoritative, client-predicted.** [game.ts](../../client/src/game.ts) holds
  optimistic state; [network.ts](../../client/src/network.ts) reconciles on `STATE_UPDATE`
  via `ackSeq`. Never trust the client for scoring or the win decision.
- **Panel unlock gating:** a panel's stable `id` **must** match the `panel` field of its
  `panelUnlock` effect, or the tab never unlocks (or unlocks unconditionally).
- **Bundle-size budget** (Vite plugin): warns at 60 kB, fails at 80 kB raw — keep
  additions lean and prefer existing utilities over new deps.
