# K3.5: relationship HTTP review

Stacked on `k3/auth`. Production changes await K0 review and host wiring by K2. No domain functions, existing migrations, platform files or ledger code are edited.

## Routes and authorization

`registerRelationshipRoutes` registers list/read/invite/accept/pause/terminate. Boundary inputs and wire responses use Zod; errors use K2's existing envelope. Actor is derived from a live hashed/expiring sender session, never the payload. List/read/write membership covers either side of the relationship; outsiders and absent resources both get 404. Acceptance additionally requires the caller to occupy the recipient role in that relationship. Terminated history remains accessible to members, as specified.

Mutations call existing `findOrCreateUserByPhone`, `invite`, `activate`, `pause`, `terminate`. Listing is a scoped read query because main does not export a list helper. The registrar does not reimplement domain state machines. The independently demonstrated terminal-state race remains a domain-owner fix; these routes do not mask it with a second state machine.

Invites have durable user/IP rate buckets via identity_rate_bucket. Defaults are 10 per user and 30 per socket IP per minute, configurable for review. Response is only a relationship ID; it does not return a phone-registration flag, recipient phone or a newly-created-user flag. Invite duplicate/conflict messages are generic. No raw forwarded-header trust is added.

## Durable HTTP idempotency proposal

All writes require an actor-scoped idempotency key. `PostgresReceiptStore` persistently reserves a hash of actor/key and fingerprints operation, params and parsed payload. Changed key contents conflict; completed writes replay the result; another actor's same key remains independent. Pending writes return retryable 503 rather than running twice. No memory-only store is shipped.

Because existing domain transitions own their transaction, this adapter cannot atomically commit both a domain mutation and its receipt. It provides durable at-most-once admission, not exactly-once recovery. An unknown failure or crash between domain commit and receipt completion leaves the receipt pending and requires owner reconciliation; it never blindly re-executes the mutation. Definitive 4xx errors are replayable outcomes. K0 must approve a recovery policy or provide a domain transaction seam before this becomes production-ready.

`docs/http-idempotency-proposal.sql` is a review proposal, NOT an applied migration. Tests apply that exact file to real isolated Postgres so they exercise the real receipt adapter. Non-identity migration authority was not granted; no receipt table is added to db/migrations. When the store is omitted, routes fail closed with 503 before any mutation. K0 has been emailed the authorization/integration question.

## Generated OpenAPI and host integration

`buildHttpOpenApiDocument` extends the existing document using runtime Zod schemas for bodies, parameters, responses and idempotency headers. Metadata declares route/protocol semantics; JSON schema entries are generated, not hand-written. K2 must wire this generator into the existing `/openapi.json` handler and register the route registrars. Main's published document/host is intentionally untouched pending ownership coordination. Recipient WhatsApp acceptance still needs the channel owner's authenticated actor seam; no recipient password or OTP-only identity is invented for that channel.

## Verification

Real Fastify inject and Postgres tests cover cross-family read/accept/pause/terminate denial, outsider list isolation, member list/read, recipient-only acceptance, strict actor-payload rejection, success transitions, completed replay, changed-payload conflict, key isolation by actor, missing key, missing durable-store fail-closed, two-adapter contention and ambiguous-operation non-reexecution. Generated document tests check every route and schema-derived fields. Initial auth tests were written before implementation; route tests then exercised the implemented wrapper against the actual domain rather than copied logic. Independent red-team review of K3 production remains K0's responsibility.

No deployment, real SMS provider, CI/Testcontainers run or production latency claim is made. Standalone tests are not yet discovered by the root runner. Required checks and targeted test counts accompany the handoff.
