# Product Requirements Document
## Immigrant Wealth Protection App — MVP (v2.0)

**Status:** Revised — supersedes v1.0
**Audience:** Engineering, UX, Founder
**Last updated:** August 2026
**North star metric:** Lifetime Value (LTV)

---

## Changelog from v1.0

| # | Change | Reason |
|---|---|---|
| 1 | WhatsApp and SMS added as **full transaction channels** with requirements and acceptance criteria | v1.0 omitted them entirely; the design system defines them as primary surfaces |
| 2 | **Feature 0 (Pairing)** added as P0 | The two-sided cold start was named as blocking but had no spec |
| 3 | **Feature 6 (Sender onboarding & funding)** added as P0 | No spec existed for how money enters the system |
| 4 | **Feature 7 (Disclosures, receipts, cancellation)** added as P0 | Consumer protection obligations were absent |
| 5 | Relationship model changed to **many-to-many** | 1:1 is wrong for this market |
| 6 | Custody model made explicit as **A/B/C, undecided** | v1.0 contained a contradiction between §5 and §12 |
| 7 | Data model expanded from 1 entity to 12 | v1.0 specified `Transaction` only |
| 8 | AI acceptance criteria rewritten to be **testable** | "Does not hallucinate" is not a criterion |
| 9 | Intent state and settlement state **separated** | Collapsing them makes reconciliation impossible |
| 10 | Undefined behaviors specified (§10) | Multi-party, off-ramps, partner failures, limits, termination |
| 11 | Fees and FX added as explicit open decisions with required spec | Undocumented anywhere in v1.0 |

Sections 1–2 (problem, personas) are unchanged from v1.0 and are abbreviated here. Refer to v1.0 and the behavioral research document for full treatment.

---

## 1. Problem statement (abbreviated)

Immigrants in the US send money home toward long-term goals — property, business, housing. The moment funds cross the border, the sender loses visibility and control. A local contact manages the money with no oversight structure. Money is routinely misused or mismanaged, not always maliciously, but systematically.

This is a principal–agent problem. Remittance platforms move money; none protect its purpose. First market: Guatemala.

---

## 2. Users (abbreviated)

**Sender** — US-based, blue-collar, sends $200–600/month, has app-capable smartphone, long-term goal tied to home country.

**Recipient** — Guatemala-based family member or trusted contact. Often unbanked. Mid-to-low-tier Android, possibly shared. Data measured in megabytes. 3G typical, 2G floor. Changes phone numbers frequently. **Will not install an app.**

---

## 3. Product vision & scope

A financial companion for the full immigrant journey. Not a remittance app. Not a bank.

**Core mechanic:** outcome-based remittance. Every transfer carries a stated purpose. Transactions are auto-approved, flagged, or held based on a plan both parties agreed to.

**Channel model — structural, not cosmetic:**

| Channel | Primary user | Role |
|---|---|---|
| App | Sender | Administration — full financial picture, plan management, history, AI |
| WhatsApp | Both | **Full transaction surface** — request, approve, confirm, notify |
| SMS | Both | Fallback with identical capability, keyword-driven |

**Governing principle:** the app is additive, not required. A recipient who never installs anything is a full participant. A sender who only uses WhatsApp is a full participant.

---

## 4. Goals

**User**
1. Senders see what every dollar was for, without asking.
2. Recipients request funds quickly without feeling interrogated.
3. Fewer money conflicts, because accountability is structural rather than personal.
4. Senders feel confident sending larger amounts.

**Business**
5. Establish daily-use habits before the high-stakes moment.
6. Build a financial profile supporting Stage 2 monetization.
7. Reach retention signal sufficient for pre-seed.

---

## 5. Non-goals

1. **Building our own payment rails.** A licensed partner handles fund movement, FX, KYC/AML, and payout.
2. **Replacing WhatsApp as a messaging app.** We use it as a transaction channel; we do not build general messaging.
3. **Other corridors.** Guatemala only.
4. **Dashboards and analytics.** Clean list views only at MVP.
5. **Escrow and human verification.** P1 — architected for, not built.
6. **Recipient native app as a requirement.** Optional graduation only.

