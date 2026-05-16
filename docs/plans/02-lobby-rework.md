# PLAN: Lobby & Matchmaking Rework

> **Status:** Proposal — not yet implemented.
> **Date:** 2026-05-03

## 1. Motivation

The current menu shows 2 mode buttons × 3 goal buttons = 6 implicit "waiting
rooms" (matchmaking queues). As we add more modes, goals, and player-count
formats (`1v1`, `group vs group`, `survival`), the combinatorial explosion
makes the flat button grid untenable — both for UX and for server queue
fragmentation (many near-empty queues → long wait times).

## 2. Proposed Design

Replace the current `MODE_SELECT → queue` flow with two lobby entry points:

### 2.1 Quick Match

- **Client:** single "Quick Match" button on the main menu.
- **Server:** one unified quick-match queue (no mode/goal key).
  - If the queue already has a player → pair immediately.
  - If empty → enqueue the player.
  - Settings (random mode + random goal from that mode) are rolled **at
    pairing time**, not at enqueue time.
- Settings are revealed to both players in `ROUND_START`.
- The waiting screen includes a **"Play against Bot"** button (same as
  today). On `BOT_REQUEST`, the server removes the player from the quick
  queue and starts a bot match with freshly rolled random settings.

### 2.2 Create Room

- **Client:** "Create Room" button → enters a **room lobby** screen.
- **Server:** creates a `Room` object with a unique 6-character alphanumeric
  **room code** (e.g., `A3K9F2`), subject to the global **room limit**
  (`MAX_ROOMS = 20`). If the limit is reached, the server replies with
  `ROOM_ERROR { reason: 'room_limit' }` and the client stays in the lobby.
- **Default settings:** Idler + Race To Buy. TODO: randomize default
  settings in the future.
- The creator sees:
  - The room code and a **copy-link** button (URL like
    `https://example.com/?room=A3K9F2`) as well as a **share** button.
  - Buttons to change **game mode** and **game goal**.
  - Player list (1/2 slots filled).
  - A "Play against Bot" button (same as today).
- A second player joins via the link (or by entering the code manually in a
  "Join Room" input on the menu).
- **Auto-start:** the match begins automatically as soon as 2 players are
  present. No "Start" button for now — we add one later when rooms can hold
  \> 2.

### 2.3 Join Room (via URL or code)

- On page load, the client checks `URLSearchParams` for a `room` query param.
- If present → send a `ROOM_JOIN` message with the code after WebSocket
  connects.
- If the room exists and isn't full → join it.
- If the room is full → server sends `ROOM_ERROR { reason: 'full' }`.
- If the room doesn't exist → server sends `ROOM_ERROR { reason: 'not_found' }`.
- Errors are shown as a toast/banner on the lobby screen; the player stays in
  the lobby.

## 3. New & Changed Messages

### 3.1 Client → Server

| Message       | Fields                         | Purpose                                                                                                             |
| ------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `QUICK_MATCH` | `name: string`                 | Enter the quick-match queue                                                                                         |
| `ROOM_CREATE` | `name: string`                 | Create a new room (creator becomes player 1)                                                                        |
| `ROOM_JOIN`   | `code: string, name: string`   | Join an existing room by code                                                                                       |
| `ROOM_UPDATE` | `mode?: GameMode, goal?: Goal` | Creator changes room settings (server verifies sender is `room.creatorId`; validates mode/goal same as `parseGoal`) |
| `BOT_REQUEST` | _(unchanged)_                  | Request bot while in room (creator only)                                                                            |
| `QUIT`        | _(unchanged)_                  | Leave room / cancel quick-match queue / quit match                                                                  |

### 3.2 Server → Client

| Message              | Fields                                                               | Purpose                                                                                             |
| -------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `ROOM_CREATED`       | `code: string, settings: {mode, goal}, players: string[]`            | Confirms room creation, provides the code and initial player list                                   |
| `ROOM_JOINED`        | `code: string, settings: {mode, goal}, players: string[]`            | Confirms join, provides current state (`players` = display names, not IDs)                          |
| `ROOM_UPDATED`       | `settings: {mode, goal}`                                             | Broadcast updated settings to the joiner                                                            |
| `ROOM_PLAYER_JOINED` | `name: string`                                                       | Notify creator that someone joined                                                                  |
| `ROOM_PLAYER_LEFT`   | `promoted: boolean`                                                  | Notify remaining player that the other left; `promoted: true` if they are now the room creator      |
| `ROOM_CLOSED`        | `reason: 'expired'`                                                  | Room was destroyed (e.g., TTL expiry); player is returned to the lobby                              |
| `ROOM_ERROR`         | `reason: 'full' \| 'not_found' \| 'already_in_room' \| 'room_limit'` | Reject a join/create (client shows spinner while `ROOM_JOIN` is in flight, cleared on any response) |
| `ROUND_START`        | _(unchanged)_                                                        | Match begins                                                                                        |

