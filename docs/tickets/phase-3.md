# Tickets: Phase 3 — The channel

**Author:** CTO · **Status:** Ready
Phase 2 built the domain. Phase 3 connects it to WhatsApp, so a recipient can request money and a sender can approve it over messages instead of fixtures. Still no real money: settlement stays mocked until Phase 5.

The interfaces already exist — K2.19's channel adapter and K2.28's webhook skeleton, both with fakes. Phase 3 makes them real and wires them to the domain.

| ID | Title | Builder | Blocked on |
|---|---|---|---|
| P3.1 | Durable inbound dedupe | Claude Code | — |
| P3.2 | Conversation state | Claude Code | P3.1 |
| P3.3 | Inbound message → request | Claude Code | P3.2 |
| P3.4 | Outbound dispatch + delivery state | Claude Code | P3.3 |
| P3.5 | Approval over the channel | Claude Code | P3.4 |
| K3.22 | Real provider signature verification | K3 | — |
| K2.51 | Template registration + rendering | K2 | — |

Claude Code owns P3.x. Nobody else touches `db/`, `apps/api/src/ledger/`, `packages/money/`, or the Phase 3 domain modules.

**The governing fact of this phase:** the recipient is on WhatsApp, on a cheap phone, possibly with no data left, possibly sharing the phone with someone else. Every design decision answers to that, not to what is convenient for us.

---

## P3.1: Durable inbound dedupe

**Migration:** `0009_channel_inbound.sql`

K2.28's dedupe is in memory, which means a restart replays every message it had already seen. At-least-once delivery plus a forgetful store equals double-processing, and in this system double-processing a message is how a request gets created twice.

- `channel_inbound_message`: provider, provider_message_id, received_at, raw payload jsonb, processing state, processed_at. Unique on (provider, provider_message_id)
- Append-only, same discipline as the ledger: statement-level triggers, revoked grants
- Dedupe claims the id in the same transaction as the processing it guards. A claim that commits while the work rolls back is the bug this table exists to prevent — write the test that proves it cannot happen
- Raw payload stored verbatim for audit. It may contain PII, so it is never logged, never put in a span, and never echoed in an error

**Acceptance**
- [ ] Same provider_message_id twice → processed once, second is a no-op, no error
- [ ] Process crashes mid-work → the claim rolls back with it and redelivery succeeds
- [ ] 20 concurrent deliveries of one message → exactly one processing
- [ ] Mutation-test the unique constraint and the triggers

---

## P3.2: Conversation state

**Migration:** `0010_conversation.sql`

A recipient types "necesito 200 para la renta" and the next message is "sí". Something has to remember what "sí" refers to, without that memory becoming a way to confuse the user into confirming something they did not mean.

- `conversation`: relationship_id, channel, state, pending_payload jsonb, expires_at, last_message_at
- States through P2.1's `transition()`, audited like everything else
- **Pending context expires.** Default 30 minutes. An affirmative arriving after expiry starts over; it never silently attaches to a stale proposal. This is a safety rule, not a cleanliness one — a "sí" that lands on the wrong request is money moving without consent
- One active conversation per relationship per channel. Enforce it in the database
- A phone may belong to a user with several relationships. If an inbound message is ambiguous about which relationship it concerns, the system ASKS. It never guesses

**Acceptance**
- [ ] An affirmative after expiry does not resume the stale request
- [ ] Concurrent messages on one conversation serialize; no interleaved state corruption
- [ ] An ambiguous sender (multiple relationships) produces a disambiguation prompt, not a guess
- [ ] Every transition has an audit row

---

## P3.3: Inbound message → request

Mapping a message to a P2.4 request.

- Parse intent and amount from Spanish free text. Amounts in Guatemalan conventions ("Q200", "200 quetzales", "doscientos")
- **Parsing is a pure function**, same rule as the tier classifier: no DB, exhaustively table-testable, lint-enforced
- **When confidence is low, CONFIRM — never assume.** The confirmation states the amount, the recipient and the purpose in plain Spanish, and requires an explicit yes
- Ambiguous or unparseable input gets a human-readable reply, never an error code and never silence
- The created request runs through P2.4 classification unchanged. The channel is an input path, not a shortcut past the rules
- No AI in this ticket. Deterministic parsing only. The assistant layer is Phase 4, and it will never have write access

**Acceptance**
- [ ] Table test: at least 30 real-world Spanish phrasings, including misspellings, no accents, and mixed numerals
- [ ] Any amount that parses ambiguously triggers confirmation rather than a request
- [ ] A declined or expired confirmation creates nothing — assert zero rows
- [ ] Parser has no database import (lint rule)

---

## P3.4: Outbound dispatch + delivery state

- Every outbound message is idempotent by a caller-supplied key. A retry after a timeout must not send twice — a duplicate "your money arrived" is a trust failure
- Delivery state machine: queued → sent → delivered → read, plus failed. Provider callbacks update it; states are separate fields, never collapsed
- Outbound goes through pg-boss with bounded retries and a dead-letter path. A permanently failing message surfaces; it does not retry forever in silence
- **Message content carries no more than it must.** A lock-screen preview is visible to whoever holds the phone, and in this product that may be someone the user is hiding money from. Amounts and names appear only after the recipient opens the thread
- Respect WhatsApp's 24-hour session window: inside it, free-form; outside it, approved templates only

**Acceptance**
- [ ] Same idempotency key twice → one send
- [ ] Provider timeout then retry → one send, verified against the fake provider's record
- [ ] Delivery callbacks move state correctly; out-of-order callbacks do not regress it
- [ ] A permanently failing message lands in the dead-letter path with its reason
- [ ] No amount or name in any notification preview field

---

## P3.5: Approval over the channel

The sender approves from WhatsApp, not only the app.

- An approval arriving over the channel produces exactly the same P2.5 transaction and ledger posting as an in-app approval. One path, one set of rules
- The approving party must be authenticated to the standard P2.5 requires. **A phone number is an identifier, not an authentication.** If channel identity is weaker than the in-app session, the approval needs a step-up, and this ticket states which
- Replay of an approval message approves once
- The audit row records the channel the approval came through, because "how was this approved" is the first question anyone asks about a disputed transaction

**Acceptance**
- [ ] Channel approval and in-app approval produce identical ledger effects
- [ ] Replayed approval message → one transaction, one posting
- [ ] An approval from a number not bound to the sender is refused and audited
- [ ] Audit rows carry the channel

---

## K3.22: Real provider signature verification

- Replace the fake verifier with the provider's real HMAC scheme. Constant-time comparison
- Timestamp/replay window enforced; an old but validly signed payload is rejected
- Secret from config, never committed, never logged, and the service refuses to boot without it in production
- Fuzz the verifier: truncated, oversized, wrong-algorithm and hostile payloads must be rejected without crashing the process

## K2.51: Template registration + rendering

- Register the K2.20 catalog's templates with the provider, tracking approval state per template
- A template awaiting approval cannot be sent; attempting it is a clear error, not a silent drop
- Render with typed variables; a missing or extra variable fails before dispatch
- Spanish is primary. Template copy is Jose's, not ours — where wording is missing, list it and ask
