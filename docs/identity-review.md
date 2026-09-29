# K3.4: identity review and host integration

Independent branch `k3/auth`, based on main `04b64f6`. Production work awaits K0 review. No actual OTP provider, deployment or secret is configured. The host app and root test runner are unchanged because K2 owns them.

## Implementation

- Sender OTP request/verification and session revocation registrars under `apps/api/src/http/identity.ts`; strict Zod schemas, existing error classes/envelope, no-store responses. Recipient channel identity remains the channel owner's responsibility; no recipient password or alternate recipient login is introduced.
- HMAC-SHA256 OTP digests bind to random challenge UUID using a required server-side pepper (at least 32 bytes). Six-digit codes use cryptographic randomInt, expire, and are consumed once by state/failure-count compare-and-swap inside an audited SERIALIZABLE transaction. Digest comparison is constant-time; total HTTP execution time is not claimed constant.
- Persistent phone and socket-IP counters work across service instances. Phone-wide audited failure lockout survives new challenges. Lockout, expiry, failed verification, code request, delivery failure, successful login and explicit session revocation use existing `transition()` and `audit_log`; there is no parallel audit sink.
- Opaque 256-bit session tokens are SHA256-hashed at rest, expiring and explicitly revocable. A generation on the identity principal invalidates prior device sessions atomically when verification issues a new session. The verification audit identifies the challenge that owns the new session; generation change is part of that same audited login.
- Migration `0008_identity.sql` adds identity/session tables only. It references existing domain identifiers and uses existing audit enforcement functions without modifying ledger/audit/relationship tables or existing migrations. SQL constraints cover digest shape, E.164, expiry, failure counts and session challenge uniqueness.
- Delivery errors cannot expose their message or code through responses/logs. Request response is the same accepted shape even when the delivery adapter fails; audit IDs allow operational diagnosis. A delivery failure requires a new request; this is an intentionally conservative behavior for review.

## Configurable security defaults for review

5-minute OTP expiry, 24-hour session expiry, 60-second rate windows, 3 requests/phone and 20/IP, 10 verifies/phone and 60/IP, lockout after 5 failed attempts for 15 minutes. These are conservative implementation defaults, not founder-approved business thresholds. No transfer/step-up thresholds are invented. K0 must review/tune them and the number-change/recovery policy before enabling production.

## Tests and verification

Run `pnpm exec vitest run --config apps/api/src/identity/vitest.config.ts`. Tests exercise real Postgres through the existing harness, not DB mocks: racing single use; stored digests; challenge/session expiry; revocation; new-device invalidation; persistent per-phone/IP limits across instances; lockout across challenges; and audit sabotage rolling back consumption and session issuance. HTTP tests exercise strict boundary validation, existing error mapping, no-store, accepted response without OTP, valid verification and bearer-required revocation. Typecheck and strict lint pass. The initial test-first run failed because service.ts did not exist.

## Explicit integration and remaining decisions

K2 must call `registerIdentityRoutes(app, { identity, clientIp })` in the API host and add the production tests to its Vitest projects. Default IP resolution uses the socket address, ignoring client-supplied forwarded headers. Behind Railway this may group all traffic under the proxy IP; K2 must supply a resolver restricted to trusted edge networks and prevent direct untrusted ingress. Reusing unrestricted `trustProxy: true` is unsafe.

Existing-user resolution calls the existing domain `findOrCreateUserByPhone` after a live matching code. This can provision/add the sender role before the audited session transaction; a losing verify race can leave an idempotently provisioned user, but no session. No domain helper is reimplemented. The domain helper cannot be nested inside `transition()` today. K0 should review whether an atomic domain provisioning seam is needed; it must be provided by the domain owner.

Pepper rotation invalidates OTPs, guards and rate bucket identifiers; decide operational rotation and cleanup without resetting an active abuse defense accidentally. Identity rate/event tables require a retention/cleanup policy before long-lived deployment. Full recovery from recycled phone/SIM takeover, independent step-up, KYC and configured payment limits remain explicit launch gates; OTP alone does not solve them.
