# Raíces — restart note

**Written:** 2026-10-28, at shutdown
**By:** Claude, acting CTO
**For:** whoever picks this up, including Jose in six months, and including a future me with none of this in context

Raíces is dormant, not dead. Nothing here is deleted. This file is what I would want to read first.

---

## What it was

A cross-border payments product. A US-based sender and a Guatemala-based recipient share a structured financial relationship: money moves with a stated purpose attached and an approval gate in between. The recipient lives on WhatsApp and installs nothing.

The differentiated idea was never moving money. It was the **structure around** money inside a family — a plan with caps, a request with a reason, an approval that is explicit, and a record of what was agreed.

## Why it stopped

Not engineering. The problem turned out larger than the resources available: regulatory diligence, a settlement partner relationship, and a business entity that all had to exist before a single real dollar could move. Jose chose to stop rather than half-resource a product that handles family money. That was the right call and it should not be re-litigated by anyone reading this — if you restart, restart on the resourcing question, not on whether the code was good.

---

## What is actually built, and how much to trust it

**Trust highly — built, tested, and independently attacked:**
- **Double-entry ledger** (Phase 1). Append-only enforced by database triggers and revoked grants, not by application discipline. Money is `bigint` minor units plus currency, never floats. Idempotent posting that survives concurrent duplicate keys. Balance derivation and reconciliation. A *different model* (K3, a Codex agent) spent days trying to break it and could not create money, double-spend, or mutate history
- **Domain model** (Phase 2). Audit log where a state change cannot commit without its audit row; relationships (many-to-many, both directions); money plans with immutable versions; requests with a pure, exhaustively table-tested tier classifier; transaction records keeping intent state and settlement state strictly separate
- **~1,100 tests**, and more importantly, mutation testing: each guard was removed on purpose and the suite confirmed to fail. A green test nobody has watched fail proves nothing

**Trust moderately — built, tested, never exercised end to end:**
- Auth (phone OTP, hashed revocable sessions, rate limiting), the HTTP authorization policy module, idempotency middleware, the channel adapter and webhook skeleton, the mobile app (Expo, Spanish-first, accessibility baseline, visual direction "B+")

**Do not trust — known incomplete:**
- **The HTTP layer was never wired.** Issue #136. Identity, relationship and request routes exist as code and are *never registered with the server*. The deployed API exposed only `/health`, `/ready`, `/openapi.json` and webhooks. This is why the app still ran on fixture data and why nothing was ever demonstrated end to end
- `trustProxy` was changed from `true` to `1`, but the hop count was **never measured**. Until someone sends a forged `X-Forwarded-For` at a deployed instance and sees it resolved to the edge rather than the forged value, the rate limiter's isolation is unproven
- Phase 3 (WhatsApp channel) got as far as durable inbound dedupe and conversation state. Message parsing (#152) is written and parked

---

## Start here if you restart

1. **Issue #136 first.** Wire the routes, then walk one request end to end on a deployed instance yourself. Nothing else matters until a sender can sign in, invite someone, create a request, approve it, and see a ledger posting land
2. Then the forged-header measurement
3. Then resume Phase 3

Do not start new features before step 1 works. That mistake is the main reason this project had 150 PRs and no working core: **I planned Phase 3 on top of a Phase 2 I had never verified was connected.** Breadth kept moving while the thing underneath was unreachable.

---

## Decisions worth re-reading before changing

- **ADR-001** — stack. TypeScript, Fastify, Postgres, one deployable service
- **ADR-002** — *we facilitate, we do not transmit*. The product does not hold or move money; a licensed provider does. This removed money-transmission licensing from the critical path and is the single most important strategic decision in the repo. It also makes the ledger matter **more**, not less: when you are not moving the money, your record of what was agreed is the only thing that can contradict a provider's version
- **Arrival confirmation ordering** (docs/arrival-confirmation-copy.md). Recipient confirmation is primary evidence, not bank data. A debit leaving a US account does not prove an arrival in Guatemala, and asking a sender for bank credentials is a large trust cost for a weaker signal. The recipient is already on WhatsApp
- **Copy voice.** The Spanish is Jose's, in Guatemalan voseo, and was deliberately not "improved" by anyone. The standing test for any new string: not whether it is reassuring, but **whether we could still defend it if the transfer failed an hour later**

---

## The lessons that cost the most to learn

Each of these was found the hard way. They generalise beyond this project.

1. **A check you have not watched fail is not evidence.** `make verify` silently discarded typecheck and lint failures for days. Everything was green. Nothing was verified
2. **Green proves what ran, not what is true.** A security regression test stopped compiling when its own fix changed a signature. A test that does not compile does not run; the redaction defect sat unguarded under a passing badge
3. **Built is not reachable.** Routes, handlers, jobs, config — each can pass every test it has and still be wired to nothing. See #136
4. **Merged is not working.** PRs were merged on the strength of tests rather than reachability, by me
5. **Report what you did NOT verify.** The agents' willingness to say "I could not establish this" was worth more than any passing suite. The one marked UNVERIFIED was the most valuable line any of them wrote
6. **Protect the compensating path when you close a hole.** The fix that stopped entries joining a committed transaction had to keep reversals possible. A fix that quietly blocks corrections is worse than the defect

---

## Operational state at shutdown

- `main` is green. Last commit `350249b`
- Four PRs parked, not rejected: #144, #150, #151, #152
- Railway staging was torn down or left dormant; a security incident at Railway on 2026-10-21 exposed environment variables industry-wide. Our exposure was a staging database credential and a diagnostic salt — no customer data, no funds, no provider keys, because none existed yet. **Rotate anything that is revived**
- No real money ever moved. No real user data was ever held
- The agent team (K2, K3, K4) was stood down

---

## If you are an AI agent reading this

Read `CLAUDE.md` before touching anything; its rules, especially 11 through 15, are the compressed form of everything above. Do not assume a passing check means the thing works. Verify reachability, not just correctness. And say plainly what you have not verified — that habit is the reason the ledger in this repo is worth restarting.