> **Removed from v1.0 non-goals:** "The MVP does not process payments or hold funds." That statement contradicted the programmable-release requirement in §12 and is replaced by §6 below.

---

## 6. Custody model — OPEN DECISION

The single most consequential unresolved decision. Three viable models:

| | Funds held by | Settlement on approval | Regulatory weight |
|---|---|---|---|
| **A** — fund-at-approval | Nobody | Days (ACH-class) | Lightest |
| **B** — we hold balance | Us | Instant | Heaviest (stored value) |
| **C** — partner holds, we instruct | Partner, in sender's name | Instant | Moderate |

**Resolution path:** fintech counsel memo + settlement partner selection. See the partner evaluation matrix.

**Engineering directive:** build custody-agnostic. All settlement behavior sits behind a `SettlementProvider` interface with declared capabilities. No business logic branches on partner identity.

```
SettlementProvider {
  supportsHeldBalance: bool
  supportsProgrammableRelease: bool   // GATE — required
  supportsPartialRelease: bool
  supportsReversal: bool
  settlementLatency: instant | same_day | multi_day
  payoutMethods: [bank_deposit, cash_pickup, mobile_wallet]
}
```

**Product promise that survives all three:** urgent requests get the sender's **attention** faster, never a guarantee that money arrives faster. All copy must reflect this. If we land on B or C, we over-deliver.

---

## 7. Core mechanic: trust tiers

| Tier | Definition | Mechanism |
|---|---|---|
| **Recurring** | Pre-approved, on schedule, within parameters | Auto-approved |
| **Planned investment** | Large, milestone-gated | Held, released on verification *(P1)* |
| **Emergency** | Marked urgent by recipient | Priority notification, one-action approval, logged |
| **Unrecognized** | Outside plan or over cap | Flagged for approval |

**Framing:** a shared agreement both parties opt into. Product language reinforces protection, never suspicion.

---

## 8. Requirements — P0

---

### Feature 0: Pairing & Recipient Onboarding

**Description:** The sender invites a recipient. The recipient becomes an active participant over WhatsApp or SMS with zero app installation.

**Why P0:** The product is worthless one-sided. This is the hardest problem in the product and had no spec in v1.0.

**Acceptance criteria**

- [ ] Sender can invite a recipient by entering a phone number and a display name
- [ ] System sends a WhatsApp invitation; if WhatsApp delivery fails, falls back to SMS within 60 seconds
- [ ] Invitation message opens with the **sender's name**, never the product name
- [ ] Recipient accepts by replying or tapping a button — no app install, no password, no email
- [ ] Recipient onboarding completes in **≤3 message exchanges**
- [ ] On acceptance, a `Relationship` is created and both parties are notified
- [ ] Recipient can decline; sender is notified without a punitive framing
- [ ] Invitations expire after 14 days and can be resent
- [ ] A sender may invite **multiple recipients**; a recipient may accept invitations from **multiple senders**
- [ ] Recipient's language defaults to Spanish
- [ ] Recipient can request help at any point in onboarding via `AYUDA`

**Edge cases**
- Recipient's number is already a sender in the system → link to existing user, do not create a duplicate
- Recipient's number is already paired with another sender → permitted; creates a second relationship
- Recipient replies with something unrecognized → keyword help message, retry, never a dead end
- Number is invalid or unreachable on both channels → sender notified with a clear next step

---

### Feature 1: Outcome-Based Remittance

**Description:** Recipient requests a transfer with a stated purpose. Sender approves or declines. Every transaction stores its purpose.

**Acceptance criteria**

- [ ] Sender can create a money plan with categories: Housing, Food, Business, Savings, Other
- [ ] Each category may have an optional monthly cap
- [ ] Recipient can submit a request with amount, category, and description (≤200 chars) from **app, WhatsApp, or SMS**
- [ ] System classifies each request into a trust tier at submission
- [ ] Sender is notified on their preferred channel
- [ ] Sender can approve or decline in **one action** from any channel
- [ ] Declining requires a reason — selected or written (≤200 chars)
- [ ] Approval triggers `SettlementProvider.release()`; the product never moves money directly
- [ ] Every transaction stores: amount, category, description, tier, intent state, settlement state, actor, timestamps
- [ ] Both parties can view the full transaction log
- [ ] A declined request never becomes a transaction — it remains a `Request` record

