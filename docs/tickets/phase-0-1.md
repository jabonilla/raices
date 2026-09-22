# Tickets: Phase 0 and Phase 1

**Author:** CTO · **Status:** Ready
Tickets are done strictly in order. Each is one PR.

| ID | Title | Builder | Status |
|---|---|---|---|
| P0.1 | Repo + docs | CTO | ✅ Done |
| P0.2 | CLAUDE.md | CTO | ✅ Done |
| P0.3 | ADR-001 stack | CTO | ✅ Done |
| P0.4 | Workspace scaffold + CI | K2 or Claude Code | Ready |
| P1.1 | Money type | Claude Code | Blocked on P0.4 |
| P1.2 | Ledger schema + append-only | Claude Code | Blocked on P1.1 |
| P1.3 | Double-entry posting | Claude Code | Blocked on P1.2 |
| P1.4 | Balance derivation | Claude Code | Blocked on P1.3 |
| P1.5 | Reconciliation model | Claude Code | Blocked on P1.4 |

Phase 1 is Claude Code only. It is not delegated further.

---

## P0.4: Workspace scaffold + CI

**Goal:** An empty, verified monorepo that every later ticket builds on.

**Build**
- pnpm workspaces: `apps/api`, `packages/money`
- Root `tsconfig.base.json`: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, target ES2022
- ESLint (typescript-eslint, strict-type-checked) + Prettier
- Vitest at the root with workspace projects
- `apps/api`: Fastify with a single `GET /health` returning `{ ok: true }`
- `apps/api/src/db/`: Kysely instance from `DATABASE_URL`, and a `withSerializableTx(db, fn)` helper that runs `fn` in a SERIALIZABLE transaction and retries on `40001`/`40P01` (jittered backoff, max 5 attempts, then throws `SerializationRetryExhausted`)
- `db/migrations/` + a runner script `pnpm db:migrate` (plain SQL files applied in order, tracked in a `schema_migrations` table)
- Testcontainers helper `tests/pg.ts` that starts Postgres 16, runs migrations, and returns a Kysely instance
- `Makefile` with `verify` → `pnpm typecheck && pnpm lint && pnpm test`
- GitHub Actions: run `make verify` on push and PR, Node 22, with Docker available for Testcontainers
- `.nvmrc` (22), `.env.example` (`DATABASE_URL`)

**Acceptance criteria**
- [ ] `make verify` passes locally and in CI
- [ ] A test proves `withSerializableTx` retries: two concurrent txs that read-then-write the same row, where one gets `40001` and succeeds on retry
- [ ] `/health` has a passing test using `fastify.inject`
- [ ] No Supabase SDK in any `package.json`

---

## P1.1: Money type

**Location:** `packages/money`. Zero runtime dependencies.

**Design (decided)**
- `Money = { readonly amount: bigint; readonly currency: Currency }`, frozen
- `Currency` is a union of supported codes: `"USD" | "GTQ"`. The minor-unit exponent table is `USD: 2, GTQ: 2`
- Constructors: `money(amount: bigint, currency)` and `fromMajorString("10.50", "USD")`, which does exact decimal parsing and rejects more decimal places than the exponent allows. **No constructor accepts `number`**, including at runtime (throw if `typeof !== "bigint"`)
- Ops: `add`, `subtract`, `negate`, `isZero`, `isNegative`, `compare`, `equals`. Every binary op throws `CurrencyMismatchError` on different currencies
- `multiply(m, ratio: { num: bigint; den: bigint }, rounding: RoundingMode)`, where rounding is required and has no default. Modes: `HALF_EVEN`, `HALF_UP`, `DOWN`, `UP`
- `allocate(m, weights: bigint[])` uses largest remainder. Leftover minor units go to the parts with the largest remainders, ties broken by earliest index
- `format(m, locale)` is display only and never used for math
- No currency conversion in this package. FX is a separate concern with its own ticket later

**Acceptance criteria**
- [ ] `money(1000n, "USD")` represents $10.00
- [ ] `add(USD, GTQ)` throws `CurrencyMismatchError`
- [ ] `money(10.5 as any, "USD")` throws
- [ ] `allocate(money(100n,"USD"), [1n,1n,1n])` → 34, 33, 33
- [ ] `multiply` without a rounding mode is a type error
- [ ] **Property:** for any amount and any non-empty positive weights, `allocate` parts sum exactly to the input and no part differs from its exact share by ≥ 1 minor unit
- [ ] **Property:** `add` is commutative and associative; `subtract(add(a,b),b) == a`
- [ ] ESLint rule (custom or `no-restricted-syntax`) that bans `Number(`/`parseFloat` inside `packages/money` and `apps/api/src/ledger`

---

## P1.2: Ledger schema + append-only enforcement

**Migration:** `0001_ledger.sql`

