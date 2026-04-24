# Competitive Multiplayer Incremental Game

> Codename: incremenTal

> **Reading guide**: Sections up to "Step-by-Step" reflect the original prototype plan and are kept for historical context. The game has since grown beyond that scope — see [Systems Roadmap](#systems-roadmap) for the current forward-looking design.

## Overview

A real-time head-to-head incremental game playable on any device via the browser. Two players compete simultaneously, making strategic decisions about resource accumulation and upgrades within a shared time-limited round.

---

## Core Concept

- **Genre**: Competitive multiplayer incremental (real-time head-to-head)
- **Platform**: Web (mobile + desktop)
- **Tech**: TypeScript, WebSocket server, browser client
- **Game modes**: Clicker (manual tapping) and Idler (passive resource management with currency highlighting)
- **Session model**: Short time-limited rounds (e.g., 30s–5 minutes)

---

## Architecture

### High-Level Components

```
┌─────────────┐         WebSocket          ┌─────────────────┐
│   Client A  │ ◄──────────────────────►   │                 │
│  (Browser)  │                            │   Game Server   │
└─────────────┘                            │   (Node.js)     │
                                           │                 │
┌─────────────┐         WebSocket          │  - Matchmaking  │
│   Client B  │ ◄──────────────────────►   │  - Validation   │
│  (Browser)  │                            │  - Game State   │
└─────────────┘                            │  - Timer        │
                                           └─────────────────┘
```

### Networking Model: Client-Predicted, Server-Authoritative

1. **Client responsibilities**:
   - Render UI, handle input
   - Track local state optimistically (instant feedback on clicks/purchases)
   - Batch and send timestamped action events to server every ~500ms
   - Reconcile with server state on each server update

2. **Server responsibilities**:
   - Maintain the authoritative game state for both players
   - Validate all incoming actions:
     - Click rate within human limits (cap ~15–20 CPS)
     - Timestamps within the round window
     - Purchases are affordable and available
     - Statistical plausibility (no perfectly uniform intervals)
   - Broadcast game state snapshots to both clients at regular intervals
   - Own the round timer (clients sync to server time)
   - Determine the winner

3. **Score vs Currency**:
   - **Currency**: the spendable resource. Earned by clicking and passive income. Spent on upgrades. Goes down when you buy something.
   - **Score**: total currency ever earned (lifetime production). Never decreases. **The player with the highest score at round end wins.** This means buying upgrades never hurts your score — it only costs currency.
   - **Tiebreaker**: if both players end with the same score, the round is a **draw**. (Ties are extremely unlikely in practice — manual click timestamps and batch processing order create natural variance between players — but the UI and ROUND_END message must handle this case.)

4. **Message types**:

   ```
   Client → Server:
     ACTION_BATCH  { actions: [{ type, timestamp, payload }], seq }

   Server → Client:
     STATE_UPDATE  { tick, ackSeq, player: { score, currency, upgrades }, opponent: { score, currency, upgrades }, timeLeft }
     ROUND_START   { matchId, config, serverTime }
     ROUND_END     { winner, finalScores, stats }  // winner: 'player' | 'opponent' | 'draw'

   ackSeq: the highest client ACTION_BATCH seq the server has processed.
   The client re-applies any local actions with seq > ackSeq on top of the
   server state, preventing optimistic clicks from flickering on reconciliation.
   ```

### Why This Works for Incrementals

- Most actions are **discrete decisions** (click, buy upgrade), not physics
- No spatial state → no interpolation/extrapolation needed
- Low tick rate is fine (~2–4 Hz server updates)
- Opponent state visibility is configurable (starting with full visibility; can be reduced later for strategic depth)

---

## Game Flow

```
1. LOBBY
   └─► Player opens the app, enters matchmaking queue

2. MATCHMAKING
   └─► Server pairs two players, creates a match

3. COUNTDOWN
   └─► 3-2-1 countdown synced to server clock

4. ROUND (the core loop)
   ├─► Clicker: players tap to generate currency
   ├─► Idler: players choose which currency to highlight (wood/ale) for boosted passive income
   ├─► Both: players spend currency on upgrades that improve generation rate
   ├─► Timer counts down (server-authoritative)
   ├─► Each player sees: their own full state + opponent's full state (full visibility)
   └─► Server validates all actions in real time

5. ROUND END
   ├─► Server declares winner based on final scores
   ├─► Stats screen (clicks, CPS peak, upgrades purchased, etc.)
   └─► Option to rematch or return to lobby
```

---

## Minimal Prototype Scope (v0.0.1)

The simplest version that proves the concept:

### What's IN:

- [x] One screen: a click button + currency display + upgrades + timer + opponent state
- [x] Matchmaking: queue of 2 → start match
- [x] Round timer: configurable (30s / 60s), server-controlled
- [x] Click action: tap/click → +1 currency
- [x] 3 basic upgrades (each can be purchased once, fixed cost):
  - **Auto-Clicker** (costs 10): +1 currency per second passively (this is raw income, not a simulated click — Double Click does not affect it)
  - **Double Click** (costs 25): each manual click gives +2 instead of +1
  - **Multiplier** (costs 100): 2x all income (applies to both manual clicks and Auto-Clicker)
- [x] Score = total currency ever earned; highest score wins
- [x] Server validation of click rate + purchase validity
- [x] End screen: winner (or draw) + final scores
- [x] Idler game mode with wood/ale currencies and highlight mechanic
- [x] Bot opponent support
- [x] Visual effects (click popups, ripples, combo counter, milestone shockwave)
- [x] Keyboard hotkeys (Space to click, Tab to toggle highlight, number keys for upgrades)

### What's OUT (future):

- [ ] Accounts / persistence
- [ ] ELO / ranking
- [ ] Upgrade tree with dependencies (see [Systems Roadmap](#systems-roadmap))
- [ ] Ability cards, perks, prestige (see [Systems Roadmap](#systems-roadmap))
- [ ] Group matches
- [ ] Spectating
- [ ] Chat

---

## Upgrade Design Philosophy

The interesting competitive dimension comes from **strategic choices under time pressure**:

- **Clicker**: Do I click manually early to afford upgrades faster? Do I rush Auto-Clicker for passive income? Do I save for the Multiplier and gamble on a late-game spike?
- **Idler**: Do I rush wood upgrades for base production, or detour into ale for conversion upgrades? When do I switch highlight currencies?
- **Both**: Can I read my opponent's score trajectory and adapt?

The prototype's 3 upgrades (clicker) and 4 upgrades (idler) already produce non-trivial decision trees. The [Systems Roadmap](#systems-roadmap) expands this into a full taxonomy of upgrade systems (upgrade tree, tiers, ability cards, perks, prestige) with three effect types: generate, transmute, and sabotage.

---

## Tech Stack (Deep Dive)

### Summary

| Layer        | Technology              | Version   | Rationale                                          |
| ------------ | ----------------------- | --------- | -------------------------------------------------- |
| Language     | TypeScript              | ~5.x      | Type safety shared across client & server          |
| Client       | Vanilla TS + HTML + CSS | —         | Maximum portability, no framework overhead         |
| Client Build | Vite                    | ~6.x      | Fast dev server, native TS support, HMR            |
| Server       | Node.js                 | ≥20.19    | Same language as client, Render native runtime     |
| WebSocket    | `ws`                    | ~8.x      | Blazing fast, 22.7k★, thoroughly tested WS library |
| Pkg Manager  | pnpm                    | ~10.x     | Workspace support for monorepo shared types        |
| VCS          | Git + GitHub            | —         | Render auto-deploys from GitHub on push            |
| Deploy       | Render                  | Free tier | $0 hosting — static site + WS web service          |
| Server Dev   | `tsx`                   | latest    | TypeScript execution for Node.js (dev-only)        |

### TypeScript (~5.x)

- Both client and server are written in TypeScript
- Shared types (message schemas, game config) live in a `shared/` package
  - Both client and server import from it — single source of truth
- `strict: true` in all tsconfig files
- Compiled to ES2022 (all target environments support it)

### Vite (~6.x) — Client Build Tool

- **What it does**: Bundles the client-side TypeScript + HTML into static files for production
- **Dev server**: `vite dev` serves files at `http://localhost:5173` with hot module replacement (HMR) — changes appear instantly in the browser without refresh
- **Production build**: `vite build` produces an optimized `dist/` folder with minified JS + CSS + `index.html`, ready for static hosting
- **Why Vite over alternatives**:
  - Native TypeScript support — no separate `tsc` step during dev
  - Instant startup (uses native ES modules in dev)
  - `pnpm create vite@latest` scaffolds a vanilla-ts project in seconds
  - Already familiar from other projects (slidev, tindira, yonisimian.com)
- **Scaffold command**: `pnpm create vite@latest client -- --template vanilla-ts`
- **Requires**: Node.js ≥20.19

### `ws` (~8.x) — Server WebSocket Library

- **What it is**: The standard Node.js WebSocket implementation (22.7k GitHub stars, 188 contributors)
- **Key facts**:
  - Server-only — browser clients use the native `WebSocket` API (no extra dependency)
  - Supports ping/pong heartbeat for detecting stale connections
  - Can share an HTTP server (our server serves both the health check endpoint and WebSocket upgrades on the same port)
  - No compression needed for our use case (messages are tiny JSON objects)
- **Basic server pattern**:

  ```ts
  import { createServer } from 'http'
  import { WebSocketServer } from 'ws'

  const server = createServer() // also handles HTTP health checks
  const wss = new WebSocketServer({ server, path: '/ws' })

  wss.on('connection', (ws) => {
    ws.on('message', (data) => {
      /* handle */
    })
  })

  server.listen(process.env.PORT || 10000)
  ```

- **Heartbeat**: Server pings all clients every 30 seconds; if no pong response, the connection is terminated. This is recommended by Render to keep connections alive and detect stale ones.

### pnpm Workspaces — Monorepo Shared Types

- The project is a **monorepo** with three packages: `client/`, `server/`, `shared/`
- pnpm workspaces let both `client` and `server` import from `shared` as a local dependency
- **Root `pnpm-workspace.yaml`**:
  ```yaml
  packages:
    - client
    - server
    - shared
  ```
- **Root `package.json`** must include a `"packageManager"` field (e.g., `"packageManager": "pnpm@10.x.x"` — exact version pinned at setup time). This is required by `corepack enable` to know which pnpm version to activate in Render's build environment.
- **How shared imports work**:
  - `shared/package.json` has `"name": "@game/shared"`
  - `client/package.json` and `server/package.json` each list `"@game/shared": "workspace:*"` as a dependency
  - Import in code: `import type { GameMessage } from '@game/shared'`
  - Vite resolves workspace packages natively (no extra config)
  - For the server, `tsx` or `tsc` + `node` handles it

### `tsx` — Server Dev Runner

- **What it is**: A fast TypeScript executor for Node.js — runs `.ts` files directly without a separate compile step
- **Used for**: `pnpm dev` in the server package (`tsx watch src/main.ts`) — auto-restarts on file changes
- **Dev-only**: Not needed in production (server is compiled to JS via `tsc` before deploy)
- **Install**: Listed as a `devDependency` in `server/package.json`

### Git + GitHub

- Code lives in a single GitHub repository
- Render connects to the GitHub repo directly
- **Auto-deploy**: Every push to `main` triggers a build + deploy on Render
- **Branch workflow**: Develop on feature branches, merge to `main` to deploy
- `.gitignore` excludes: `node_modules/`, `dist/`, `.env`, `*.local`

---

## Deployment (Deep Dive)

### Hosting: Render (100% free tier)

Both services deploy from the **same GitHub repo** (monorepo). Render's `buildFilter` controls when each service rebuilds. We do **not** set `rootDir` because both services need access to `shared/` at build time (Render excludes files outside the root directory).

```
┌──────────────────────────┐     ┌──────────────────────────┐
│   Render Static Site     │     │   Render Web Service     │
│   (client)               │     │   (server)               │
│                          │     │                          │
│  - Serves client/dist/   │ WS  │  - Node.js + ws          │
│  - Free, CDN + SSL       │◄───►│  - Free (750 hrs/mo)     │
│  - Auto-deploy from Git  │     │  - WebSocket on /ws      │
│  - Build filter: client/ │     │  - Build filter: server/ │
└──────────────────────────┘     └──────────────────────────┘
```

#### Static Site (Client)

| Setting        | Value                                                                                               |
| -------------- | --------------------------------------------------------------------------------------------------- |
| Type           | Static Site                                                                                         |
| Root Directory | _(not set — repo root)_                                                                             |
| Build Command  | `corepack enable && pnpm install && pnpm --filter @game/shared build && pnpm --filter client build` |
| Publish Dir    | `client/dist`                                                                                       |
| Cost           | $0 (static sites are always free)                                                                   |

- Produces a static `dist/` folder — just HTML, JS, CSS
- Served from Render's CDN with automatic SSL (`https://your-game.onrender.com`)
- Brotli compression included
- Custom domains supported (free)

#### Web Service (Server)

| Setting        | Value                                                                                               |
| -------------- | --------------------------------------------------------------------------------------------------- |
| Type           | Web Service                                                                                         |
| Runtime        | Node                                                                                                |
| Instance Type  | Free                                                                                                |
| Root Directory | _(not set — repo root)_                                                                             |
| Build Command  | `corepack enable && pnpm install && pnpm --filter @game/shared build && pnpm --filter server build` |
| Start Command  | `node server/dist/main.js`                                                                          |
| Cost           | $0 (750 free instance hours/month)                                                                  |

- Binds to `process.env.PORT` (default: 10000) — required by Render
- Serves both HTTP (health check at `/`) and WebSocket (upgrade at `/ws`) on the same port
- **Idle spin-down**: Sleeps after 15 minutes without traffic; wakes in ~60 seconds on next request
- **Heartbeat**: Server pings all clients every 30 seconds; Render does not impose a max WebSocket duration, but connections close when the instance restarts (deploys, maintenance)
- **Reconnection**: Client must implement reconnect with exponential backoff (1s, 2s, 4s, 8s… up to 60s)
- **Cold-start UX**: When the server is asleep (idle >15 min), the first WebSocket connection will fail while the instance wakes (~60s). The client should detect this and show a "Waking up server…" message instead of the generic "Looking for opponent…" screen. Approach: send an HTTP `GET /` (health check) before attempting the WebSocket connection — if it fails or takes >2s, display the cold-start message. Only open the WebSocket after the health check succeeds.

#### Infrastructure-as-Code: `render.yaml`

Both services can be defined in a single Blueprint file at the repo root, so deployment is fully reproducible:

```yaml
services:
  # --- Client (static site) ---
  - type: web
    name: incremental-client
    runtime: static
    buildCommand: corepack enable && pnpm install && pnpm --filter @game/shared build && pnpm --filter client build
    staticPublishPath: client/dist
    envVars:
      - key: NODE_VERSION
        value: '22'
    buildFilter:
      paths:
        - client/**
        - shared/**

  # --- Server (WebSocket game server) ---
  - type: web
    name: incremental-server
    runtime: node
    plan: free
    buildCommand: corepack enable && pnpm install && pnpm --filter @game/shared build && pnpm --filter server build
    startCommand: node server/dist/main.js
    buildFilter:
      paths:
        - server/**
        - shared/**
    envVars:
      - key: NODE_ENV
        value: production
      - key: NODE_VERSION
        value: '22'
```

Pushing this file to GitHub and clicking "New Blueprint" in Render creates both services at once.

### Render Free Tier Limits

| Resource               | Limit                        | Impact                                        |
| ---------------------- | ---------------------------- | --------------------------------------------- |
| Instance hours         | 750/month                    | ~24h/day if always on; sleeps when idle       |
| Idle spin-down         | After 15 min no traffic      | ~60s cold start on next visit                 |
| Bandwidth              | 100 GB/month included        | More than enough for 2 players                |
| Build pipeline minutes | 500/month                    | Each build takes ~1-2 minutes                 |
| Ephemeral filesystem   | Lost on every restart/deploy | No issue — game state is in-memory only       |
| SSL                    | Automatic, free              | `wss://` for WebSocket, `https://` for client |

### Client → Server Connection

- Client connects to `wss://incremental-server.onrender.com/ws`
- Must use `wss://` (not `ws://`) — Render terminates SSL at the load balancer and forwards as `ws://` internally
- The server URL is injected into the client via Vite's env variables:
  - `client/.env.production`: `VITE_WS_URL=wss://incremental-server.onrender.com/ws`
  - `client/.env.development`: `VITE_WS_URL=ws://localhost:10000/ws`
  - Accessed in code as `import.meta.env.VITE_WS_URL`

---

## Local Development

### Prerequisites

- **Node.js** ≥ 20.19 (required by Vite 6)
- **pnpm** ≥ 10.x (`npm install -g pnpm`)
- **Git**

### Setup (first time)

```bash
git clone https://github.com/<user>/incremental-game.git
cd incremental-game
pnpm install          # installs all workspace dependencies
```

### Running locally

```bash
# Terminal 1: start the game server
cd server
pnpm dev              # runs tsx watch src/main.ts on port 10000

# Terminal 2: start the client dev server
cd client
pnpm dev              # runs vite on port 5173 (connects to WS via .env.development)
```

- Open `http://localhost:5173` in two browser tabs/windows to simulate two players
- Vite HMR: client code changes appear instantly
- Server: `tsx watch` restarts on file changes

### Testing a production build locally

Vite's `pnpm build` uses `.env.production` by default, which has the Render WS URL baked in. To test a real production build against the local server, create a `.env.production.local` override (already gitignored by `*.local`):

```bash
# Terminal 1: build and preview the client with local WS override
echo "VITE_WS_URL=ws://localhost:10000/ws" > client/.env.production.local
cd client && pnpm build && pnpm preview   # serves optimized dist/ at localhost:4173
# remove the override when done: rm client/.env.production.local

# Terminal 2: build and run the server
cd server && pnpm build && node dist/main.js
```

---

## Project Structure

```
incremental-game/
├── DESIGN.md                    ← this file
├── render.yaml                  ← Render Blueprint (infra-as-code)
├── pnpm-workspace.yaml          ← declares workspace packages
├── package.json                 ← root scripts (dev, build, etc.)
├── .gitignore
│
├── shared/                      ← @game/shared — types & constants
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts             ← barrel export
│       ├── messages.ts          ← WebSocket message type definitions
│       ├── game-config.ts       ← round length, upgrade costs, rate limits
│       ├── idler-logic.ts       ← idler mode passive income formulas
│       └── types.ts             ← PlayerState, UpgradeId, etc.
│
├── client/                      ← Vite vanilla-ts project
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   ├── index.html               ← entry point (script type="module")
│   ├── .env.development          ← VITE_WS_URL=ws://localhost:10000/ws
│   ├── .env.production           ← VITE_WS_URL=wss://incremental-server.onrender.com/ws
│   └── src/
│       ├── main.ts              ← entry: init UI, connect to server
│       ├── game.ts              ← local game state + client prediction + milestone tracking
│       ├── network.ts           ← WebSocket client, batching, reconciliation
│       ├── style.css            ← all game styling including VFX
│       └── ui/
│           ├── index.ts         ← screen router + render dispatch
│           ├── components.ts    ← reusable UI components (timer, progress bars, upgrades)
│           ├── helpers.ts       ← DOM utilities (setText, formatScore, etc.)
│           ├── hotkeys.ts       ← keyboard shortcuts (Space, Tab, number keys)
│           ├── lobby.ts         ← lobby / mode selection screen
│           ├── playing.ts       ← playing screen render + in-place updates
│           ├── screens.ts       ← waking, waiting, countdown screens
│           ├── end.ts           ← end-of-round results screen
│           └── vfx/
│               ├── index.ts     ← barrel + click popup, ripple, pulse, combo, flash
│               ├── shared.ts    ← hasDom, getLayer, shakeScreen
│               └── shockwave.ts ← milestone shockwave energy nova effect
│
└── server/                      ← Node.js WebSocket server
    ├── package.json
    ├── tsconfig.json
    └── src/
        ├── main.ts              ← HTTP server + WebSocket server setup
        ├── match.ts             ← match lifecycle: countdown, tick, scoring
        ├── matchmaking.ts       ← queue + pairing logic
        ├── bot.ts               ← AI bot opponent logic
        └── validation.ts        ← anti-cheat: rate limiting, purchase checks
```

---

## Step-by-Step: From Zero to Deployed

> These phases document the original build sequence for the prototype. For the forward-looking upgrade systems roadmap, see [Systems Roadmap](#systems-roadmap).

### Step 0: Repository Setup

1. Create GitHub repo (`incremental-game`)
2. Clone locally, initialize pnpm workspace:
   ```bash
   pnpm init
   # create pnpm-workspace.yaml listing client, server, shared
   ```
3. Create `shared/`, `client/`, `server/` packages:
   ```bash
   mkdir shared && cd shared && pnpm init
   cd .. && pnpm create vite@latest client -- --template vanilla-ts
   mkdir -p server/src && cd server && pnpm init
   ```
4. Set up TypeScript configs (`tsconfig.json`) in each package
5. Wire up `@game/shared` as a workspace dependency in client and server
6. Add root-level convenience scripts:
   ```json
   {
     "packageManager": "pnpm@10.x.x",
     "scripts": {
       "dev:client": "pnpm --filter client dev",
       "dev:server": "pnpm --filter server dev",
       "build": "corepack enable && pnpm install && pnpm --filter @game/shared build && pnpm --filter client build && pnpm --filter server build"
     }
   }
   ```
7. Create `.gitignore`, commit, push

### Step 1: Shared Types

1. Define message types in `shared/src/messages.ts`:
   - `ActionBatch` (client → server)
   - `StateUpdate`, `RoundStart`, `RoundEnd` (server → client)
2. Define `GameConfig` in `shared/src/game-config.ts`:
   - Round duration, upgrade definitions, rate limits
3. Export everything from `shared/src/index.ts`

### Step 2: Server — "Hello WebSocket"

1. Set up HTTP + WebSocket server in `server/src/main.ts`:
   - HTTP `GET /` returns health check (required by Render)
   - WebSocket upgrade on path `/ws`
   - Bind to `process.env.PORT || 10000`
2. Implement heartbeat (ping every 30s, terminate on no pong)
3. Implement basic matchmaking in `server/src/matchmaking.ts`:
   - When a player connects, add to queue
   - When 2 players are queued, create a match
4. Implement match lifecycle in `server/src/match.ts`:
   - Countdown (3-2-1)
   - Game tick loop (setInterval every 250ms for passive income)
   - Receive + validate action batches
   - Broadcast state updates every 500ms
   - End round when timer hits 0, declare winner
5. Implement validation in `server/src/validation.ts`:
   - Click rate check
   - Purchase affordability check

### Step 3: Client — "Hello Game"

1. Scaffold with Vite vanilla-ts template
2. Set up WebSocket connection in `client/src/network.ts`:
   - Connect to `import.meta.env.VITE_WS_URL`
   - Send action batches, receive state updates
   - Reconnect with exponential backoff
3. Implement local game state in `client/src/game.ts`:
   - Optimistic click counting
   - Reconcile with server state on each StateUpdate
4. Implement UI in `client/src/ui.ts`:
   - Waiting screen ("Looking for opponent…")
   - Countdown overlay ("3… 2… 1… GO!")
   - Game screen: click button, currency, upgrades, opponent state (score, currency, upgrades), timer
   - End screen: winner, stats, rematch button
5. Style with `client/src/style.css`:
   - Mobile-first, large tap target for the click button
   - Minimal and responsive

### Step 4: Deploy to Render

1. Create `render.yaml` at repo root (see above)
2. Push to GitHub
3. In Render Dashboard: **New → Blueprint → Connect repo → Deploy**
   - Render reads `render.yaml` and creates both services automatically
4. Note the server URL (e.g., `incremental-server.onrender.com`)
5. Update `client/.env.production` with the actual server URL
6. Push again — client redeploys with correct WS endpoint
   - **Note**: The first client deploy won't connect to the server (placeholder URL). This is expected — it becomes functional after this step.
7. Open `https://incremental-client.onrender.com` on two phones → play!

### Step 5: Iterate

- Play with friend → note what's fun, what's broken, what's missing
- Push changes to `main` → auto-redeploy
- Repeat

---

## Open Questions

- [ ] **Game name?** incremenTal (capital T only, still a code name and not final).
- [x] **Round length**: configurable per goal type (30s timed, 60s safety cap for target-score).
- [x] **Visibility**: full visibility — both players see each other's complete state.
- [ ] **Upgrade balance**: ongoing — see [BALANCE.md](BALANCE.md) for the balancing framework.
- [ ] **Mobile UX**: current design is responsive but untested on devices. Needs real-device testing.
- [x] **Reconnection mid-round**: opponent keeps playing; disconnected player falls behind. Server cleans up stale connections via ping/pong heartbeat.

---

## Future Directions (post-prototype)

For the upgrade/bonus systems roadmap (upgrade tree, tiers, ability cards, perks, prestige), see [Systems Roadmap](#systems-roadmap) below.

Other planned features:

1. **Team matches** (2v2, 3v3) → shared economy, role specialization
2. **Async competition** → submit your best run, compare on leaderboard
3. **Spectator mode** → watch live matches
4. **Seasonal events** → limited-time upgrade sets or rules
5. **Indirect competition** → shared world where players' economies interact
6. **Accounts + persistence** → Firebase Auth + Firestore (already familiar)
7. **ELO / ranking** → competitive ladder

---

## Systems Roadmap

A taxonomy of every bonus/upgrade system planned for the game, their relationships, and the order in which they should be built.

### Bonus Taxonomy

Every ability that affects currency falls into exactly one **effect type**:

| Effect Type   | What it does                             | Examples                                           |
| ------------- | ---------------------------------------- | -------------------------------------------------- |
| **Generate**  | Creates currency directly or indirectly  | "+100 wood", "each click worth 2× for 10s"         |
| **Transmute** | Converts one currency into another       | "Convert 15 ale into a wood chopper"               |
| **Sabotage**  | Destroys currency, mostly the opponent's | "Sacrifice 20 ale to reduce opponent's wood by 30" |

> **Note**: a _tier_ (passive auto-generator, à la Cookie Clicker) is always a generate-type bonus.

### Bonus Systems

| System            | Layer  | When it applies   | Description                                                                                                   |
| ----------------- | ------ | ----------------- | ------------------------------------------------------------------------------------------------------------- |
| **Upgrade tree**  | Direct | During match      | Purchasable bonuses with dependency edges. Can be generate, transmute, or sabotage.                           |
| **Tiers**         | Direct | During match      | Passive auto-generators bought with currency. Each tier produces more than the last. Always generate-type.    |
| **Ability cards** | Direct | Pre-match + match | Chosen before the match from a limited hand. Activatable during the round. Can be any effect type.            |
| **Perks**         | Meta   | Pre-match         | Passive amplifiers chosen before the match. Multiply or enhance other systems rather than producing currency. |
| **Prestige**      | Meta   | Mid-match         | Voluntary currency reset in exchange for permanent multipliers for the rest of the round.                     |

**Direct** systems produce, convert, or destroy currency. **Meta** systems amplify direct systems.

### Ability Card Classes

Ability cards can additionally belong to a **class** that describes _how_ they deliver their bonus:

| Class          | Mechanic                                          | Example                                  |
| -------------- | ------------------------------------------------- | ---------------------------------------- |
| **Randomizer** | Outcome depends on RNG                            | "Gain between 10–50 ale"                 |
| **Rhythmical** | Requires tapping in a specific rhythm to activate | "Tap 4 beats at 120 BPM to gain 40 wood" |

Perks can target specific effect types or card classes. For example, a perk like _"Randomizers yield 10% more"_ would turn "gain 10–50 ale" into "gain 11–55 ale."

### Native Bonuses

Some bonuses are embedded directly into a game mode and don't require purchasing or pre-match selection. They are intrinsic to the mode's identity.

| Mode        | Native bonus  | Description                                               |
| ----------- | ------------- | --------------------------------------------------------- |
| **Clicker** | CPS intensity | Sustained high clicks-per-second triggers enhanced income |

These exist outside the upgrade/card/perk systems and are always available when playing that mode.

### Modifier Pipeline

All systems funnel through a single computation pipeline. This is the critical architecture that prevents spaghetti when systems interact.

```
base income
  │
  ├─► native bonuses (mode)      CPS intensity, mode-specific modifiers
  │
  ├─► tiers (additive)           +N per second per tier owned
  │
  ├─► upgrade tree (varies)      generate / transmute / sabotage
  │
  ├─► ability cards (varies)     generate / transmute / sabotage
  │
  ├─► perks (multiplicative)     ×1.1 to specific types or classes
  │
  ├─► prestige (multiplicative)  ×P global multiplier
  │
  └─► final income
```

Each system registers **modifiers** into the pipeline. The pipeline evaluates them in a fixed order (additive before multiplicative). This means:

- Adding a new system = adding a new modifier stage. No existing code changes.
- Balancing = adjusting coefficients at each stage independently.
- Testing = snapshot the pipeline output for known inputs.

### Implementation Order

Build in dependency order — each system is minimally viable but designed with integration hooks for later systems:

```
Phase 1 ─ Modifier pipeline (architecture)
           └─ The backbone. Every system registers modifiers here.

Phase 2 ─ Upgrade tree (generate-type first, then transmute + sabotage)
           └─ Core progression loop. The tree structure is type-agnostic.

Phase 3 ─ Tiers / auto-generators
           └─ Passive income. Changes pacing from pure clicking.

Phase 4 ─ Ability cards (generate + transmute)
           └─ Pre-match strategy emerges. Limited hand forces choices.

Phase 5 ─ Sabotage abilities
           └─ PvP tension. Only fun when both players have something to lose.

Phase 6 ─ Prestige
           └─ Mid-match reset. Needs enough content that resetting is a real trade.

Phase 7 ─ Perks
           └─ Multiplicative meta-layer. The things they multiply must exist first.

Phase 8 ─ Card classes (randomizers, rhythmicals)
           └─ Flavor and variety. Perks can now target specific classes.
```

### Balancing Across Systems

- **Design each system with a `1.0×` placeholder** for systems that don't exist yet. When perks arrive, replace the placeholder. This way the upgrade tree is balanced _relative to itself_ and won't collapse when perks go live.
- **Playtest at each phase.** After adding tiers, play 20 rounds. Does passive income make clicking feel pointless? Fix it before adding cards.
- **Use effect types as a balancing constraint.** In any given match, total generate should exceed total sabotage — otherwise games feel punishing. This can be validated in tests.
- **The modifier pipeline makes A/B testing trivial.** Swap one stage's coefficients and compare score distributions across playtests.