**UX notes**
- Approval must be completable without opening the app: WhatsApp inline buttons, iOS/Android notification actions, SMS `SI`
- Category selection for recipients uses icons and plain language
- Declines are never punitive in tone

---

### Feature 2: Recurring Payment Schedules

**Acceptance criteria**

- [ ] Sender can create a schedule: category, amount, frequency (weekly / biweekly / monthly)
- [ ] Requests within approved parameters auto-approve with no sender action
- [ ] Requests in a recurring category **exceeding** the approved amount are flagged for manual approval, never auto-rejected
- [ ] Sender receives a weekly digest of all activity
- [ ] Sender can pause, modify, or cancel any schedule at any time
- [ ] Recipient can see which categories are auto-approved and their limits
- [ ] Schedules evaluate in the **sender's** timezone; digests deliver in the sender's local morning

**Edge cases**
- Schedule paused → requests in that category flag for manual approval with an explanatory note
- Auto-approval fails at settlement → retry once, then notify both parties and surface as `Failed`
- Insufficient funds (models B/C) → request is held, sender notified, never silently dropped

---

### Feature 3: Emergency Approval Flow

**Acceptance criteria**

- [ ] Recipient can mark a request urgent at submission, on any channel (`URGENTE` on SMS)
- [ ] Emergency triggers immediate high-priority notification: push, WhatsApp, and SMS in parallel
- [ ] Sender can approve in **one action** from any channel
- [ ] Emergency approval screen/message shows recipient name, amount, and their words verbatim
- [ ] Emergency transactions are visually distinct in history and permanently marked
- [ ] Emergency **removes the plan-match gate**; it does not promise faster settlement
- [ ] Emergency status cannot be applied retroactively
- [ ] Rate limit: max 3 emergency requests per relationship per 7 days, then a soft warning to both parties

**Edge cases**
- Sender inactive 72+ hours → SMS fallback fires in addition to other channels
- Sender does not respond within 60 minutes → recipient receives an honest status message, never silence

---

### Feature 4: Channel Layer (WhatsApp + SMS)

**Description:** WhatsApp and SMS as full transaction surfaces for both parties.

**Why P0:** The recipient side of the product exists only here.

**Acceptance criteria — WhatsApp**

- [ ] Recipient can request funds, mark urgent, confirm milestones, upload a photo, and ask the AI
- [ ] Sender can approve, decline, initiate a transfer, check balance, and get a summary
- [ ] All actionable messages use **inline buttons** — users are never asked to type a response
- [ ] Approval buttons are exactly `[Aprobar]` `[Ahorita no]`, always in that order
- [ ] Message body never exceeds 3 lines before action buttons
- [ ] Spanish by default
- [ ] Messages addressed to a recipient open with the **sender's name**, not the product name
- [ ] All templates pre-approved with the BSP before launch
- [ ] Session-window state tracked per conversation; outside the 24-hour window only approved templates send

**Acceptance criteria — SMS**

- [ ] Full functional parity with WhatsApp, minus inline buttons
- [ ] Keywords, case-insensitive, Spanish only: `SI` `NO` `URGENTE` `AYUDA` `RESUMEN`
- [ ] Unrecognized reply returns the keyword help message — never a dead end
- [ ] Emergency SMS is prefixed with the recipient's name in capitals

**Acceptance criteria — cross-channel**

- [ ] Approval is always **one action** on every channel
- [ ] The same copy system, banned words, and voice apply to every channel
- [ ] The AI is available on every channel
- [ ] Every outbound message logs channel, template, and delivery state to an auditable record
- [ ] A user identity is the same person across app, WhatsApp, and SMS

**Edge cases**
- WhatsApp delivery fails → SMS fallback within 60 seconds, logged
- Duplicate inbound message (at-least-once delivery) → idempotent handling, no double action
- Out-of-order inbound messages → resolved against conversation state, not arrival order
- Reply to a stale request (already resolved) → clear message stating current state

---

### Feature 5: Approval Authentication

**Description:** Approving a request moves money. Every approval is an authentication event.

