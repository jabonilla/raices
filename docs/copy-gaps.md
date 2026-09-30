# Copy Gaps — What Needs Real Wording

**For:** José  
**Date:** 2026-09-29  
**Ticket:** K2.34

Every string in the app currently has *functional* copy — it reads fine, but it was written by engineers, not from your copy sheet. The items below need your wording. They're grouped by where they appear in the app.

**How to use this:** For each item, write the replacement in both English and Spanish (or Spanish only if you want us to handle the English). Don't worry about key names — just tell us the screen and the situation, we'll map it.

---

## Home Screen (Inicio)

The empty and error states were invented. The copy sheet has no wording for these.

- **Empty title** — Shown when the user hasn't sent anything yet. Current: "You haven't sent anything yet."
- **Empty body** — Explains what they'll see here. Current: "When you do, you'll see it here."
- **Empty action** — Button to start. Current: "Send now"
- **Error title** — Shown when the home screen fails to load. Current: "We couldn't load your home screen."

## Approval Screen (Aprobación)

The empty and error states were adapted from other screens. The copy sheet has no wording for these.

- **Empty title** — Shown when nothing is waiting for approval. Current: "All caught up."
- **Empty body** — Current: "Nothing is waiting for your answer."
- **Error title** — Shown when a request fails to load. Current: "We couldn't load this request."

## Assistant Screen (Asistente)

The empty and error states were invented. The copy sheet has no wording for these.

- **Empty title** — Shown before the first conversation. Current: "No conversation yet."
- **Empty body** — Invites the user to ask. Current: "Ask anything — I'll explain what's happening with your money."
- **Error title** — Shown when the conversation fails to load. Current: "We couldn't load the conversation."

## Goal Screen (Meta)

- **Error title** — Shown when the goal fails to load. Current: "We couldn't load your goal." (English is draft; Spanish needs review.)

## History Screen (Historial)

- **Error title** — Shown when history fails to load. Current: "We couldn't load your history." (English is draft; Spanish needs review.)

## Invite Screen (Invitar)

The confirmation shown after sending an invite was written functionally. The copy sheet has no invite-success wording.

- **Confirmation title** — Shown after an invite is sent. Needs your wording for what the user should feel here.
- **Confirmation body** — Explains what happens next (the recipient gets a WhatsApp message). Needs your wording.

## Relationships Screen (Personas)

- **Resend confirmation** — Shown after resending an invite. Current: "Invitation resent." (Functional; needs your tone.)
- **Empty body** — Shown when the list is empty. Current: "You have no people in your list yet. Invite someone to get started." (Functional; needs your tone.)

## API Error Messages (20 strings)

Every API error message was invented. The copy sheet is silent on error wording. These appear when something goes wrong — the user sees a title (what happened) and a body (what to do).

1. **internal_error** — Our server failed. Title: "Something didn't work on our side." / Body: "Try again in a few minutes."
2. **invalid_request** — The request was malformed. Title: "Something in the information wasn't right."
3. **bad_request** — We couldn't understand the request. Title: "We couldn't understand that request."
4. **unauthorized** — Session expired. Title: "Your session ended." / Body: "Sign in again to continue."
5. **forbidden** — No permission. Title: "You don't have permission to do that."
6. **not_found** — Resource doesn't exist.
7. **conflict** — Conflicting state.
8. **rate_limited** — Too many requests.
9. **service_unavailable** — Downstream service down.
10. **validation_error** — Input failed validation.

*(Each has a title and body in both English and Spanish — 20 strings total.)*

---

## What We Did NOT Flag

- **All 128 i18n keys exist in both English and Spanish.** Nothing is missing a translation.
- **No hardcoded Spanish strings** in components — everything goes through i18n.
- **Notification copy** (K2.32) is intentionally vague for privacy — that's by design, not a gap.
- **Button labels, tab names, form labels** — these came from the copy sheet or design system and look solid.

---

## Priority Suggestion

If you're short on time, start with the **API error messages** (users see these when things break — tone matters most here) and the **Home empty state** (it's the first thing a new user sees).