### 3.3 Removed Messages

| Message       | Replacement                                            |
| ------------- | ------------------------------------------------------ |
| `MODE_SELECT` | Split into `QUICK_MATCH` + `ROOM_CREATE` + `ROOM_JOIN` |

## 4. Server-Side Data Model

```text
┌──────────────┐
│  quickQueue  │  Single array of QueuedPlayer (mode/goal chosen by server)
└──────────────┘

┌───────────────────────────────────────┐
│  rooms: Map<code, Room>               │
│                                       │
│  Room {                               │
│    code: string           (6-char)    │
│    creatorId: string                  │
│    players: QueuedPlayer[]  (max 2)   │
│    mode: GameMode                     │
│    goal: Goal                         │
│    createdAt: number      (Date.now)  │
│    ttlTimer: ReturnType<setTimeout>   │
│  }                                    │
└───────────────────────────────────────┘

┌────────────────────────────────────────┐
│  playerRooms: Map<playerId, code>     │  reverse lookup: player → room
└────────────────────────────────────────┘
```

### 4.1 `matchmaking.ts` changes

- Delete the per-mode+goal `queues` map.
- Add `quickQueue: QueuedPlayer[]` — a single FIFO queue. `QueuedPlayer`
  includes `{id, ws, name}`, so the queue itself serves as the single
  source of truth for queued players (no separate lookup map in `main.ts`).
  Export a `getQueuedPlayer(id)` helper for bot-request lookup.
- Add `rooms: Map<string, Room>` and `playerRooms: Map<string, string>`.
- The existing `queuedPlayers` map in `main.ts` is **removed** — its role is
  absorbed by `quickQueue` (via `getQueuedPlayer`) and `playerRooms`.
- Export: `addToQuickQueue`, `removeFromQuickQueue`, `getQueuedPlayer`,
  `createRoom`, `joinRoom`, `leaveRoom`, `updateRoomSettings`,
  `removeFromAll`, `getRoomCount`.

## 5. Client-Side Screens

| Screen      | What it shows                                                                                     |
| ----------- | ------------------------------------------------------------------------------------------------- |
| `lobby`     | Name input, "Quick Match" button, "Create Room" button, "Join Room" code input                    |
| `room`      | **(new)** Room code, copy-link, mode/goal pickers (creator only), player list, cancel, bot button |
| `waiting`   | "Looking for opponent…" (quick-match only; unchanged)                                             |
| `countdown` | 3-2-1 (unchanged)                                                                                 |
| `playing`   | Game (unchanged)                                                                                  |
| `ended`     | Results (unchanged)                                                                               |

### 5.1 URL Handling

- On connect, `main.ts` reads `new URLSearchParams(location.search).get('room')`
  and stores it in a local variable.
- If a code is present → auto-send `ROOM_JOIN` after WebSocket opens.
  The `?room=` param is read on page load and **preserved across the waking
  screen**; it is cleared from the URL (via `history.replaceState`) only
  **after** `ROOM_JOIN` is sent, not before.
- The copy-link button constructs `${location.origin}?room=${code}`.

## 6. Room Code Generation

```ts
function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no I/O/0/1 (ambiguity)
  let code = ''
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)]
  }
  return code
}
```

- 30^6 ≈ 729 million possible codes — collision is negligible at our scale.
- Still, `createRoom` should retry if `rooms.has(code)`.
- The server should **uppercase** the code received in `ROOM_JOIN` before
  lookup (`code = code.toUpperCase()`) to avoid case-sensitivity issues
  when users type codes manually.

## 7. Migration & Backward Compatibility

The old `MODE_SELECT` message no longer exists. Both client and server must
be deployed in sync:

- All phases (1–3) should be developed on a **feature branch** and deployed
  **atomically** — the app is broken if only the server or only the client
  is updated.
- The server should reject unknown message types silently (it already does).
- No database or persistence is involved, so there's no data migration.

> **Note:** Rooms are **single-use** — when a match starts, the room is
> consumed and removed from the map. After the match ends, both players
> return to the lobby (not back to the room). "Rematch" functionality
> would require re-creating a room post-match (future work).

## 8. Pitfalls, Bugs & Edge Cases

### 8.1 Room Leaks (stale rooms)

**Risk:** A player creates a room, then closes the tab without sending `QUIT`.
The room stays in memory forever.

**Mitigation:**

- The existing `ws.on('close')` handler already calls cleanup. Wire it to
  `leaveRoom(playerId)` which destroys the room if empty.