**Why P0:** Shared devices and frequent number changes make phone-as-identity insufficient on its own.

**Acceptance criteria**

- [ ] Every approval records the actor and an **assurance level**
- [ ] Approvals below a configured value threshold may complete in-channel
- [ ] Approvals **above** the threshold require step-up authentication
- [ ] Approvals above a second, higher threshold require the app
- [ ] Thresholds are configurable without a deploy
- [ ] A sender can set a per-transaction and per-day limit for their relationships
- [ ] Number change requires re-verification before any approval authority is restored
- [ ] All authentication events are logged immutably

**Edge cases**
- Same number appears on a second device → prior session invalidated, re-verification required
- Unusual pattern (rapid repeated requests, atypical amounts) → flagged, sender notified, not blocked
- Recipient reports coercion → documented escalation path to a human

---

### Feature 6: Sender Onboarding & Funding

**Acceptance criteria**

- [ ] Sender can create an account with a phone number
- [ ] Identity verification completes through the partner's KYC flow, embedded, never redirecting to a partner-branded page without explanation
- [ ] Sender can link a funding source (bank account and/or debit card)
- [ ] **Model-dependent:** under B/C, sender can load a balance and see it; under A, sender confirms the funding source at each approval
- [ ] Onboarding completes in ≤10 minutes for a user with documents on hand
- [ ] Partial progress is saved; a user can resume
- [ ] Verification failure produces a clear, non-shaming explanation and a path forward
- [ ] Available in Spanish and English throughout, including KYC screens

---

### Feature 7: Disclosures, Receipts & Cancellation

**Description:** Consumer protection requirements for cross-border transfers.

**Why P0:** Legally required, and the fee/FX presentation is a primary trust surface for a user who has been quietly overcharged for years.

> Exact obligations pending counsel's Reg E analysis. Build the surfaces; counsel finalizes the content.

**Acceptance criteria**

- [ ] Before any transfer is committed, sender sees: amount sent, all fees, FX rate applied, amount recipient receives, and estimated availability
- [ ] Disclosure is shown on **every channel** where a transfer can be committed
- [ ] After commitment, a receipt is delivered with the same information plus a reference number
- [ ] Receipts are retrievable from history indefinitely
- [ ] A cancellation window exists; the sender can cancel within it and see clearly how long they have
- [ ] An error resolution path is documented and reachable in-product
- [ ] All disclosure copy exists natively in Guatemalan Spanish
- [ ] FX rate presentation shows the actual rate applied, not a marketing rate

---

### Feature 8: Transaction History

**Acceptance criteria**

- [ ] Full log visible to both parties
- [ ] Each entry shows amount, category, purpose, intent state, settlement state, date, actor
- [ ] Reverse-chronological by default
- [ ] Flagged and declined entries show their reason
- [ ] Emergency entries are visually distinct
- [ ] Filter by category, date range, status
- [ ] **No charts or visualizations at MVP** — list view only
- [ ] Tap any entry for detail plus an option to ask the AI about it
- [ ] Failed transactions appear as `Failed` with a plain-language explanation — never silently dropped
- [ ] Empty state is warm and actionable

---

### Feature 9: Conversational AI Layer

**Description:** Bilingual assistant that guides setup and explains what is happening.

**Architecture requirements — non-negotiable**

- [ ] The AI has **no write access.** It cannot initiate, approve, or modify anything.
- [ ] The AI does not query the ledger. It receives a **server-rendered context object** containing pre-formatted values produced by the same code path that renders the UI.
- [ ] The AI cannot compute or restate a numeric value it was not handed.
- [ ] Questions requiring data not in its context produce a **deterministic, non-generated** response.

**Acceptance criteria — testable**

- [ ] Available in Spanish and English; user can switch at any time
- [ ] Available on app, WhatsApp, and SMS with consistent voice
- [ ] Can guide a new user through creating a money plan conversationally
- [ ] Can explain any transaction, flag, or notification in plain language
- [ ] **A held-out evaluation set of ≥100 adversarial prompts in Guatemalan Spanish passes at 100% before any deploy.** The set must include, at minimum:
  - Attempts to elicit a balance the AI was not given → must refuse deterministically
  - Attempts to get the AI to confirm or promise a transfer → must refuse
  - Attempts to get the AI to quote an FX rate → must refuse
  - Attempts to get the AI to state a delivery time as a guarantee → must refuse
  - Attempts to make the AI take an action → must refuse
  - Banned-word usage (`compliance`, `KYC`, `AML`, `regulatory`, and the design system §6.2 list) → must be zero across all outputs
  - Regional idiom comprehension → must respond appropriately
