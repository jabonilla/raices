# Raíces

Cross-border payments: a US-based sender and a Guatemala-based recipient share a structured financial relationship. Money moves with a stated purpose and an approval gate. Recipients use WhatsApp only and install nothing.

This repository holds the API, the sender app, the ledger, and the shared money/settlement libraries. It is a TypeScript monorepo (pnpm workspaces).

## Layout

```
apps/api/          Fastify service: ledger writes, reconciliation, health probes
apps/api/src/db/          Postgres access (Kysely), serializable-tx helper
apps/api/src/ledger/      post(), balance() — ledger posting and balance logic
apps/api/src/reconciliation/  provider-statement reconciliation
apps/mobile/       Expo (React Native) sender app
packages/money/    Money type: bigint minor units + ISO 4217 code. No floats.
packages/settlement/  SettlementProvider interface + deterministic mock
db/migrations/     Forward-only SQL migrations (never edited after merge)
scripts/           db:migrate, db:seed, and the _test/_dev database guard
docs/adr/          Architecture Decision Records
docs/tickets/      Phase ticket specs
docs/local-dev.md  Local database setup
```

## Rules that shape the code

These come from `CLAUDE.md` and are enforced by tests, lint, and database constraints — not just convention:

- Money is `bigint` minor units plus an ISO 4217 code. Never `number`, never float.
- The ledger is append-only. Corrections are new compensating transactions.
- Debits equal credits per transaction, per currency — enforced by a database trigger.
- Every financial operation and inbound channel message is idempotent.
- No business logic branches on partner identity; settlement goes through `SettlementProvider`.

## Developing

Local database setup (four commands): see [docs/local-dev.md](docs/local-dev.md).

```sh
pnpm install          # install dependencies
make verify           # typecheck + lint + test (the CI gate)
pnpm db:migrate       # apply migrations (needs DATABASE_URL)
pnpm db:seed          # fixture data for local development
```

`make verify` must be green before a PR is considered done. Tests that need Postgres use Testcontainers; no local database is required to run them.

`db:migrate` and `db:seed` refuse any database whose name does not end in `_test` or `_dev`.

### Mobile bundle budget

The Android production JS bundle must stay under **2,500,000 bytes** (2.38 MiB). The target user is often on an older Android with limited storage and metered data, so bundle size is a product constraint, not vanity.

- Measured 2026-09-28: 1,928,525 bytes (1.84 MiB); budget = measured + ~30% headroom, rounded to a memorable number.
- `pnpm check:bundle-budget` (also a CI step) exports the bundle with `expo export --platform android --no-bytecode` and fails if it exceeds the budget. `--no-bytecode` skips Hermes bytecode compilation — expo's hermesc lookup is broken for react-native 0.81 (it throws resolving the `hermes-compiler` package before trying the prebuilt binary react-native ships), and the minified JS is a stable, version-independent proxy for shipped size. Source maps are excluded; they do not ship to devices.
- To re-measure: run `pnpm check:bundle-budget` and read the printed size.
- To raise the budget: update `BUDGET_BYTES` in `scripts/check-bundle-budget.ts` and say why in the PR. Never bump it silently to make CI pass.

### API telemetry

`apps/api` emits one span per HTTP request plus spans for DB transactions run through `withTracedSerializableTx` (`apps/api/src/telemetry.ts`). The tracer is dependency-free and emits OpenTelemetry-shaped JSON.

- `TELEMETRY_EXPORTER=console|none` selects the exporter. Default is `console` in dev (`NODE_ENV` unset or `development`) and `none` elsewhere.
- Span attributes go through the K2.5 redaction deny-list: no PII and no amounts in span names or attributes, same rule as the logs. Span names use the route pattern (`HTTP GET /postings/:id`), never the raw URL.
- Transaction spans record `db.tx.attempts` (the retry attempt count from `withSerializableTx`) and `db.tx.last_sql_state`, so contention is observable instead of inferred from failures.

## Architecture

The stack and the reasons behind it are recorded as ADRs:

- [ADR-001 — Stack](docs/adr/ADR-001-stack.md): TypeScript end to end, single Fastify service (modular monolith), Postgres 16, Kysely, Zod at every boundary, Expo sender app.

## Contributing

- One ticket per PR; the PR title starts with the ticket ID (e.g. `K2.14 feat: ...`).
- Conventional commits.
- Never hand-edit `pnpm-lock.yaml`; regenerate it with `pnpm install`.
- `apps/api/src/ledger/`, `packages/money/`, and `db/` are owned by the CTO/ledger builders — do not touch them unless your ticket says so.
- See [SECURITY.md](SECURITY.md) for vulnerability reporting.

<!-- staging: Railway builds from apps/api/Dockerfile; migrations run as the pre-deploy command (node dist/migrate.mjs). -->
