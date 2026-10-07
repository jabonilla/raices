# K3.3: contention harness and retry budget

Run with Node 22 and pnpm 10.33:

```sh
LOAD_OPERATIONS=500 LOAD_WORKERS=64 LOAD_BUDGET_MS=2000 pnpm exec tsx tests/redteam/load-harness.ts
```

Default is 300 operations, 32 workers, 2,000 ms budget. Uses `startTestPostgres`: Postgres 16 Testcontainers by default, or the existing guarded isolated `_test` database path. Never uses `DATABASE_URL`. Creates temporary accounts and a test-only mutable state table, verifies trial balance and successful hot-state increments, closes pools and drops its database. Output has per-scenario attempt histograms, total and successful p99 latencies, failure counts/rates, actual wall time and invariant checks. No customer data or secrets in output.

## Measurement, 2026-09-29

Main `04b64f6`, Node 22.23.3, Postgres 16.14 on the same local host. 500 operations per scenario, 64 worker connections, production full jitter. The hot-domain-row workload deliberately holds a read/write conflict for 5 ms; it is a synthetic approximation of mutable domain work, not an existing balance cache or an alleged ledger bottleneck.

| Scenario | Failure rate at 2s | p99, all outcomes | Attempts |
|---|---:|---:|---|
| Many sender accounts → shared clearing account, distinct keys | 0 / 500 (0%) | 117.97 ms | All 500 took 1 |
| Duplicate replay bursts, common key per worker-sized group | 0 / 500 (0%) | 64.31 ms | 305 took 1; 195 took 2 |
| Shared mutable domain row, 5 ms held read/write | 36 / 500 (7.2%) | 2,013.92 ms | 1–24; full histogram in JSON |

Both ledger scenarios remained balanced; hot-state increments equalled the number of successful commits. Failures were specifically `SerializationRetryExhausted`, never silently dropped or generic errors. The budget bounds when retries begin, not the duration of an in-flight commit, so p99 can exceed 2s slightly.

## Recommendation

The tested append-only posting paths did not need a wider budget. A universal assertion that 2s is adequate is unsupported: it exhausted for 7.2% of writes in the deliberately hot mutable-state scenario. Keep retryable 503 behavior and client idempotency. Before production, measure representative mutable domain operations on deployment-sized hardware, set an acceptable failure/latency target, and reduce hot-row conflict where possible rather than widening budgets blindly. A longer budget permits more wait; it does not increase serial capacity. No production default is changed here.

A local synthetic sample cannot establish a production p99 or capacity. There is no real network latency, partner call, realistic user arrival distribution, deployment resource limit or long sustained soak in these runs. Pool size and simultaneous harness runs also affect results. The raw measurements accompany the handoff so the observer is auditable.