- [ ] Escalation to a human exists with defined trigger conditions
- [ ] AI unavailability produces a clear fallback, never a broken screen

---

## 9. Data model

Intent state and settlement state are **separate fields**. Do not collapse them.

```
User
  id, phone (E.164), roles[], locale, preferred_channel,
  identity_assurance_level, kyc_status, created_at, updated_at

Relationship                    ⚠ MANY-TO-MANY
  id, user_a_id, user_b_id, role_of_a, role_of_b,
  status (invited|active|paused|terminated), invited_at, activated_at

MoneyPlan
  id, relationship_id, current_version_id, created_at

PlanVersion                     ⚠ IMMUTABLE
  id, plan_id, version_number, created_by, created_at, categories[]

Category
  id, plan_version_id, name, icon, monthly_cap, is_system

RecurringRule
  id, plan_id, category_id, amount, cadence,
  status (active|paused|cancelled), next_run_at

Request
  id, relationship_id, requested_by, amount, currency, category_id,
  description, tier, is_emergency, channel_of_origin,
  status (pending|approved|declined|expired),
  resolved_by, resolved_at, decline_reason, created_at

Transaction
  id, request_id, relationship_id, amount, currency,
  intent_state (committed|cancelled)
  settlement_state (not_started|instructed|in_flight|settled|failed|reversed)
  fx_rate_applied, fee_amount, recipient_amount,
  approved_by, approved_at, assurance_level_at_approval,
  settlement_provider, provider_reference_id,
  verification_status (unverified|requested|in_progress|verified|failed)
  escrow_stage (null at MVP)
  created_at, updated_at

LedgerEntry                     ⚠ APPEND-ONLY, NEVER UPDATED
  id, transaction_id, account_id, direction (debit|credit),
  amount, currency, entry_type, created_at

Notification
  id, user_id, channel, template_id, payload_ref,
  delivery_state (queued|sent|delivered|read|failed),
  sent_at, delivered_at, failure_reason

AuditLog                        ⚠ IMMUTABLE
  id, actor_id, action, entity_type, entity_id,
  assurance_level, channel, before_state, after_state, created_at

Attachment
  id, uploaded_by, related_entity_type, related_entity_id,
  storage_ref, mime_type, created_at
```

**Invariants**

1. `LedgerEntry` rows are never updated or deleted. Corrections are new entries.
2. Debits equal credits for every transaction. Always.
3. A `Request` with status `declined` never produces a `Transaction`.
4. Every state transition produces an `AuditLog` row.
5. `PlanVersion` is immutable. Plan changes create a new version.
6. Money is stored as minor units in integers. **Never floating point.**

---

## 10. Specified behaviors (previously undefined)

| Behavior | Specification |
|---|---|
| Multiple recipients per sender | Supported. Each is a separate `Relationship` with its own plan. |
| Multiple senders per recipient | Supported. Recipient sees requests grouped by sender. |
| Plan editing | Sender edits create a new `PlanVersion`. Recipient is notified of changes. Co-editing is P1. |
| Declined request off-ramp | Decline message states the sender will follow up. Recipient may resubmit once with additional context. |
| Partner payout failure | Transaction moves to `failed`, both parties notified with plain-language reason and next step. Funds are never silently lost. |
| Partial payout | Recorded as partial settlement. Remainder tracked and surfaced. |
| Reversal | Recorded as new ledger entries, never by mutating prior ones. Both parties notified. |
| Relationship termination | Either party can end it. History is retained and remains viewable by both. No new requests permitted. |
| Account deletion | User can request deletion. Retention follows the legal-hold policy pending counsel guidance. Data export provided. |
| Transfer limits | Per-transaction, daily, and monthly caps. Values set by partner constraints and counsel guidance. |
| Timezones | Schedules and digests evaluate in the sender's local time. All stored timestamps are UTC. |
| FX rate | Rate is locked and disclosed before commitment. Applied rate is stored on the transaction. |
| Fees | **OPEN.** Structure must be decided before launch. Whatever is chosen must be fully disclosed pre-commitment. |

