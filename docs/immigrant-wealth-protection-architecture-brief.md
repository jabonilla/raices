# Technical Architecture Brief

**Audience:** Prospective technical co-founder
**Status:** Pre-build. No code written. Stack undecided by design.
**Reading time:** ~20 minutes

---

## 0. What this document is

This is not a specification. It is an honest description of a product, four unsolved problems, and the shape of a system that could solve them.

It exists so that you can decide, in twenty minutes, whether these are problems you want to spend three years on.

Two things are deliberately left open:

1. **The stack.** There is a straw man in §6. It is a straw man. Whoever takes this role owns that decision, and I would be suspicious of a founder who had already made it.
2. **The custody model.** We do not yet know whether we hold funds, a partner holds funds, or nobody holds funds. §4.1 explains why that is a design input rather than a blocker.

What is *not* open is the product thesis. That has been researched heavily and is documented separately.

---

## 1. The product in one page

Two people, in two countries, share a financial relationship. One earns; the other spends on their behalf. Money crosses a border regularly, for years, toward long-term goals — property, a business, a home.

Today that relationship runs on messaging apps and trust. There is no shared record of what money was for, no structure around approval, and no way to reconcile intent against outcome. When it goes wrong, it goes wrong quietly and expensively.

The product makes the relationship structured without making it adversarial:

- Money moves with a **stated purpose** attached, agreed in advance
- Routine, expected spending is **pre-approved** and frictionless
- Unexpected requests are **flagged for a conversation**, not blocked
- Urgent requests have a **fast lane** that logs but does not obstruct
- Both parties see the **same immutable history**

The design constraint that makes this hard: the receiving side is largely **unbanked, WhatsApp-native, on low-bandwidth mobile connections, and will not install an app.** The sending side will. This is a two-sided product where one side has a full client and the other side has a chat thread.

---

## 2. Users and constraints

**Sender** — resident in a high-income country, employed, smartphone-capable, will install an app, sends money on a recurring basis toward long-term goals.

**Recipient** — resident in an emerging market. Assume:

- Android, mid-to-low tier, possibly shared with family members
- Data plan measured in megabytes, not gigabytes
- 3G typical, 2G as the design floor
- WhatsApp is not *an* app — it is the internet
- May change phone numbers several times a year
- Limited or no formal banking relationship

**Consequences that fall out of this:**

- The recipient experience must work entirely over WhatsApp and SMS, with zero installs
- Payloads must be small; assume every image is expensive
- Offline and degraded-connectivity behavior is a first-class requirement, not a polish item
- Phone number is a weak identifier and cannot be the sole basis of identity
- Everything is bilingual, natively — not machine-translated

---

## 3. System shape

```
        ┌──────────────┐          ┌──────────────────┐
        │  Sender app  │          │ Recipient        │
        │  (mobile)    │          │ (WhatsApp / SMS) │
        └──────┬───────┘          └────────┬─────────┘
               │                           │
               │                    ┌──────▼───────┐
               │                    │  Channel     │
               │                    │  Gateway     │
               │                    │  (BSP adapter│
               │                    │   + session  │
               │                    │   state)     │
               │                    └──────┬───────┘
               │                           │
        ┌──────▼───────────────────────────▼───────┐
        │              API layer                    │
        └──────┬──────────────┬─────────────┬──────┘
               │              │             │
     ┌─────────▼────┐  ┌──────▼──────┐  ┌───▼──────────┐
     │  Plan &      │  │   Ledger    │  │  Assistant   │
     │  Approval    │  │  (intent-   │  │  (read-only, │
     │  Engine      │  │ authoritative│  │  sandboxed)  │
     │              │  │  double-entry)│ │              │
     └─────────┬────┘  └──────┬──────┘  └──────────────┘
               │              │
               │       ┌──────▼────────────────┐
               │       │ SettlementProvider    │
               │       │ (capability-flagged   │
               │       │  adapter interface)   │
               │       └──────┬────────────────┘
               │              │
        ┌──────▼──────┐  ┌────▼──────────────┐
        │ Notification│  │ Partner rail(s)   │
        │ Orchestrator│  │ (custody, FX,     │
        │ (push/WA/SMS│  │  payout, KYC)     │
        │  + delivery │  └───────────────────┘
        │  audit log) │
        └─────────────┘
```

