# K3.1: ledger and domain adversarial findings

Examined main `04b64f666ad6d4e9f7d2bc4558e87c588fb0af70`, 2026-09-29.
Executed with Node 22.23.3 and isolated Postgres 16.14 using the repository's guarded `TEST_DATABASE_URL` path. CI's Testcontainers path was not exercised locally. No database mocks, production edits, existing-test changes or skipped assertions.

Run: `pnpm exec vitest run --config tests/redteam/vitest.config.ts`.
The root runner does not discover this directory. A passing root CI run is not evidence that these regressions pass. Platform owner must integrate the standalone project; K3 has not edited their configuration.

## Confirmed regressions: 3 failing, 8 passing

### High: a terminated relationship is revived by a stale acceptance

`relationship-race.test.ts` intercepts only the timing of a real database result, never its contents. Acceptance reads `invited`; termination commits; acceptance proceeds and leaves `active`. `changeStatus` reads before opening `transition`'s transaction, and updates only by ID. Its declared edge describes an old snapshot. SERIALIZABLE cannot protect a read made outside that transaction. The database audit trigger only requires a matching destination state; it does not enforce terminality. This violates termination's documented promise. Fix belongs to the domain owner: read and validate current state in the same transaction as the write, with a stale-state guard, and retain this regression.

### High: app can extend an already committed ledger transaction

`ledger-adversarial.test.ts` posts a transaction, then as `app` inserts a balanced pair of additional entries referencing that transaction and forces deferred constraints. The insert passes. The test rolls back the additions after checking enforcement. Existing rows remain append-only, but the previously committed posting's membership and account impact can change while its request hash remains unchanged. Replaying the original key then returns a transaction whose complete entry set differs from the original request. A compromised app writer or a mistaken SQL path can bypass posting idempotency this way. This is not a reproduced production HTTP exploit. Ask the ledger owner to enforce that all legs belong to the transaction that initially commits their parent, without impairing compensating postings.

### Medium: span status messages bypass redaction

`redaction-adversarial.test.ts` passes synthetic phone, display name and amount to the exported `setStatus` helper and captures the real exporter payload. All values survive. Current production call sites use `setStatus("error")` without a message: confirmed unsafe helper behavior, not a demonstrated request-triggered leak. Recommend a fixed safe status vocabulary or omission of free-text status messages. Platform owner fixes telemetry.

## Attacks that did not break the tested guarantees

- Eight-way races between two different amounts on one idempotency key: one payload wins, conflicting calls fail, reordered matching replay adds nothing (10 generated cases).
- Historical entry-seq balances equal independent SQL sums, including amounts above 2^53 and at signed-64-bit limits, across USD and GTQ (10 generated posting sequences).
- Full trial balance remains zero per currency after generated postings. A partial entry-seq cutoff can split a posting and legitimately produce a nonzero trial balance; that is not reported as an imbalance bug.
- App and owner UPDATE/DELETE (even matching zero rows) and TRUNCATE CASCADE of ledger and audit tables are refused (24 statements).
- Cross-currency cancellation is rejected before posting.
- Signed allocation conservation, exact rational rounding bounds and decimal parsing survive 3,000 generated cases including 100-digit integers. Money arithmetic may exceed SQL bigint; DB-range validation is a separate boundary.
- Plain-object and array redaction survives 100 generated nesting tests to depth 30 through the real Pino configuration.

## Limits and pending coverage

This revision contains migrations 0001–0004 only. Plan versions, requests, approvals and domain transaction records are not yet implemented, so immutable plan-version and approved-request double-spend tests cannot target a real artifact yet. Do not substitute mock copies of future domain code. Root `make verify` omits this suite. Failing regressions are deliberately preserved and this PR must not self-merge until the owners resolve them and the suite runs in CI.
