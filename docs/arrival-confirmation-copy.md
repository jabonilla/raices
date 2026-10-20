# Arrival Confirmation Copy — Draft

**For:** José (wording decisions marked **[GAP]**)
**Date:** 2026-10-20
**Ticket:** K2.53
**Governs:** ADR-002 — Raíces facilitates, it does not transmit.

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

**[GAP — provider name]** There is no provider yet, so no string below can
name one. Drafts use `{{provider}}` where the name belongs. Until a
provider is chosen, the fallback wording is "el servicio de envío" — José
to confirm that placeholder reads honestly and not evasively.

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

**If she answers TODAVÍA NO:**

> Gracias por decirnos. Le avisamos a {{senderName}} que todavía no llega.
> Te preguntamos de nuevo más tarde.

> Thanks for telling us. We'll let {{senderName}} know it hasn't arrived
> yet. We'll ask you again later.

**[GAP — retry cadence]** How often do we re-ask, and when do we stop?
Draft assumes "más tarde" with no number, because any number we print is a
promise. José/product to set the cadence; the copy must not invent one.

**[GAP — sender identity]** The draft shows the sender's name. If the
sender is known to her by a different name or nickname, the stored
"how you refer to this person" only covers how the *sender* names the
*recipient*, not the reverse. José: use the sender's account name, or is
there a better source?

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

> Aprobado · Esperando confirmación

> Approved · Awaiting confirmation

**Detail line:**

> Aprobaste este envío. Lo está procesando {{provider}}. Te avisamos
> cuando {{recipientName}} confirme que lo recibió.

> You approved this transfer. {{provider}} is processing it. We'll let
> you know when {{recipientName}} confirms she received it.

Note what this does not say: no arrival estimate, no "en camino" (the
money's location is the provider's to report), no progress bar implying
we are tracking something we are not.

**[GAP — how long is "waiting"?]** If days pass with no confirmation and
no provider update, the screen keeps saying the same thing. Does it ever
change — a nudge to the recipient, an escalation, a "pregúntale al
asistente" path? Product decision; no copy invented here.

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
arrival.providerFailed.title  (§4)
arrival.providerFailed.body   (§4)
```

Keys are proposed here rather than added to `es.json`/`en.json` because
no screen consumes them yet; dead keys would drift from whatever Phase 5
actually builds. K2.54 separately fixes the strings that are live today.
