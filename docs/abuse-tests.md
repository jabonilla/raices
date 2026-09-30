# K3.7: abuse and rate-limit tests

Tests use the real HTTP registrars, domain helpers and isolated Postgres. These are regression tests on K3-owned production, not independent approval. K0 must review the production behavior separately.

## Exercised results

- Known and unseen recipient phones return the same OTP-request (202, challengeId only) and invitation (201, relationship ID only) contracts over 40 paired samples each. No registration flag, phone, display name or amount is returned.
- Wrong, missing and expired verification proof produce the same 401 code/message envelope (fresh request IDs are intentionally different).
- OTP request and verification caps remain effective even when the API host trusts forwarded headers and an attacker rotates X-Forwarded-For. The new registrars use the socket IP by default, so arbitrary headers do not create fresh buckets.
- Invite rate limits run before recipient provisioning: a rate-limited phone has no new user row. Rotating forwarded headers does not bypass the cap.
- K3.4 tests additionally prove audited brute-force lockout and that a new challenge cannot reset phone-wide failures. Persistent counters apply across service instances.

## Timing observations, not a timing-safety assertion

One local run, 40 known/unseen samples per route, alternating order, Node 22.23.3 / Postgres 16.14:

| Surface | Known p50 / p99 | Unseen p50 / p99 | Probability a known sample was slower than an unseen one |
|---|---|---|---:|
| OTP request | 2.38 / 12.53 ms | 2.23 / 4.60 ms | 0.494 |
| Invite | 4.41 / 9.83 ms | 3.76 / 7.29 ms | 0.693 |

OTP request does not look up registered-user state and this sample showed no useful directional timing separation. Invite does call `findOrCreateUserByPhone`; existing numbers take the conflict/update path while unseen numbers take insertion. The measured 0.693 separation is a **timing concern**, not proof of a remotely exploitable oracle and not evidence of timing indistinguishability. No wall-clock equalization is silently added. K0 should arrange repeated, randomized timing tests under realistic network/deployment load and review a non-enumerating invite dispatch/acceptance design if the difference persists. Returning the same JSON is necessary but does not establish timing privacy.

No statistically powered equivalence test, real SMS/BSP timing, distributed proxy deployment, long-running credential-stuffing campaign or third-party penetration test was run. The test prints timing distributions and probability-of-superiority measurements; it does not mark a noisy small sample as a security guarantee. Phone ownership, SIM swap and recovery risks remain in the threat model.
