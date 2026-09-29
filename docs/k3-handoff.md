# K3 review handoff — 2026-09-29

All three received K0 emails were read in full; the final inbox check found no additional K0 messages. Nine ticket branches are prepared against main `c778cfd`. At initial handoff, no public push, PR, merge, or deployment had been performed. Automatic approval review initially blocked public publication without explicit disclosure authorization. Jose subsequently approved publishing the review branches and security findings to this public repository on 2026-09-29. Branch publication is authorized; production review and integration gates below remain in place. No merge or deployment is authorized by that publication approval.

## Delivery and application

The attached ZIP contains nine numbered Git patches in application order. Apply to a clean checkout of main `c778cfd` with `git am patches/*.patch`. The combined local branch is `k3/review-handoff`; production changes remain subject to K0 independent review. Individual local branches: `k3/redteam-ledger`, `k3/threat-model`, `k3/load-harness`, `k3/auth`, `k3/http-relationships`, `k3/authz-matrix`, `k3/abuse-tests`, `k3/secrets-audit`, `k3/supply-chain`. The auth, HTTP, matrix and abuse branches are stacked in that order; other tickets are independent.

## Validation

Node 22.23.3, pnpm 10.33.0, real PostgreSQL 16.14. Frozen dependency install succeeded. `make verify` passed typecheck, ESLint, formatting and 715 existing tests across 52 files. Standalone identity/HTTP config passed 21 tests across five files, including the new main webhook route. Standalone red-team config: eight passes and three reproducible failures. The existing root config does not discover either added suite, so root success does not resolve the security failures; K2 must wire the suites into CI. Local API production bundle build passed. No GitHub CI or Docker execution is claimed. Existing guardrail tests create temporary source fixtures; those were removed after completion.

Commands: `TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/raices_test make verify`; `pnpm exec vitest run --config apps/api/src/identity/vitest.config.ts`; `pnpm exec vitest run --config tests/redteam/vitest.config.ts`; `pnpm --filter @raices/api build`. Use the documented guarded test database and pinned runtime.

## Findings requiring action

- Ledger: an application-role write can append balanced legs to a committed transaction without changing its request hash. Reproduction fails as intended. Domain owner must fix it.
- Relationship: a stale activation read can revive a concurrently terminated invitation. Reproduction fails as intended; HTTP delegation retains this domain defect.
- Telemetry: raw span status messages bypass redaction. Current callers do not supply that message; helper contract remains unsafe. Also synthetic phone-like request IDs reach logs/spans, and query tokens reach request logs.
- Host: trusted forwarded IP handling needs K2 hardening. New identity/invite defaults use socket IP and resist forged X-Forwarded-For in tests.
- New webhook: the default public test signature is a documented skeleton, including in production. Real original-byte provider verification and deployment gating remain required.
- Supply chain: two moderate transitive advisories require owner review (details/reachability in report). New Docker smoke loops can exhaust without explicit failure; code inspection identifies possible false-green CI.

## Production review and integration gates

K3.4 adds identity-only migration 0008, persistent OTP limits/lockout, audited single-use verification and opaque revocable sessions. Provider delivery is injected; host wiring and secure server pepper provisioning belong to K2. Idempotent user provisioning precedes the audited OTP consume transaction and may leave a user after a losing race; it cannot issue an extra session, but K0 must review that seam.

K3.5 adds member-scoped routes and generated OpenAPI contracts without changing K2-owned app/openapi files. The HTTP receipt table is a proposal under docs, not an unauthorized migration. K0 must authorize the nonidentity schema and reconciliation policy; K2 must wire durable storage and registrars. Pending receipts fail closed after ambiguous execution: this is at-most-once admission, not exactly-once mutation. Missing store/key fails before writes. Do not expose these registrars until gates are resolved.

Threat model covers coercion as well as technical abuse. Real-PG load evidence shows hot-row retry contention and 7.2% failures at a 2-second budget in the recorded synthetic run; no universal budget recommendation. Timing samples are observations, not constant-time or remote-exploit proof. Secrets audit inspected actual exported Android JS, not a production APK or deployment secrets.

Next: K0 triages ledger/domain/observability findings, independently reviews identity and HTTP production, authorizes receipt schema/reconciliation, and delegates host/CI wiring and webhook/CI smoke hardening to K2. No production self-merge. No test self-merge because the adversarial suite intentionally remains red.
