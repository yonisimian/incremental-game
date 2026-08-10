---
description: 'Conventions for server/src (authoritative WebSocket game server, matchmaking, match loop, anti-cheat). Use when editing server networking, the match tick, validation, or the bot.'
name: 'server package conventions'
applyTo: 'server/src/**'
---

# `server/` conventions

The server is the single source of truth: it owns all game state, the round timer, and
the win decision. Full detail: the **Networking** section of
[CLAUDE.md](../../CLAUDE.md) (the authoritative source). Reinforce at edit time:

- **Validate every client action** — never trust client-reported score, resources, or
  timing. Flow: `main.ts` → `matchmaking.ts` → `match.ts` → `validation.ts` (anti-cheat).
- **Wire types live in [shared/src/messages.ts](../../shared/src/messages.ts)** — change
  the type there, not ad hoc per side. Rebuild shared after editing it or you'll run
  against stale logic.
- `COUNTDOWN_SEC` in [game-config.ts](../../shared/src/game-config.ts) is `0` for dev;
  restore to `3` before publishing.