- **Room TTL** (`ROOM_TTL_MS`, e.g., 10 minutes) — applies to **non-full**
  rooms only:
  - Timer starts on room creation.
  - If the room becomes full (2 players) → cancel the timer.
  - If a player leaves (room becomes non-full again) → restart the timer.
  - When the timer fires → destroy the room, send `ROOM_CLOSED { reason:
'expired' }` to the remaining player, and return them to the lobby.
  - When a match starts → cancel the timer (room is consumed).
  - **Every** code path that removes a room (`leaveRoom`, match start, TTL
    expiry) must call `clearTimeout(room.ttlTimer)` before deleting from
    the map to avoid dangling callbacks.
- TODO: Before closing, send a "room closing soon" warning message to the
  creator so they can press "keep open" to reset the timer.

### 8.2 Creator Leaves, Joiner Stays

**Scenario:** Creator leaves the room after a second player joined.

**Decision:** The joiner becomes the new creator (inherits settings control).

### 8.3 Race Condition: Two Players Join Simultaneously

**Scenario:** Room has 1 slot. Two `ROOM_JOIN` messages arrive on the same
tick.

**Mitigation:** `joinRoom()` must check `room.players.length < 2` **inside**
the function (not beforehand). Node.js is single-threaded, so a synchronous
check-then-push is safe. The second joiner gets `ROOM_FULL`.

When `joinRoom()` makes the room full (2 players), it must **atomically
delete the room from the map** and return the match-ready pair. This
prevents any `ROOM_UPDATE` from sneaking in between "room full" and
"match created". The caller in `main.ts` then creates the `Match`.
The creator is always **player 1** (index 0) for consistency.

### 8.4 Settings Change After Joiner Arrives

**Scenario:** Creator changes mode after the second player has already read
the old mode name on screen.

**Mitigation:** Server validates that the sender is `room.creatorId`,
validates the incoming `mode`/`goal` with the same logic as `parseGoal()`
(reject unknown modes, reject goals not predefined for the mode), and
broadcasts `ROOM_UPDATED` to all room members on every settings change.

When `mode` changes, the server checks whether the current `goal.type` is
available in the new mode's goal list. If it is → keep the current goal.
If not → reset to `getDefaultGoal(newMode)`. The `ROOM_UPDATED` message
always carries the resolved `{mode, goal}` so the client stays in sync.

The match starts from the **server-authoritative** settings at the time of
auto-start, not whatever the client last displayed.

> **Edge case:** If `ROOM_UPDATE` and `ROOM_JOIN` arrive in the same event
> loop turn, Node.js processes them sequentially. The creator's last-second
> settings change may or may not apply before auto-start depending on
> message order. This is consistent and correct (server-authoritative), but
> the creator might be surprised. No action needed — just documenting.

### 8.5 Quick-Match Queue Fragmentation → Opposite Problem

**Risk:** Quick match uses a single queue, so two players will be paired even
if they would prefer different modes. This is the _intended trade-off_:
shorter wait times at the cost of mode preference.

**Future option:** Add a "preferred mode" field to `QUICK_MATCH`. The server
tries to honour it but falls back to any-mode after N seconds.

> **Note:** Quick-queue cleanup of stale players is handled by the existing
> heartbeat (`HEARTBEAT_INTERVAL_MS = 30 s`) + `ws.on('close')` handler,
> same as the current system. No additional TTL timer needed for the queue.

### 8.6 Room Code Brute-Force / Spam

**Risk:** A malicious client sends many `ROOM_JOIN` attempts to guess codes.

**Mitigation:**

- Rate-limit `ROOM_JOIN` (e.g., max 5 per 10 seconds per connection).
- Rate-limit `ROOM_CREATE` (e.g., max 3 per minute per connection).
- The 6-char code space (729M) makes brute force impractical at small scale.

### 8.7 Server Load: Room State Broadcasting

**Current:** No per-room broadcasting — the server only sends state during a
match (every 500ms). Rooms are nearly free: just an in-memory object with
2 entries.

**Risk area:** If we later add real-time "room lobby" features (chat, live
settings preview, spectator count), each room becomes a broadcast group. For
now, rooms only send point-in-time messages (`ROOM_CREATED`, `ROOM_JOINED`,
`ROOM_UPDATED`), so load is negligible.

### 8.8 Memory: Rooms Accumulate During Uptime

**Risk:** Each room is small (~200 bytes), but over a long uptime with many
create-then-abandon cycles, the `rooms` map could grow.

**Mitigation:** The TTL timer (§ 8.1) handles this. Also log room
create/destroy counts for monitoring.

### 8.9 Bot Request from Room

**Current:** `BOT_REQUEST` only works while in queue.
**New:** It should also work from a room. When the creator presses "Play
against Bot":

1. Remove the room from the rooms map.
2. Create a match with a bot using the room's current settings.
3. If a second player was in the room, send them `ROOM_PLAYER_LEFT` and
   return them to lobby (or: start a 2-player match and ignore the bot
   request — needs a decision).