Five things worth noting about this diagram:

1. **The ledger is central and is ours.** It is not a cache of the partner's view.
2. **The settlement provider is an adapter, not a dependency baked into business logic.** See §4.1.
3. **The channel gateway is a real subsystem**, not an SDK call. WhatsApp has session-window semantics, template pre-approval, and delivery states that leak into product behavior.
4. **The assistant has no write path and no direct data access.** See §4.4.
5. **Notification delivery is audited.** When two people disagree about money, "did the approval request actually arrive" is the first question asked.

---

## 4. The four hard problems

These are the reason this document exists. If none of them interest you, we should not work together.

---

### 4.1 Custody-agnostic settlement

**The situation.** We have not selected a settlement partner, and the partner's capabilities determine where money physically sits between "sender commits" and "recipient receives." There are three viable models:

| | Funds held by | Settlement latency | Regulatory weight |
|---|---|---|---|
| **A** — fund-at-approval | Nobody | Days (ACH-class) | Lightest |
| **B** — we hold a balance | Us | Instant | Heaviest — stored value |
| **C** — partner holds, we instruct | Partner, in sender's name | Instant | Moderate |

**The naive read** is that this blocks architecture. It does not, because of an observation that took us a while to reach:

> **We need a double-entry ledger in all three cases.** What varies is not whether the ledger exists, but what it is *authoritative* for.

In A and C, our ledger is authoritative for **intent** — what was planned, committed, approved, and pending — while the partner is authoritative for **custody and settlement**. In B, custody authority moves to us as well. That is an addition to a system we must build regardless, not a different system.

**The design.** An append-only, double-entry ledger that models intent state independently of settlement state, plus a `SettlementProvider` interface with declared capabilities:

```
SettlementProvider {
  supportsHeldBalance: bool
  supportsProgrammableRelease: bool
  supportsPartialRelease: bool
  supportsReversal: bool
  settlementLatency: enum(instant | same_day | multi_day)
  payoutMethods: [bank_deposit, cash_pickup, mobile_wallet]
}
```

Product behavior degrades gracefully against these flags rather than assuming any one of them.

**Why this is genuinely interesting.** It inverts the usual sequence. Instead of contorting the product around whichever partner we talk to first, we evaluate partners on merit against a system that already knows how to accommodate several of them. It also means partner switching — or running two rails simultaneously for redundancy in a market where payout networks fail — is an architectural property rather than a rewrite.

**Where it is hard.** Reconciliation. Our intent ledger and the partner's settlement record will disagree, routinely, and the disagreements are the interesting part: transfers stuck in limbo, partial payouts, reversals that arrive days later, network outages mid-flight. Getting reconciliation right is most of the work, and it is unglamorous work that must be correct forever.

**One thing we have decided:** the product will promise that urgent requests get the sender's *attention* faster, not that money arrives faster. That promise holds under all three models. If we land on B or C, we over-deliver. We would rather over-deliver on urgency than break a promise to someone in a genuine emergency.

---

### 4.2 Two-sided cold start over a channel we do not control

**The situation.** The product is worthless with one side. The sender installs an app. The recipient, realistically, will not — and every step we add between "your relative sent you a message" and "you can request money" loses people.

Target: a recipient goes from a cold WhatsApp message to a functioning participant **without installing anything, without creating a password, and without leaving the conversation.**

**Why it is hard.**

