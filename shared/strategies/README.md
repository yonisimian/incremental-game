# Reference strategies

Git-tracked `QueueStrategy` documents, one JSON file per strategy, grouped by
mode:

```text
shared/strategies/<mode>/<name>.json
```

Each file matches the `QueueStrategy` schema in
[../src/simulation/strategy.ts](../src/simulation/strategy.ts) — `version`,
`name`, `mode`, and an ordered `actions` queue (no timestamps). Author and edit
them through the **Queue Simulation** tab at `/dev.html` (Save/Load buttons),
which writes canonical, pretty-printed JSON via `serializeStrategy` so diffs
stay clean.

The dev panel auto-discovers every file under `<current-mode>/` and lists it in
the strategy picker alongside session strategies. These files also double as the
envelope fixtures for the balance checks in
[../../docs/plans/05-balance-design.md](../../docs/plans/05-balance-design.md)
(Phase C / CI).

No reference strategies are checked in yet — add them here as authoring
stabilizes (or seed a starting point with the `generateStrategies` button once
Phase 5 lands).
