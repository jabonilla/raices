# Tickets: Phase 2 — Domain model

**Author:** CTO · **Status:** Ready
Phase 1 (ledger foundation) is complete. Phase 2 builds the domain on top of it: who the parties are, what they agreed to, and what they're asking for. No channels, no settlement provider, no screens. Those are Phase 3.

One PR each, strictly in order. Builder: Claude Code. K2 does not take Phase 2 tickets.

| ID | Title | Blocked on |
|---|---|---|
| P2.1 | Audit log + state machine helper | — |
| P2.2 | Users + relationships | P2.1 |
| P2.3 | Money plans + immutable plan versions | P2.2 |
| P2.4 | Requests + trust tier classification | P2.3 |
| P2.5 | Transaction record (intent vs settlement) | P2.4 |

Source of truth for semantics is `docs/immigrant-wealth-protection-PRD-v2.md`, sections 7 to 10. Where this ticket and the PRD disagree, stop and ask. Do not invent business rules.

---

## P2.1: Audit log + state machine helper

**Migration:** `0003_audit.sql`

CLAUDE.md rule 5 says every state transition writes an audit event. Phase 2 adds four state machines, so the mechanism comes first and they all use it.

**Build**
- `audit_log`: `id`, `seq` bigserial, `actor_id`, `actor_kind` (`user` | `system` | `agent`), `action`, `entity_type`, `entity_id`, `channel`, `before_state` jsonb, `after_state` jsonb, `created_at`. Append-only, enforced exactly as the ledger is: statement-level triggers plus revoked grants
- A generic `transition()` helper: takes the current state, a target state, and a transition table; rejects an undeclared transition; writes the audit row and the state change **in the same transaction**. Writing one without the other must be impossible, not merely discouraged
- Audit rows carry no PII values. Store entity ids and state names, never phone numbers, names, amounts in free text

**Acceptance criteria**
- [ ] UPDATE, DELETE and TRUNCATE on `audit_log` all fail, as both `app` and owner
- [ ] An undeclared transition throws and writes nothing
- [ ] A test proves a state change cannot commit without its audit row: sabotage the audit insert and confirm the state change rolls back
- [ ] Property: for any random legal transition sequence, `audit_log` row count equals the number of transitions

---

## P2.2: Users + relationships

**Migration:** `0004_users_relationships.sql`

**Rules (PRD §9)**
- `user`: `id`, `phone` E.164 unique, `roles[]`, `locale` (default `es`), `preferred_channel`, `identity_assurance_level`, `kyc_status`
- `relationship`: many-to-many, `user_a_id`, `user_b_id`, `role_of_a`, `role_of_b`, `status` (`invited` | `active` | `paused` | `terminated`), `invited_at`, `activated_at`
- **Never assume one sender per recipient.** A sender may invite many recipients; a recipient may accept from many senders. Both directions get a test
- A phone number already in the system links to the existing user rather than creating a duplicate
- Invitations expire after 14 days and may be resent. Expiry is derived from `invited_at`, not a background job that could silently stop
- Status transitions go through P2.1's `transition()`

**Acceptance criteria**
- [ ] One sender with 3 recipients, and one recipient with 3 senders, both work
- [ ] Inviting an existing phone number creates a second relationship, never a second user
- [ ] A relationship cannot be created with `user_a_id = user_b_id`, enforced in the DB
- [ ] An expired invitation cannot be activated; resending produces a fresh window
- [ ] Every status change has a matching audit row
- [ ] Phone numbers are stored in E.164 and rejected otherwise

---

## P2.3: Money plans + immutable plan versions

**Migration:** `0005_plans.sql`

**Rules (PRD §9)**
- `money_plan` points at a `current_version_id`. `plan_version` is **immutable**: any change creates a new version with an incremented `version_number`
- `category`: belongs to a plan version, has `name`, `icon`, optional `monthly_cap` (Money), `is_system`. System categories: Housing, Food, Business, Savings, Other
- Caps are `Money` from `packages/money`. Never `number`
- A request references the category of the version in force when it was made, so historical requests never re-point at a newer version

**Acceptance criteria**
- [ ] UPDATE and DELETE on `plan_version` and `category` fail at the DB level
- [ ] Editing a plan creates version N+1 and leaves version N byte-identical
- [ ] `version_number` is unique per plan and gapless, proven under concurrent edits
- [ ] A category cap of 0 and a null cap are distinguishable, and both are tested
- [ ] Cap amounts round-trip through `Money` with no precision loss

---

## P2.4: Requests + trust tier classification

**Migration:** `0006_requests.sql`

**Rules (PRD §7 and Feature 1)**
- `request`: `relationship_id`, `requested_by`, `amount` (Money), `category_id`, `description` (≤200 chars), `tier`, `is_emergency`, `channel_of_origin`, `status` (`pending` | `approved` | `declined` | `expired`), `resolved_by`, `resolved_at`, `decline_reason`
- **Tier classification is a pure function** in its own module: inputs are the request, the plan version in force, spend to date in that category, and any recurring rule. Output is one of `recurring`, `planned_investment`, `emergency`, `unrecognized`. No database access inside it, so it is exhaustively table-testable
- A request in a recurring category that **exceeds** the approved amount is flagged for manual approval, never auto-declined
- Declining requires a reason
- **A declined request never becomes a transaction.** This is PRD invariant 3 and gets its own test
- Status changes go through `transition()` and write audit rows

**Acceptance criteria**
- [ ] A table-driven test covering every tier with boundary cases: exactly at cap, one minor unit over, zero spend to date, no plan at all
- [ ] Over-cap in a recurring category classifies as `unrecognized` and stays `pending`, never auto-declined
- [ ] Declining without a reason is rejected
- [ ] A test asserts no ledger transaction exists for any declined request
- [ ] Classification is deterministic: the same inputs give the same tier, as a property test
- [ ] The tier function has no database import, enforced by a lint rule

---

## P2.5: Transaction record

**Migration:** `0007_transactions.sql`

The join between an approved request and the ledger.

**Rules (PRD §9, CLAUDE.md rule 4)**
- `transaction`: `request_id`, `relationship_id`, `amount`, `currency`, `intent_state` (`committed` | `cancelled`), `settlement_state` (`not_started` | `instructed` | `in_flight` | `settled` | `failed` | `reversed`), `approved_by`, `approved_at`, `assurance_level_at_approval`, `settlement_provider`, `provider_reference_id`, plus fee and FX fields
- **Intent state and settlement state are separate columns.** Never derive one from the other, never a combined status enum. A test must fail if anyone adds a column or view that collapses them
- Approving a request creates the transaction **and** its ledger posting in one transaction, using P1.3's `post()` with the request id as the idempotency key. Approving twice must produce exactly one posting
- No settlement provider call yet. `settlement_state` stays `not_started` in this ticket

**Acceptance criteria**
- [ ] Approve is idempotent: 20 parallel approvals of one request produce one transaction and one ledger posting
- [ ] A failed ledger posting rolls back the transaction row; no orphan can exist either way
- [ ] Every combination of intent and settlement state that the state machines allow is reachable in a test, and disallowed ones are rejected
- [ ] Cancelling intent after settlement has started is rejected with a clear error, not silently allowed
- [ ] Audit rows exist for every transition on both fields
