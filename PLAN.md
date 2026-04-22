# Bot Opponent Feature

## Overview

Add a "Play against a bot" button to the waiting screen so players can instantly start a match against a server-side AI opponent instead of waiting for a human.

## Architecture Decision: Server-Side Bot

The bot lives **entirely on the server**. Rationale:

- The server is already authoritative — it validates clicks, purchases, and manages game state. A server-side bot plugs directly into the existing `Match` class.
- No protocol changes needed. The bot is just another "player" from the `Match` perspective — it has a `PlayerState`, receives ticks, and makes decisions.
- No cheating surface — bot actions go through the same validation as human actions.
- The client only needs one new message (`BOT_REQUEST`) and one UI button — everything else is unchanged.

## Design

### New Type: `BotPlayer`

A lightweight class/module that implements a bot strategy. It receives periodic state snapshots and returns actions (clicks, purchases, highlight switches).

```ts
// server/src/bot.ts
interface BotStrategy {
  /** Called every tick with current bot state + match context. Returns actions to execute. */
  decide(state: PlayerState, mode: GameMode, tickSec: number): PlayerAction[]
}
```

### How It Integrates with `Match`

Currently, `Match` expects two `QueuedPlayer` objects: `{ id, ws }`. The bot won't have a real WebSocket.

**Approach: Bot-aware Match** — Extend `Match` to accept an optional bot strategy for player 2. When broadcasting state, skip the bot's socket. On each tick, call `bot.decide()` and apply actions through the same validation pipeline (`isValidPurchase`, `isValidClick`). No fake sockets needed, and the bot's decision cycle is tied to the tick loop (deterministic timing).

### Message Flow

```
Client                      Server
  │                           │
  ├─ MODE_SELECT ───────────► │   (enters queue as normal)
  │                           │
  │  [waiting screen shows    │
  │   "Play against bot" btn] │
  │                           │
  ├─ BOT_REQUEST ───────────► │   (new message type)
  │                           │   removeFromQueue(player)
  │                           │   create Match with bot player
  │                           │   match.start()
  │                           │
  │ ◄──── ROUND_START ────── │
  │  (normal match flow)      │
```

### Bot Strategies (per mode)

**Clicker bot:**

- Clicks at a randomized rate (~8–12 CPS per tick, varied slightly to feel human-ish)
- Buys cheapest affordable upgrade when available

**Idler bot:**

- Follows a fixed upgrade order (e.g., TR×2 → SA → LM — one of the strong strategies from the sim)
- Switches highlight between ale/wood as needed for the next target upgrade

### Files to Change

| File                       | Change                                                                                          |
| -------------------------- | ----------------------------------------------------------------------------------------------- |
| `shared/src/messages.ts`   | Add `BOT_REQUEST` to `ClientMessage` union                                                      |
| `server/src/bot.ts`        | **New** — `BotPlayer` class with `decide()` per mode                                            |
| `server/src/match.ts`      | Accept optional bot for player 2; call `bot.decide()` in tick loop; skip ws.send for bot player |
| `server/src/main.ts`       | Handle `BOT_REQUEST`: remove from queue, create Match with bot, register in `playerMatches`     |
| `client/src/ui/screens.ts` | Add "Play against bot" button to waiting screen                                                 |
| `client/src/game.ts`       | Add `requestBot()` function that sends `BOT_REQUEST`                                            |
| `client/src/ui/hotkeys.ts` | _(optional)_ Add `B` hotkey for bot request while waiting                                       |

### What Stays Unchanged

- `Match` game loop, scoring, timing, validation — all reused as-is
- `STATE_UPDATE` / `ROUND_END` messages — client doesn't know it's playing a bot
- Client game state machine — transitions are identical
- Matchmaking queue logic — bot request simply pulls the player out of the queue

### Edge Cases

- **Bot request while already matched**: Server ignores (player is no longer in queue)
- **Disconnect during bot match**: Same forfeit logic as human matches
- **Bot difficulty**: Start with a single "medium" difficulty; parameterize later if needed
- **Bot names**: The client currently shows "You" vs "Opponent" — no name changes needed

## Decisions

1. **Bot randomization**: Slight randomization (e.g., 8–12 CPS for clicker bot) to feel more natural.
2. **End screen**: No indication the opponent was a bot — keep the UI as-is.
3. **Entry point**: The bot button only appears while waiting in the queue (no lobby changes). This encourages players to try matchmaking first.
