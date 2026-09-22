# ADR-001 — Stack

**Status:** Accepted
**Date:** 2026-09-22
**Owner:** CTO (Claude)

## Decision

| Layer | Choice |
|---|---|
| Language | TypeScript (strict), end to end |
| Runtime | Node 22 LTS |
| API | Single Fastify service (modular monolith) |
| Database | Postgres 16 on Supabase, used as plain Postgres |
| DB access | Kysely (typed SQL builder) + raw SQL for ledger functions and constraints |
| Migrations | Plain SQL files, applied in CI, never edited after merge |
| Validation | Zod at every boundary (HTTP, webhooks, provider responses) |
| Sender app | Expo (React Native) |
| Channel gateway | Module inside the monolith, behind the channel adapter interface |
| Hosting | Railway (API + worker), Supabase (DB) |
| Jobs | pg-boss (Postgres-backed queue) |
| Tests | Vitest + Testcontainers Postgres; property tests with fast-check for the ledger |
| CI | GitHub Actions; `make verify` = typecheck + lint + test |

## Rationale against the four priorities

**1. Correctness under concurrency.** Postgres with `SERIALIZABLE` isolation on every ledger write, retry-on-serialization-failure wrapper, append-only enforced by DB triggers and revoked UPDATE/DELETE grants rather than by application discipline. Money is `bigint` minor units plus ISO currency code, never floats, never `numeric` passed through JS numbers. Kysely over an ORM because ledger code must read like the SQL it runs.

**2. Small payloads.** API responses are designed payloads, not serialized entities. Expo lets us control bundle size and ship OTA fixes without a store release. Recipients never install anything; they are on WhatsApp.

**3. Operability for two people.** One deployable service and one database. The queue lives in Postgres, so there is no Redis to babysit. Managed Postgres gives backups and point-in-time recovery. The channel gateway is a separate module with its own interface, so it can be split into its own service later when its failure profile demands it. That split is not done on day one.

**4. Auditability.** Ledger is append-only by construction. Every state transition writes an event row with actor, cause, and timestamp. Migrations are immutable files in git. Provider requests and responses are stored raw.

## Why TypeScript end to end

One language across API, app, and shared types means shared Zod schemas between client and server, and agents (Claude Code, K2) are strongest in it. The cost is weaker numeric safety than a language like Kotlin or Rust; the Money type and lint rules below close that gap.

## Guardrails that come with this decision

- No `number` for money anywhere. A lint rule bans arithmetic on values typed `Money`.
- Supabase auto-generated REST (PostgREST) is **disabled for all ledger and domain tables**. The API service is the only writer.
- No Supabase Edge Functions for business logic. One place for logic.
- Adding a new service or datastore requires a new ADR.

## Rejected

- **Next.js / Vercel serverless** — webhook-heavy, long-running channel flows and serializable retries fit poorly in short-lived functions.
- **Microservices** — two people cannot be paged for five services.
- **Firebase / document DB** — fails the transactional-guarantee constraint.
- **PWA-only sender app** — viable, but a money app without a store presence costs trust with this audience. Revisit if Expo becomes a burden.

## Revisit triggers

- Channel gateway throughput or failure isolation becomes a real incident source → split it out.
- Regulator or partner requires specific hosting (e.g., data residency, SOC 2 scope) → re-evaluate Railway/Supabase.