---

## 11. Success metrics

### Leading (30–60 days)

| Metric | Target |
|---|---|
| **Recipient pairing completion rate** | **>70% of invitations accepted within 72 hours** |
| Sender onboarding completion | >60% within 7 days of install |
| First approved transaction per pair | >70% within 14 days of pairing |
| Recurring schedule adoption | >50% of active senders within 30 days |
| Emergency approved within 15 min | >80% |
| AI engagement | >40% of sessions in first 30 days |
| **Channel distribution** | Track: app / WhatsApp / SMS share of approvals |
| Language distribution | Track |

### Lagging (60–90 days)

| Metric | Target |
|---|---|
| 30-day retention | >40% |
| 60-day retention | >25% |
| Transfers per active sender per month | >3 |
| Monthly active pairs | Grow |
| NPS | >50 |
| Verification request rate | Track — signals P1 readiness |

Every metric must map to a named instrumented event before alpha.

---

## 12. Technical requirements

**Settlement.** All partner interaction behind `SettlementProvider` (§6). No business logic branches on partner identity. A mock provider must exist for development and testing.

**Channels.** BSP behind an adapter — expect to change providers. Session-window state tracked per conversation. Delivery state logged for every outbound message.

**Notifications.** FCM + APNs, WhatsApp, SMS. Emergency uses all available channels in parallel. iOS critical alerts entitlement required.

**Idempotency.** Mandatory on every financial operation and every inbound channel message.

**Localization.** Fully bilingual at launch. All copy — including AI outputs, notifications, errors, empty states, and disclosures — written natively in Guatemalan Spanish, not machine-translated.

**Offline.** Design floor is 2G. Assume image uploads are expensive.

**Money.** Integer minor units. Never floating point.

---

## 13. Open questions

| Question | Owner | Blocking |
|---|---|---|
| Custody model A/B/C | Founder + Legal | **Yes** |
| Settlement partner selection | Founder + Technical | **Yes** |
| Technical co-founder | Founder | **Yes** |
| Reg E applicability and obligation split | Legal | **Yes** — Feature 7 |
| Fee structure | Founder | **Yes** — Feature 7 |
| FX margin | Founder | **Yes** — Feature 7 |
| Data retention under immigration risk | Founder + Legal | **Yes** |
| Step-up authentication thresholds | Founder + Research | No — configurable |
| Product name | Founder | **Yes** — blocks WhatsApp sender name, trademark, store listing |
| BSP selection | Technical | No — adapter isolates it |
| Pricing for Stage 2 protection fee | Founder + Research | No |
| Human verification network operations | Founder | No — P1 |

---

## 14. Phasing

**Phase 0 — Foundation (no code)**
20 sender interviews · 5 recipient interviews in Guatemala · counsel engaged and memo delivered · partner shortlist scored and sandbox obtained · technical co-founder in seat · recipient onboarding prototyped and tested on real devices

**Phase 1 — MVP build**
Features 0–9 · mock settlement and mock channel providers first · real partner integration once selected · full instrumentation from day one

**Phase 2 — Internal alpha**
5–10 pairs from known network · real money, small amounts · daily observation

**Phase 3 — Closed beta**
50–100 pairs · retention curve and NPS measurement · P1 verification pilot design

**Phase 4 — Pre-seed raise**
20 user stories · 60-day retention >25% · clear path to P1 monetization

---

## 15. Appendix: business model

**Stage 1 — trust acquisition.** Remittance and plan management. Low margin, high frequency. Goal is indispensability, not revenue.

**Stage 2 — monetization.** Annual protection fee ($60–120/year) plus 1–2% facilitation on high-value investment transactions.

**Fundraising:** Pre-seed on evidence and retention → Series A on retention curve and NPS → Series B on LTV data and underwriting model.

---

*Companion documents: behavioral research, design system, architecture brief, partner evaluation matrix, readiness checklist, build guide.*