**Recommendation:** Only allow bot requests while alone in the room. Disable
the button when 2 players are present.

### 8.10 Duplicate Connection Guard

**Current:** `queuedPlayers.has(data.id)` prevents double-queueing.
**New:** Need `playerRooms.has(data.id)` check before allowing `ROOM_CREATE`
or `ROOM_JOIN`. Also prevent a player from being in both a room and the
quick-match queue simultaneously.

### 8.11 URL `?room=` with Stale/Invalid Code

**Scenario:** Player clicks a shared link, but the room was already
destroyed.

**Mitigation:** Server replies with `ROOM_ERROR { reason: 'not_found' }`.
Client shows "Room not found — it may have expired" and drops the player into
the normal lobby. The `?room=` param is cleared from the URL immediately
after the join attempt.

### 8.12 Room Limit

**Constant:** `MAX_ROOMS = 20` in `game-config.ts`.

`createRoom()` checks `rooms.size >= MAX_ROOMS` before allocating. If at
the limit → return `ROOM_ERROR { reason: 'room_limit' }`. The client shows
"Server is busy — try again later" on the lobby screen.

### 8.13 Diagnostics Overlay (F6 panel)

The current F6 perf overlay is dev-only and client-side. Extend it into a
**diagnostics panel** available in production builds:

- Remove the `import.meta.env.DEV` guard so F6 works in production.
- Add a **server status line** showing `Active rooms: N / 20`.
- The server sends a `SERVER_STATUS` message on a fixed interval (e.g.,
  every 5 seconds) to all connected clients:

  ```ts
  interface ServerStatusMessage {
    type: 'SERVER_STATUS'
    activeRooms: number
  }
  ```

- The client stores the latest `activeRooms` value; the F6 overlay reads it.
- Interval-based (not event-driven) to avoid spammy broadcasts on rapid
  room churn. 5 seconds is cheap: one tiny JSON (~30 bytes) per client
  per 5s — including players mid-match, which is wasteful but negligible
  at our scale. Can be made opt-in later if needed.
- The `SERVER_STATUS` broadcast loop starts in `main.ts` alongside the
  heartbeat interval.

## 9. Implementation Order

| Phase | Scope                                                                                                                                              | Files touched                                                                                                                                       |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1** | Shared: new message types (update `ClientMessage` + `ServerMessage` unions), remove `ModeSelectMessage`, add `MAX_ROOMS` / `ROOM_TTL_MS` constants | `shared/src/messages.ts`, `shared/src/types.ts`, `shared/src/game-config.ts`                                                                        |
| **2** | Server: `Room` model, new matchmaking functions, `main.ts` message routing                                                                         | `server/src/matchmaking.ts`, `server/src/main.ts`                                                                                                   |
| **3** | Client: lobby screen rewrite, new room screen, URL handling                                                                                        | `client/src/ui/lobby.ts`, `client/src/ui/screens.ts`, `client/src/ui/index.ts`, `client/src/game.ts`, `client/src/network.ts`, `client/src/main.ts` |
| **4** | Tests: rewrite existing `matchmaking.test.ts` (old queue API is removed); add room lifecycle, quick-match pairing, room TTL, room limit tests      | `server/tests/matchmaking.test.ts`                                                                                                                  |
| **5** | Polish: rate limiting, room TTL, error toasts, F6 diagnostics overlay                                                                              | Across server + client, `client/src/ui/perf-overlay.ts`                                                                                             |

## 10. Out of Scope (future work)

- "Start" button (relevant when rooms support > 2 players).
- Spectator mode.
- Room browser / public room listing.
- Persistent rooms across server restarts.
- Player-count formats beyond 1v1 (group vs group, survival).
- Chat in room lobby.

## 11. Acceptance Criteria

The feature is **done** when all of the following are true:

- [ ] Quick match pairs two players within one server tick.
- [ ] Quick match → Bot request starts a bot match with random settings.
- [ ] Room create → join via code → auto-start works end-to-end.
- [ ] Room create → join via `?room=` URL → auto-start works end-to-end.
- [ ] Room settings (mode/goal) can be changed by the creator; joiner sees
      live updates.
- [ ] Bot request works from a room (creator only, while alone).
- [ ] Creator leaving promotes the joiner.
- [ ] Room TTL expires → remaining player returned to lobby with
      `ROOM_CLOSED` message.
- [ ] 21st `ROOM_CREATE` is rejected with `room_limit` error.
- [ ] Room code join is case-insensitive.
- [ ] `?room=` with stale code shows "Room not found" and lands on lobby.
- [ ] All existing tests updated; new tests cover room lifecycle,
      quick-match pairing, room TTL, room limit, settings validation.
- [ ] F6 overlay shows `Active rooms: N / 20` in production builds.
- [ ] No `MODE_SELECT` references remain in client, server, or shared code.
