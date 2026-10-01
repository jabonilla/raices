# K3.11 — HTTP response replay

The authorization router installs a preHandler/onSend middleware for every write
method in its owned scope. A printable caller-supplied `Idempotency-Key` of 1–200
characters is mandatory. Reads and OPTIONS are exempt. The caller should generate
a random key when composing the operation and retain it through retries.

Admission is atomic behind `HttpIdempotencyStore`. The supplied in-memory store
coalesces concurrent requests, replays the serialized body, status, and selected
response headers, and returns 409 for the same actor/key with different method,
route, parameters, query, body or authorization credential. JSON object key order
does not change the fingerprint. Authenticated users have separate namespaces;
public auth routes use an explicit public namespace. Keys/fingerprints are HMACs
with a server-side secret, so raw phone numbers, codes and bearer tokens are not
receipt keys. Successful auth response bodies necessarily contain their token;
receipts must stay server-side, never be logged or exposed as diagnostics.

Limits: one process, 10,000 entries, completed response retention 15 minutes.
At capacity the store refuses new work with 503; it never evicts an active write.
A concurrent replay waits at most two seconds, then returns 503 without re-running
the operation. Abandoned in-flight entries remain blocked. Restarts, another
replica, or expired completed receipts can allow re-execution: this is NOT a
durable exactly-once guarantee. A durable store, coordinated commit protocol,
retention policy and shared fingerprint secret are Claude Code's work. Existing
K3.5 durable-admission proposal remains untouched and is still required by the
relationship handlers. No schema or domain changes are part of this ticket.

Authorization executes before receipt lookup on every request. Revoked or expired
credentials cannot read a cached success. Consequently, replaying a successful
session revoke with the now-revoked token returns 401, not the earlier 204. This
is the conservative choice; K0 must decide whether a narrowly scoped revoked-token
receipt proof is needed. We do not bypass authorization to fulfill replay.

Response support is JSON/text/empty bodies from current owned routes, not streams
or arbitrary binary downloads. Transport/request-specific headers (Date,
Content-Length, request IDs) are regenerated; Content-Type, Cache-Control,
Location and Retry-After are stored. Error envelopes are replayed as serialized,
including the original diagnostic request ID. Unknown errors are retained as
responses, not silently re-executed.

Configure a store through `installAuthorization(..., { httpIdempotency: ... })`
BEFORE registering route modules. The default is the requested in-memory
implementation. Host/webhook integration outside the owned scope is pending K2;
this does not replace the webhook's provider-message deduplicator.

Exercised locally: concurrent collapse, canonical JSON replay, payload/route and
credential conflicts, actor isolation, capacity/in-flight protection, error
replay, empty 204 replay, and pending timeout without a second execution. Full
DB-backed integration and `make verify` remain blocked by this runtime's lack of
a usable Postgres 16/Docker environment; do not merge on these unit tests alone.
