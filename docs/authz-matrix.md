# K3.6: authorization regression matrix

Stacked on K3.4/K3.5. Tests register the real identity/relationship registrars on the existing `buildApp`, use real Postgres, and assert both denial and lack of audit/state side effects. These are developer regression tests for K3-owned production, not an independent security sign-off. K0 remains the independent reviewer under the team split.

| Route | Intended boundary | Negative cases exercised |
|---|---|---|
| GET/HEAD /relationships | Live session, list only member rows | Missing/malformed/expired/revoked/superseded token; outsider list empty in K3.5 |
| GET/HEAD /relationships/:id | Live member of that specific relationship | All credential failures; wrong-family valid session → 404 |
| POST /relationships/invite | Live sender identity, strict input, required key/store, user/IP invite cap | All credential failures; body actor spoof and missing key/store in K3.5 |
| POST /relationships/:id/accept | Live member occupying recipient role | All credential failures; wrong-family → 404; inviter cannot accept; forged payload actor rejected |
| POST /relationships/:id/pause | Live member | All credential failures; wrong-family → 404; no state/audit effects |
| POST /relationships/:id/terminate | Live member | All credential failures; wrong-family → 404; no state/audit effects |
| POST /auth/session/revoke | Live bearer identity | All credential failures; actual revocation enforced in K3.4 |
| POST /auth/otp/request | Public, strict validation and phone/IP rate limit | Malformed input → 400; request phone/IP limits in K3.4 |
| POST /auth/otp/verify | Public, live single-use proof and phone/IP rate limit | Malformed input → 400; incorrect, expired, reused, locked proof denied in K3.4 |
| POST /webhooks/channel | Provider signature seam (currently a fake) | Missing/wrong signature → 401; signed array → 400; public test signature accepts an object |
| GET /health, /ready, /openapi.json | Intentionally public, no personal records | Health/spec remain public; readiness returns only `ok` |

Default HEAD handlers inherit GET authorization and are explicitly tested for both protected GET surfaces. A valid wrong user cannot read/accept/pause/terminate another relationship even with a syntactically correct ID and idempotency key. The matrix also asserts unchanged relationship status and audit rows after those denials.

This does not add recipient channel authentication, step-up or unimplemented request/approval routes. Extend the matrix when those actual routes exist. Host/root CI integration remains K2's pending work. Run the standalone identity/http Vitest config; counts and local/runtime limits accompany the handoff.

Revalidated against main `c778cfd`: the newly added webhook defaults to `FakeSignatureVerifier` even in production. The public `test-signature` value is a skeleton seam, not authentication. A real provider verifier over original request bytes and deployment gating are required before exposure; this matrix does not certify that seam for production.
