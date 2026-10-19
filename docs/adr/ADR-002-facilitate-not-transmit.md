# ADR-002 — We facilitate, we do not transmit

**Status:** Accepted
**Date:** 2026-10-19
**Owner:** CTO (Claude), decided with Jose
**Supersedes:** the settlement assumptions in the PRD and in the Phase 5/6 plan

## Decision

Raíces does not move, hold, or custody money. Users send through an existing licensed remittance provider; we own the agreement, the intent, the approval gate, the record and the conversation around it.

Concretely:
- **We own:** relationships, money plans and caps, requests, the approval gate, the audit trail, the WhatsApp channel, and the record of what was agreed
- **We do not own:** funds, custody, FX, payout, or the transfer itself
- **The provider owns:** the money movement and is the authoritative source for whether it settled

## Why

Moving money between the US and Guatemala is regulated activity. Registration and state licensing are slow and expensive, and they were the longest item on the critical path. Operating as a facilitator on a licensed party's rails removes that item entirely and lets the product launch on the thing that is actually differentiated: the structure around the money, not the moving of it.

This also matches what we already built. `SettlementProvider` exists precisely so no part of the system assumes we hold funds.

## What this changes

**The ledger stays, and matters more.** It stops being a record of custody and becomes the record of intent and agreement: who asked, who approved, for what purpose, against which cap. When we are not the ones moving money, our record of what was agreed is the only thing that can contradict a provider's version of events. Every Phase 1 and Phase 2 guarantee holds unchanged.

**Reconciliation becomes a conversation, not a bug report.** Our ledger is authoritative for intent; the provider is authoritative for settlement. That split was already the design (P1.5). The difference now is that a discrepancy is a dispute with a partner rather than a defect in our code, so discrepancies must be legible to a human, not just detected.

**The product must be honest about who does what.** If a transfer fails or is delayed, the money is with the provider, not with us. Copy and screens say so plainly. We never imply control over an outcome we do not control — a product that takes credit for arrivals inherits blame for failures it cannot fix.

## Confirmation: how we learn money arrived

Decided, and the ordering is deliberate:

1. **Recipient confirmation (primary).** She is already on WhatsApp. "¿Ya recibiste los Q200?" → "Sí" is stronger evidence that money *arrived* than any debit leaving a US bank account. It costs nothing, needs no credentials, works for cash-funded transfers, and reinforces the relationship that is the actual product.
2. **Sender self-report (fallback).** For when the recipient does not answer.
3. **Provider status, where the partner exposes it.**
4. **Bank-data confirmation (Plaid or similar) — optional, later, never required.**

### Why bank data is not the foundation

- It shows a debit leaving an account, not an arrival in Guatemala. Confirmation would be inferred from a proxy
- Matching a bank line to a request is fuzzy: mangled descriptions, fees that change the amount, pending-versus-posted lag
- It excludes users who fund transfers with cash or prepaid cards, and a confirmation mechanism that cannot see part of the users is not one
- It asks an immigrant sender to hand bank credentials to a new app. That is a large trust cost for a signal we can get more cheaply and more accurately by asking the person who received the money

**Design requirement:** confirmation evidence is pluggable, the same way settlement is. An `ArrivalEvidence` source interface with recipient-confirmation as the first implementation; bank data becomes one more source later rather than a foundation we have to dig out.

## Consequences

- Money transmission licensing leaves the critical path. A fintech lawyer is still required before launch to confirm where the regulated perimeter actually falls — "we only create orders" is not automatically outside it, and the answer depends on whether funds ever route through us and who the user contracts with
- The partner conversation becomes a commercial and legal gate, not a technical one. Two questions decide the architecture: can we create orders on behalf of a user through their API, and who is the regulated party in that arrangement
- Phase 5 changes from "settlement integration" to "provider order creation + arrival confirmation". Phase 6 is no longer "real funds through us"
- No code written so far is wasted. The ledger, the domain, the channel and the audit trail are all unchanged

## Revisit triggers

- A partner requires us to take custody, or no partner will create orders on our users' behalf
- Volume or economics make our own licensing worth the cost
- A regulator tells us the facilitator framing does not hold for what we actually do