- WhatsApp Business API has a **24-hour session window.** Outside it, only pre-approved template messages can be sent. Every notification in the product must be classified as session-eligible or template-required, and templates need approval lead time. This constrains product design, not just delivery.
- Template approval is an external dependency with its own latency and rejection risk.
- Conversational state must be reconstructed on every inbound message, across a channel with at-least-once delivery and no ordering guarantee.
- The same person may arrive by WhatsApp, SMS fallback, or eventually the app, and must be one identity across all three.
- Some recipients will graduate to the full app over time, and some will later become senders themselves. The identity model has to absorb that without migration pain.

**Direction, not decision.** A channel gateway that owns conversational state machines, with the BSP behind an adapter (we will likely start on one and need to move). Product logic should be channel-agnostic; the gateway translates. Whether that state machine is hand-rolled or built on an existing conversational framework is open.

---

### 4.3 Approval as an authentication event

**The situation.** In this product, replying to a message moves money. That makes every approval an authentication event, on the weakest identity substrate available.

**The specific threats we take seriously:**

- **Shared devices.** Phones are shared within households. An approval must be attributable to a *person*, not a handset.
- **Number recycling and number change.** Recipients change numbers frequently. Naive phone-as-identity means either locking people out constantly or making account takeover trivial. Both are unacceptable.
- **SIM swap.** Standard, but higher-consequence here.
- **Coercion.** This deserves saying plainly: a product built to protect people from financial exploitation is an attractive tool *for* financial exploitation. Someone can stand over a recipient and make them submit requests. We cannot fully solve this, but we can refuse to design as though it does not happen — which means thinking carefully about behavioral anomaly detection, and about what the sender sees.

**Direction, not decision.** Layered assurance rather than a single gate: low-value routine approvals stay frictionless in-channel; a value threshold triggers step-up; high-stakes actions require the app. Where exactly those thresholds sit is a product decision informed by user research, not an engineering constant.

The recovery flow — a recipient with a new number needing to re-establish identity, possibly with no formal ID — is, in our estimate, the single largest support-cost driver in the product. It deserves design attention disproportionate to its apparent size.

---

### 4.4 An assistant that talks about money and is never wrong about it

**The situation.** Most users have never been treated well by a financial product. When something is confusing, there is no one to ask. A conversational assistant is the retention layer — and it is also the largest reputational risk in the system.

**The failure mode we are designing against:** the assistant confidently states a balance, confirms a transfer, or quotes a rate — and is wrong. For a product whose entire value proposition is trust, that is not a bug. It is a company-ending event.

**Our position:** this is an **architecture problem, not a prompting problem.**

- The assistant has **no write access.** It cannot initiate, approve, or modify anything.
- The assistant does not query the ledger directly. It receives a **rendered, server-computed context object** — already-formatted values, produced by the same code path that renders the UI. It cannot compute or restate a number.
- Any question requiring authoritative data it has not been handed produces a deterministic, non-generated response.
- A **held-out evaluation set** — adversarial prompts in the target dialect, with expected behaviors — gates every deploy. "Does not hallucinate" is not an acceptance criterion. A passing eval run is.

**Why this is interesting.** The constraint is unusual: build something that feels genuinely conversational and warm while being structurally incapable of asserting a fact it was not handed. Most people building with language models are trying to expand what the model can do. Here the interesting work is in bounding it precisely enough that warmth and reliability are not in tension.

---

## 5. Data model sketch

Deliberately partial. The full model is specified separately; this is enough to see the shape and spot anything obviously wrong.

```
User            id, role(s), locale, channel_preferences, identity_assurance_level
Relationship    many-to-many between users, with role per edge
                ⚠ NOT 1:1 — one recipient commonly receives from several
                  senders; one sender commonly supports several households
MoneyPlan       versioned, scoped to a relationship
PlanVersion     immutable snapshot; changes are new versions, never mutations
Category        system + user-defined, with optional caps
RecurringRule   category, amount, cadence, pause state
Request         distinct from Transaction — a declined request never becomes one
Transaction     intent state + settlement state, tracked independently
LedgerEntry     append-only, double-entry, never updated or deleted
Notification    channel, template ref, delivery state, timestamps — auditable
AuditLog        immutable; every state transition with actor and assurance level
Attachment      architected now, used later (verification photos)
```

