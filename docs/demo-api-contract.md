# K3.16 / K3.17 demo API handoff

This is fake-money demo plumbing, not a payment-rail integration. `buildApp({demoApi})` installs the real policy guard before host routes, then identity, request and screen routes. The default CLI still starts the skeleton unless its owner supplies these dependencies. Production startup needs an explicit trusted client-IP resolver. Real provider verification, durable HTTP receipts, credentials and deployment are not supplied here.

## Request API

All paths begin `/relationships/{id}/requests`. POST collection submits; GET collection lists; GET `/{requestId}` reads; POST `/{requestId}/approve` and `/decline` resolve. Every write requires a bearer session and `Idempotency-Key`. Submit requires the relationship recipient; approve/decline require its sender. Reads require membership. Cross-relationship IDs return 404. Writes require active relationships.

Submit: `{amount:{minor:"12345",currency:"USD"},categoryId:null,description:"...",isEmergency:false}`. Minor units are canonical decimal integer strings because JSON numbers cannot carry all supported integer values. No formatted amounts or floats. Only USD/GTQ. Caller cannot set requestedBy, spendToDate, recurringRule, tier, channel, approver or posting accounts. Submission uses domain month-to-date spend; no recurring schedule is invented.

Approve accepts `{}` and returns transactionId, ledgerTransactionId, replayed. It calls `approveAndRecord`, not the older request-only approval function. The trusted `postingFor(relationshipId,currency)` callback is mandatory for approval and missing configuration returns 503. It must map to approved server-owned accounts; no mapping exists in the domain. The HTTP store coalesces process-local retries; P2.5 protects the posting across HTTP restarts. Submit/decline receipts remain process-local until the durable implementation is supplied.

Decline accepts `{reason}` (trimmed, nonblank, at most 200 characters), returns 204. Logs and span attributes redact reason/declineReason/decline_reason/description. These routes convert driver errors directly to generic envelopes instead of forwarding driver detail to host logging. Span status-message redaction remains K2 issue #101.

## Screen reads

`GET /screen/relationships`, `/screen/requests`, `/screen/history`, `/screen/transactions/{transactionId}`. Membership is included inside each SQL query. Each endpoint runs one data query after session authentication, with no row-by-row lookups. Lists return `{items,nextCursor}` and support `limit` (1–100, default 30), `before` (opaque seq string). Order uses seq descending. Requests/history currently share a request-based projection, so pending and declined records do not disappear merely because no transaction exists. History is ordered by request creation sequence, not settlement time; client must not imply otherwise.

Runtime Zod response schemas and OpenAPI expose designed payloads, not raw table serialization. Detail retains separate intentState and settlementState; unknown fee, FX and recipient amount are null, not zero. No provider reference or internal ledger-account IDs are exposed.

## Fixture source map and explicit gaps

| Mobile fixture fields | Real source or absence |
| --- | --- |
| Relationships id, displayName, phoneE164, status, invitation/expiry | Relationship row plus counterpart user; expiry is invited_at + 14 days. Name may be null; do not invent one. |
| Transaction purpose, amountText, timestamp, categoryLabel, tier | Request description, exact amount/currency, createdAt, category name/icon, tier. Client formats/localizes. |
| Transaction status, stageText | requestStatus plus optional separate transaction intent/settlement states. Client renders labels; no invented combined state or arrival estimate. |
| Approval recipientName, relationship | Relationship display name; no familial relationship descriptor exists. |
| Approval planMatchText, planAvailableText | No complete read model supplied; omit. Tier is available but is not a promised available balance. |
| Home greetingName/dateText | No user name column; omit greeting name. Client derives local date. |
| Home balances and goalCard | No user-to-account mapping or goal model; absent. Never substitute demo fixture balances in live mode. |
| Home pendingCount/recentActivity | Paged screen requests expose status/activity; page count is not total count. Exact global pending count not provided. |
| Goal title/subtitle/saved/remaining/total/progress/stages | No goal domain; absent. |
| Assistant messages/refCard/suggestions | No conversation read model; absent. UI-only suggestions must be labeled as such, not fetched history. |
| History group titles | Client groups ISO instants in its locale/timezone. |

The old mobile comment saying backend formats money conflicts with Claude's latest instruction; the API returns raw exact units and the client formats.

## Verification and outstanding gates

TypeScript/lint and local non-DB host/policy/idempotency checks can run here. DB integration tests require Postgres16/Testcontainers in CI, unavailable locally. Publishing is currently blocked by automatic approval-review usage quota. No new branch is claimed CI verified. Main now includes the #106 fixes for #99/#100. Claude requires #103 regression discovery green on main before deployment. Host injection is implemented but startup configuration, account mapping and a live URL still require their owners.
