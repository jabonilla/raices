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

## Architecture

The stack and the reasons behind it are recorded as ADRs:

- [ADR-001 — Stack](docs/adr/ADR-001-stack.md): TypeScript end to end, single Fastify service (modular monolith), Postgres 16, Kysely, Zod at every boundary, Expo sender app.

## Contributing

- One ticket per PR; the PR title starts with the ticket ID (e.g. `K2.14 feat: ...`).
- Conventional commits.
- Never hand-edit `pnpm-lock.yaml`; regenerate it with `pnpm install`.
- `apps/api/src/ledger/`, `packages/money/`, and `db/` are owned by the CTO/ledger builders — do not touch them unless your ticket says so.
- See [SECURITY.md](SECURITY.md) for vulnerability reporting.
