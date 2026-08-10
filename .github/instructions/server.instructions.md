---
description: 'Conventions for server/src (authoritative WebSocket game server, matchmaking, match loop, anti-cheat). Use when editing server networking, the match tick, validation, or the bot.'
name: 'server package conventions'
applyTo: 'server/src/**'
---

# `server/` conventions

The server is the single source of truth: it owns all game state, the round timer, and
the win decision. Depth lives in [CLAUDE.md](../../CLAUDE.md); these are the rules that
bite.

## Authority & flow

- Clients are optimistic; the server is authoritative. Validate every client action —
  never trust client-reported score, resources, or timing.
- Flow: [main.ts](../../server/src/main.ts) (HTTP health + WS) →
  [matchmaking.ts](../../server/src/matchmaking.ts) (queue + rooms + TTL) →
  [match.ts](../../server/src/match.ts) (countdown/tick/scoring) →
  [validation.ts](../../server/src/validation.ts) (anti-cheat). Bot: `bot.ts`.
- Wire message types live in [shared/src/messages.ts](../../shared/src/messages.ts) —
  change the type there, not ad hoc per side.

## Build

- Imports resolve `@game/shared` from `shared/dist/`; rebuild shared after editing it
  (see the shared conventions) or you'll run against stale logic.
- ESM with explicit `.js` import extensions.
- Lint (non-test): `eqeqeq`, `prefer-template`, `no-floating-promises`, `no-console`.
- `COUNTDOWN_SEC` in [shared/src/game-config.ts](../../shared/src/game-config.ts) is
  temporarily `0` for dev; restore to `3` before publishing.
