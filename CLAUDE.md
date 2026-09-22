# Raíces — context for AI agents

Read this file in full before every task. It overrides your defaults.

## What this is

A cross-border payments product. A US-based sender and a Guatemala-based recipient share a structured financial relationship. Money moves with a stated purpose attached and an approval gate. Recipients use WhatsApp only and install nothing.

Before any task, read `docs/immigrant-wealth-protection-PRD-v2.md`. For architecture questions, read `docs/immigrant-wealth-protection-architecture-brief.md`. Your ticket lives in `docs/tickets/`.

## Team and authority

- **Jose (founder):** product decisions, accounts and credentials, merge approval.
- **Claude (CTO):** architecture, ADRs, tickets, code review. Owns every rule in this file.
- **Claude Code / K2 (builders):** implement tickets exactly as written.

If a ticket conflicts with this file, this file wins. Stop and flag the conflict in the PR description.

## NON-NEGOTIABLE RULES

1. **Money is `bigint` minor units plus an ISO 4217 code.** Never `number`, never float, never a string parsed lazily. Use the `Money` type from `packages/money`. Any money math on `number` gets rejected in review.
2. **Ledger entries are append-only.** Never UPDATE or DELETE a ledger row. Corrections are new compensating transactions. If you are writing an UPDATE against a ledger table, stop.
3. **Debits equal credits** for every transaction, per currency. This is enforced in the database and asserted in tests.
4. **Intent state and settlement state are separate fields.** Never collapse them into one status enum.
5. **Every state transition writes an audit event row** (actor, cause, before, after, timestamp).
6. **Every financial operation and every inbound channel message is idempotent.** Assume at-least-once delivery everywhere.
7. **No business logic branches on partner identity.** All settlement goes through `SettlementProvider`.
8. **The AI layer has no write access and no direct data access.** It receives a pre-rendered context object.
9. **Relationships are many-to-many.** Never assume one sender per recipient or one recipient per sender.
10. **Write the test first** for anything touching money, state machines, or the ledger.

## When you are unsure

Stop and ask in the PR or issue. Do not invent business rules. Do not guess at money semantics. **Never fix a failing money test by changing its assertion.**

## Stack (see docs/adr/ADR-001-stack.md)

- TypeScript strict, Node 22 LTS, pnpm workspaces
- API: Fastify, one deployable service (`apps/api`)
- DB: Postgres 16 (Supabase in prod, Testcontainers in tests). Plain Postgres only: no PostgREST, no Edge Functions, no Supabase client in the API
- DB access: Kysely, plus raw SQL in migrations for triggers and constraints
- Migrations: `db/migrations/NNNN_name.sql`, forward-only, never edited after merge
- Validation: Zod at every boundary
- Jobs: pg-boss
- Tests: Vitest, fast-check for property tests, Testcontainers Postgres for anything touching the DB. **Never mock the database in ledger tests.**
- Sender app: Expo (`apps/mobile`), which is not started yet
- Hosting: Railway (API) + Supabase (DB)

Adding a dependency that introduces a new service or datastore requires an ADR. Ask first.

## Repo layout

```
apps/api/            Fastify service
  src/ledger/        posting, balances, reconciliation
  src/db/            Kysely setup, transaction + retry helpers
packages/money/      Money type (no dependencies)
db/migrations/       SQL migrations
docs/                PRD, briefs, ADRs, tickets
```

## Database rules

- Every ledger write runs in `SERIALIZABLE` isolation through `withSerializableTx()`, which retries on SQLSTATE `40001` / `40P01` with jittered backoff, max 5 attempts.
- The app role has no UPDATE, DELETE, or TRUNCATE grant on ledger tables. Triggers also reject them.
- Order ledger history by `seq` (bigserial), never by `created_at`.
- Timestamps are `timestamptz`, stored in UTC.

## Conventions

- Conventional commits (`feat:`, `fix:`, `chore:`, `test:`, `docs:`)
- One ticket per PR. The PR title starts with the ticket ID, e.g. `P1.3 feat: double-entry posting`
- The PR description lists each acceptance criterion with how it was verified
- `make verify` (typecheck + lint + test) must pass before opening a PR
- No task is complete until its acceptance criteria are verified
