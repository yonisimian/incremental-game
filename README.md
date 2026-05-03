# incremenTal

A real-time head-to-head incremental game playable in the browser. Two players compete simultaneously, making strategic decisions about resource accumulation and upgrades within a shared time-limited round.

**Tech:** TypeScript · Vite · WebSocket · pnpm monorepo

## Quick Start

**Prerequisites:** Node.js ≥ 22, [pnpm](https://pnpm.io/) (via corepack)

```bash
git clone git@github.com:yonisimian/incremental-game.git
cd incremental-game
corepack enable
pnpm install
pnpm dev                # starts both client and server
```

The client runs at `http://localhost:5173` and connects to the dev server on port `10000`. Use `pnpm dev:server` and `pnpm dev:client` to run them in separate terminals if you prefer.

## Project Structure

```text
shared/   @game/shared — types, game config, mode definitions, modifiers
server/   Game server — WebSocket, matchmaking, match logic, bot AI
client/   Browser client — vanilla DOM UI, optimistic state, VFX
docs/     Design documents and references
```

## Scripts

| Command              | Description                       |
| -------------------- | --------------------------------- |
| **Development**      |                                   |
| `pnpm dev`           | Start client + server in dev mode |
| `pnpm dev:client`    | Start client only                 |
| `pnpm dev:server`    | Start server only                 |
| **Build & Test**     |                                   |
| `pnpm build`         | Production build (all packages)   |
| `pnpm test`          | Run all tests                     |
| `pnpm test:coverage` | Run tests with coverage report    |
| `pnpm typecheck`     | Type checking across all packages |
| **Code Quality**     |                                   |
| `pnpm lint`          | ESLint                            |
| `pnpm lint:md`       | Markdown lint                     |
| `pnpm lint:exports`  | Knip — unused exports             |
| `pnpm format`        | Prettier (write)                  |
| `pnpm format:check`  | Prettier (check only)             |
| **Utilities**        |                                   |
| `pnpm sim:idler`     | Run the idler balance simulation  |

## Documentation

- [DESIGN.md](docs/DESIGN.md) — architecture, systems overview, and roadmap
- [BALANCE.md](docs/BALANCE.md) — balancing framework, formulas, and analysis
- [MANUAL.md](docs/MANUAL.md) — player manual (WIP)

## Contributing

1. **Setup** — clone, `corepack enable`, `pnpm install`. Pre-commit hooks install automatically via `simple-git-hooks`.
2. **Branching** — development happens on `main` (small team, fast iteration).
3. **Code quality** — pre-commit runs Prettier, ESLint, and markdownlint automatically. CI runs typecheck + lint + format check + tests on every push.
4. **Tests** — add tests for any new shared or server logic. Run `pnpm test` before pushing.
5. **Commits** — use [conventional commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`).

## License

[MIT](LICENSE) — yonisimian & Talnazar