**Schema (decided)**
```
ledger_account
  id uuid pk, code text unique, type text check in
  ('asset','liability','equity','revenue','expense'),
  currency char(3), created_at timestamptz

ledger_transaction
  id uuid pk, seq bigserial unique,
  idempotency_key text unique not null,
  request_hash text not null,         -- sha256 of canonical request
  description text not null,
  occurred_at timestamptz not null,   -- business time
  created_at timestamptz default now()

ledger_entry
  id uuid pk, seq bigserial unique,
  transaction_id uuid fk, account_id uuid fk,
  direction text check in ('debit','credit'),
  amount_minor bigint check (amount_minor > 0),
  currency char(3),
  entry_type text not null,
  created_at timestamptz default now()
```
- Entry currency must equal account currency. Enforce with a composite FK `(account_id, currency)` → `ledger_account(id, currency)`
- Indexes: `ledger_entry(transaction_id)`, `ledger_entry(account_id, seq)`
- **Append-only:** `BEFORE UPDATE OR DELETE` triggers on all three tables that raise; `BEFORE TRUNCATE` statement triggers that raise; and `REVOKE UPDATE, DELETE, TRUNCATE` from the `app` role (create the `app` role in the migration if it doesn't exist)
- **Balance at DB level:** a `DEFERRABLE INITIALLY DEFERRED` constraint trigger on `ledger_entry` that, at commit, checks debits = credits per currency for the affected `transaction_id`, and that the transaction has at least 2 entries

**Acceptance criteria**
- [ ] Raw SQL `UPDATE ledger_entry ...` fails, run as both the `app` role and the owner
- [ ] Raw SQL `DELETE` and `TRUNCATE` fail on all three tables
- [ ] Inserting an unbalanced set of entries directly via SQL fails at commit
- [ ] An entry whose currency differs from its account's currency fails
- [ ] Entries are queryable by transaction and by account (tests)

> Enforcing this in TypeScript is insufficient. These tests must hit real Postgres through Testcontainers.

---

## P1.3: Double-entry posting

**API**
```ts
post(db, {
  idempotencyKey: string,
  description: string,
  occurredAt: Date,
  entries: { accountId, direction, amount: Money, entryType }[]
}): Promise<{ transactionId, seq, replayed: boolean }>
```

**Rules**
- Validate with Zod, then check balance in TypeScript, and then rely on the DB trigger as the backstop. Both checks are required
- Runs inside `withSerializableTx`
- Idempotency: compute `request_hash` from canonicalized input. If the key already exists with the **same hash**, return the original result with `replayed: true` and write nothing. If it exists with a **different hash**, throw `IdempotencyConflictError`
- Handle the race where two concurrent calls use the same new key: the unique violation must resolve to a replay, not an error

**Acceptance criteria**
- [ ] A balanced posting succeeds
- [ ] An unbalanced posting throws and writes nothing
- [ ] Same key + same payload → `replayed: true`, and the row count is unchanged
- [ ] Same key + different payload → `IdempotencyConflictError`
- [ ] 20 parallel `post` calls with the same key → exactly 1 transaction written
- [ ] **Concurrency:** 50 parallel distinct postings to one account → final derived balance equals the exact expected sum
- [ ] **Property:** random sequences of valid postings across random accounts → global debits = credits per currency after every sequence

---

## P1.4: Balance derivation

**Decision:** Phase 1 has **no cached balance**. Balances are always derived. Caching gets its own ticket once a measured query is slow.

**API**
- `balance(db, accountId, { asOfSeq?: bigint }): Money`. Sign follows the account's normal side (asset/expense = debit-normal; liability/equity/revenue = credit-normal)
- `trialBalance(db, { asOfSeq? })` → per-account balances plus a per-currency total that must net to zero

**Acceptance criteria**
- [ ] Balance at any historical `seq` equals the sum of entries up to that seq (property test with random postings)
- [ ] The trial balance nets to zero per currency after any random sequence
- [ ] Normal-side signs are correct for all 5 account types

---

## P1.5: Reconciliation model

**Migration:** `0002_reconciliation.sql`

**Concepts (decided)**
- `expected_settlement`: what our ledger intends to have happened with a provider. The fields are `provider_ref`, `amount`, `currency`, `expected_state`, `expected_by`, and a link to `ledger_transaction`. It is append-only, and changes to it are new rows with `supersedes_id`
- `provider_statement_line`: raw lines imported from a provider statement, stored with the raw payload as `jsonb`. Append-only, unique on `(provider, statement_id, line_ref)`
- `reconciliation_run`: `id`, `provider`, `statement_id`, `started_at`, `finished_at`, `input_hash`
- `reconciliation_discrepancy`: `run_id`, `kind` in (`missing`, `unexpected`, `amount_mismatch`, `state_mismatch`, `timing`), `expected_id?`, `statement_line_id?`, `details jsonb`

**Rules**
- Our ledger is authoritative for **intent**. The provider is authoritative for **settlement**
- Reconciliation **never** writes to ledger tables. The Kysely instance passed in should be typed so ledger writes don't compile, and a test must also assert that no rows appear in the ledger
- Re-running with the same inputs (same `input_hash`) returns the existing run and creates no duplicates
- Matching is on `provider_ref`. `timing` applies when a match is found but settled after `expected_by`

**Acceptance criteria**
- [ ] A synthetic statement fixture (in `tests/fixtures/`) yields exactly one discrepancy of each of the 5 kinds, and nothing else
- [ ] A clean statement yields zero discrepancies
- [ ] A re-run is idempotent
- [ ] The ledger row count is unchanged before and after any run

> This is the heart of the system. Slow is fine. Wrong is not.
