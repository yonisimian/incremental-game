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

The harness builds `@game/shared`, the client in Vite's `e2e` mode, and the server. It starts the server on `127.0.0.1:10001` and Vite preview on `127.0.0.1:4173`; existing processes on either port cause a deliberate failure.

## Suite policy

- Wait for visible or protocol-driven conditions; do not add arbitrary sleeps.
- Prefer roles and accessible names, then stable domain attributes.
- Prove authoritative actions through another browser or a server-owned transition.
- Keep one worker because matchmaking and rooms are process-global.
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
