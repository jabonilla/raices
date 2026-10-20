# Arrival Confirmation Copy — Draft

**For:** José (wording decisions marked **[GAP]**)
**Date:** 2026-10-20 (finalized the same day with José's answers, via Claude)
**Ticket:** K2.53
**Governs:** ADR-002 — Raíces facilitates, it does not transmit.

José answered the four original gaps on 2026-10-20. His answers are applied
below and marked **Decided**. Gaps the answers themselves create are
collected at the end, flagged rather than filled.

## The rule every string below obeys

We never report arrival as a fact we know. We report what the **recipient
told us**, or what the **provider told us**, and the copy says which:

- ✅ "Mamá confirmó que lo recibió." — a claim we can make; the source is in
  the sentence.
- ❌ "Tu dinero llegó." — a claim we cannot make on our own authority. A
  product that takes credit for arrivals inherits blame for failures it
  cannot fix (ADR-002).

Spanish is primary; English is the fallback. Spanish uses the app's
existing vos forms. Amounts and the recipient's name are always specific —
the copy sheet's rule is to name the thing ("Aprobar $95.00"), not describe
a state ("Confirmar").

**[Decided — provider name]** There is no provider yet, so no string below
can name one. Drafts use `{{provider}}` where the name belongs, and the
swap to a real name must stay a one-change operation. Until then the
fallback wording is "el servicio de envío" — José's call: it reads evasive,
so it is **temporary scaffolding, not a decision**. See new gap N2 at the
end: the placeholder needs a named replacement trigger.

---

## 1. Asking the recipient to confirm (WhatsApp, to the recipient)

She is on WhatsApp only; she may not have the app. This is the primary
arrival evidence (ADR-002 confirmation source #1).

**Message:**

> Hola, {{recipientName}}. {{senderName}} aprobó un envío de {{amountGTQ}}
> para ti, por medio de {{provider}}. ¿Ya lo recibiste?
>
> Responde **SÍ** si ya lo tienes, o **TODAVÍA NO** si aún no te llega.

> Hi, {{recipientName}}. {{senderName}} approved a transfer of
> {{amountGTQ}} for you, through {{provider}}. Have you received it?
>
> Reply **YES** if you have it, or **NOT YET** if it hasn't arrived.

**If she answers TODAVÍA NO** (final wording, José via Claude 2026-10-20):

> Gracias por avisarnos. Le decimos a {{senderName}} que todavía no llega.

> Thanks for letting us know. We'll tell {{senderName}} it hasn't arrived
> yet.

Note what this does **not** do: it does not reassure her the money is on
its way. "El dinero ya va en camino" was proposed and rejected — if the
provider has failed or flagged the transfer, that sentence tells her it
is coming when it is not, and she stops checking and stops telling us,
which costs us the evidence source ADR-002 depends on. The reassurance
comes from someone acting ("le decimos a…"), not from a prediction about
money we do not control. Test for every future string: could we still
defend it if the transfer failed an hour later?

**[Decided — retry cadence]** Ask her again on **day 5**, then on
**day 7**. If still unconfirmed after day 7, **stop asking her** —
repeated unanswered questions about money are a burden, not a service,
and she may have reasons for not answering that have nothing to do with
the transfer. After day 7 the question moves to the sender (§3). The
re-asks resend the §1 message unchanged; no separate follow-up wording
is drafted (see new gap N3).

**[Decided — sender identity]** `{{senderName}}` is the sender's account
name. Confirmed by José.

## 2. Recording a confirmation (in-app, sender's view)

Shown on the transfer detail and in history once the recipient confirms.
The badge/label names the evidence, not just the outcome.

**Label:**

> ✓ Confirmado por {{recipientName}}

> ✓ Confirmed by {{recipientName}}

**Detail line:**

> {{recipientName}} confirmó que recibió los {{amountGTQ}} el
> {{date}} a las {{time}}.

> {{recipientName}} confirmed she received the {{amountGTQ}} on
> {{date}} at {{time}}.

**If the provider reported delivery first and the recipient confirms
after** (evidence sources can stack; recipient confirmation outranks
provider status per ADR-002):

> {{provider}} reportó la entrega y {{recipientName}} confirmó que lo
> recibió.

> {{provider}} reported delivery and {{recipientName}} confirmed she
> received it.

**[GAP — "todavía no" is not a failure]** If the recipient says the money
has not arrived, that is a *state*, not an error. Draft sender copy:

> {{recipientName}} nos dijo que todavía no lo recibe. El dinero lo está
> procesando {{provider}}.

José to confirm tone: this sentence carries the exact moment where a user
decides whether they trust us. It must neither alarm ("perdido") nor
over-reassure ("no te preocupes, ya va a llegar" — a promise we don't
control).

## 3. The sender's view of an unconfirmed transfer

After approval, before any confirmation exists. The current app shows
"✓ Enviado" here, which claims a movement we did not make (fixed
separately in K2.54). The honest state:

**Label:**

> Aprobado · Sin confirmar

> Approved · Unconfirmed

**[Decided — visible from day one]** The sender sees the unconfirmed
state from **day 1**, not from day 5 when our first re-ask goes out. It
is his relationship; he can ask her himself, and that is usually faster
than our message. We do not make him wait on our cadence to learn
something we already know.

**Detail line:**

> Aprobaste este envío. Lo está procesando {{provider}}. Te avisamos
> cuando {{recipientName}} confirme que lo recibió.

> You approved this transfer. {{provider}} is processing it. We'll let
> you know when {{recipientName}} confirms she received it.

Note what this does not say: no arrival estimate, no "en camino" (the
money's location is the provider's to report), no progress bar implying
we are tracking something we are not.

**[Decided — escalation]** The state changes on the §1 cadence: recipient
re-asked day 5 and day 7. After day 7 with no confirmation, we stop
asking her and ask the **sender** (in-app):

> Ya pasaron 7 días y {{recipientName}} no nos ha confirmado. ¿Sabes si
> ya recibió los {{amountGTQ}}?

> It's been 7 days and {{recipientName}} hasn't confirmed with us. Do
> you know if she received the {{amountGTQ}}?

A sender "yes" is sender self-report — confirmation source #2 in
ADR-002, weaker than the recipient's own word. How it gets recorded and
labeled is new gap N1 below; the question itself is decided.

## 4. A transfer the provider says failed

The sender must learn three things, in this order: what happened, **whose
hands the money is in**, and what to do next. Never a generic error.

**Title:**

> El envío no se pudo completar

> The transfer could not be completed

**Body:**

> {{provider}} nos informó que no pudo completar el envío de
> {{amountGTQ}} para {{recipientName}}. **Tu dinero está con
> {{provider}}**, no con Raíces — nosotros no movemos el dinero, solo
> registramos tu aprobación.

> {{provider}} told us it could not complete the transfer of
> {{amountGTQ}} to {{recipientName}}. **Your money is with
> {{provider}}**, not with Raíces — we don't move the money, we only
> record your approval.

**[GAP — what happens next]** This is the largest gap in the set, and it
cannot be drafted until a provider exists, because the next step is the
provider's process, not ours:

- Does the provider refund automatically, and to what (card, account,
  cash)? In what timeframe — and may we print that timeframe, or only
  "el proveedor te lo devuelve según sus tiempos"?
- Does the sender act with the provider directly, or do we open the case
  and relay? (ADR-002: reconciliation is a conversation with a partner —
  but the *sender-facing* path is undecided.)
- Is there a reference number from the provider the sender can quote?

Placeholder until then, **not for production**:

> {{provider}} te devolverá el dinero según su proceso. Si necesitas
> ayuda, pregúntale al asistente y te acompañamos.

**[GAP — reason codes]** Providers report failure reasons (bad account
number, recipient name mismatch, payout location closed). Each maps to
different sender action. No per-reason copy is drafted; inventing it
without the provider's actual code list would be fiction.

---

## New gaps these answers create (flagged, not filled)

**N1 — Recording a sender self-report.** The day-7 path creates a new
evidence state: the sender says she received it. ADR-002 ranks that #2,
below the recipient's own confirmation, so it must not render with the
same label or the same confidence as "Confirmado por {{recipientName}}."
The recorded-state copy (label, detail line, history treatment) is not
drafted here.

**N2 — The `{{provider}}` placeholder needs a replacement trigger.** The
placeholder is scaffolding with no owner yet: when a provider is
selected, someone must swap every string in one change — including the
live `transactionCard.failedNote` shipped in K2.54, which already says
"el servicio de envío" in production copy. Launch must not mistake the
placeholder for a settled decision.

**N3 — Re-ask wording.** Day-5 and day-7 messages resend the §1 ask
verbatim, by default. A dedicated follow-up tone (acknowledging we're
asking again) may read better, but it is undrafted and unapproved.

**N4 — What stops the cadence clock.** The day-5/day-7 asks assume
nothing else has happened. A provider delivery or failure report, a
recipient reply of either kind, or an early sender self-report should
presumably end the sequence — that termination rule needs one line of
product spec before Phase 5 builds the machinery, so we never ask about
a transfer that is already resolved.

---

## Proposed i18n keys (for Phase 5, not yet added to the locale files)

```
arrival.askRecipient.*        (WhatsApp template, §1)
arrival.recipientNotYet.*     (§1)
arrival.confirmedBy.label     (§2)
arrival.confirmedBy.detail    (§2)
arrival.providerAndRecipient  (§2)
arrival.notYetReported.*      (§2 gap)
arrival.awaiting.label        (§3)
arrival.awaiting.detail       (§3)
arrival.senderCheckIn.*       (§3, day-7 sender question)
arrival.providerFailed.title  (§4)
arrival.providerFailed.body   (§4)
```

Keys are proposed here rather than added to `es.json`/`en.json` because
no screen consumes them yet; dead keys would drift from whatever Phase 5
actually builds. K2.54 separately fixes the strings that are live today.