Two notes:

**The many-to-many relationship model is load-bearing.** An earlier draft assumed one sender to one recipient. That is wrong for this market, and discovering it after the ledger is built would be expensive.

**Intent state and settlement state are separate fields, not one status enum.** A transaction can be approved-but-unsettled, settled-but-disputed, or partially settled. Collapsing these is the mistake that makes reconciliation impossible later.

---

## 6. Stack posture

**This is a straw man. It is yours to overturn.**

What it should optimize for, in priority order:

1. **Correctness under concurrency** — this is a ledger; boring and provable beats clever
2. **Small mobile payloads** — bandwidth is a user constraint, not a cost line
3. **Operational simplicity for a team of two** — every service added is a service someone is paged for
4. **Auditability** — regulators and disputes both ask "what happened and when"

Straw man: a relational database with real transactional guarantees as the system of record; a single deployable service until there is a demonstrated reason otherwise; a cross-platform mobile client for the sender; the channel gateway as the only component with a strong case for early separation, since its scaling and failure characteristics differ sharply from the rest.

If your instinct is to argue with any of this, good. That is the point of including it.

---

## 7. Decided vs. open

**Decided** — changing these means changing the company:

- The product is a plan-and-approval layer, not a messaging app or a bank
- The receiving side works with zero installs, over messaging
- Urgent requests are promised attention, not speed
- The assistant cannot write, and cannot assert unhanded facts
- The relationship model is many-to-many
- The ledger is ours and is intent-authoritative

**Open** — genuinely open, yours to weigh in on:

- Entire stack
- Custody model (A/B/C), pending partner selection and legal review
- BSP selection
- Monolith vs. services, and where the seams go
- Step-up authentication thresholds
- Whether the recipient ever gets a native app, or stays conversational permanently

---

## 8. First 90 days

Assuming a start with the partner question still open — which is the realistic case.

**Weeks 1–3 — Orientation and partner evaluation.** Read the research and product documents. Score settlement partners against the capability matrix. This is the highest-leverage thing to do first, because it collapses the largest uncertainty and your judgment on it is worth more than mine.

**Weeks 3–6 — Ledger core.** Intent-authoritative double-entry ledger with the reconciliation model. No UI. This is the foundation everything else assumes and the piece that is most expensive to get wrong.

**Weeks 5–9 — Channel gateway spike.** Recipient onboarding over WhatsApp, end to end, in a sandbox. Tested with real recipients on real devices and real networks. Expect this to invalidate assumptions.

**Weeks 8–12 — Thin vertical slice.** One sender, one recipient, one request, one approval, one settled transfer through a real partner sandbox. Ugly is fine. It must be real.

**By day 90:** partner selected, ledger foundation in place, and honest data on whether zero-install recipient onboarding actually works. If it does not, we learn it in month three rather than month twelve.

---

## 9. What we are looking for

Someone who reads §4.1 and thinks reconciliation sounds like a good problem rather than a chore. Someone who has opinions about §6 and will defend them. Someone comfortable with the fact that a third of this document is honest uncertainty rather than a plan.

The non-technical requirements are real: the users are not you, the constraints are not the ones you are used to designing around, and the only way to find that out is to talk to them. If building for people you will have to go meet sounds like an obstacle rather than the interesting part, this is probably not the right fit.

**What exists today:** deep behavioral research, a full product specification, a complete design system, and a readiness assessment honest enough to list everything missing. **What does not exist:** a single line of code. That is the offer — the thinking is done, the building has not started, and the person who starts it should own how.

---

*Companion documents available on request: behavioral research, product requirements, design system, production readiness checklist, settlement partner evaluation matrix.*
