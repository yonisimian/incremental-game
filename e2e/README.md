# End-to-end tests

Playwright exercises the production-built client and server through real HTTP and WebSocket connections. Tests are black-box: they do not import game modules, grant resources, fake clocks, or use a test-only backend.

## Install browsers

```bash
pnpm --dir e2e exec playwright install --with-deps chromium firefox webkit
```

## Commands

| Command                  | Scope                                           |
| ------------------------ | ----------------------------------------------- |
| `pnpm test:e2e`          | Every browser project, including extended tests |
| `pnpm test:e2e:desktop`  | Ordinary Chromium, Firefox, and WebKit          |
| `pnpm test:e2e:mobile`   | Mobile Chromium touch/responsive tests          |
| `pnpm test:e2e:extended` | Accelerated long-clock Chromium tests           |
| `pnpm test:e2e:debug`    | Chromium Playwright UI mode                     |

The harness builds `@game/shared`, the client in Vite's `e2e` mode, and the server. Each Playwright worker boots its own game server on an OS-assigned port and points its pages at that server, so workers run in parallel without sharing matchmaking state. A single stateless Vite preview is shared on `127.0.0.1:4173`; an existing process on that port causes a deliberate failure.

## Suite policy

- Wait for visible or protocol-driven conditions; do not add arbitrary sleeps.
- Prefer roles and accessible names, then stable domain attributes.
- Prove authoritative actions through another browser or a server-owned transition.
- Each worker owns an isolated server, so the suite runs workers in parallel.
- Unexpected page errors, console errors, and failed requests fail teardown.
- Ordinary suites use production timing. Extended tests set server-only
  `GAME_TIME_SCALE=20`, preserving game-time durations while shortening wall-clock waits.
- `GAME_TIME_SCALE` accepts only integers from 1 through 20; production defaults to 1.
- Extended tests remain required in CI.

## Failure artifacts

Failed CI jobs upload `e2e/playwright-report/` and `e2e/test-results/`. Locally, open the report with:

```bash
pnpm --dir e2e exec playwright show-report
```

Traces are captured on the first retry; screenshots and videos are retained on failure.
