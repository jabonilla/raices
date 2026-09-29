# Raíces local demo walkthrough

One command boots the whole thing:

```sh
pnpm demo
```

This starts Postgres (docker compose), applies migrations, seeds fixture data, and boots the API on `http://localhost:3000` with the **fake channel** and **mock settlement provider** wired in. No real money, no real WhatsApp, no credentials.

## The product story

Raíces moves money from a US-based sender to a Guatemala-based recipient. The recipient uses WhatsApp only and installs nothing. Every transfer carries a **stated purpose** and passes an **approval gate** before money moves.

The demo's fixture is one concrete transfer: **$25.00 from the USD settlement account to Maria** (a Guatemala recipient). In the database that's one balanced ledger transaction — a $25.00 debit on `settlement:usd` and a $25.00 credit on `recipient:maria`. Debits equal credits per currency; the database trigger enforces it, not application code.

## Walk the money

**1. The API is alive.** Liveness needs nothing but the process:

```sh
curl http://localhost:3000/health
# {"ok":true}
```

**2. Readiness needs Postgres.** The demo seeds the database, so this is 200. Kill the database container and it drops to 503 — that's the platform's signal to stop sending traffic, and it's what Railway's healthcheck watches.

```sh
curl -i http://localhost:3000/ready
```

**3. The ledger is append-only.** The seed wrote one transaction with two entries. Corrections in Raíces are never edits — they're new compensating transactions. Query the database to see the shape:

```sh
docker compose exec -T db psql -U raices -d raices_dev -c \
  "select code, direction, amount_minor, currency from ledger_entry join ledger_account on account_id = ledger_account.id;"
```

You'll see the debit and the credit, both `2500` minor units, both `USD`. Money here is always **bigint minor units plus an ISO code** — never a float, never a `number`.

**4. The channel is fake, the seam is real.** Recipients talk to Raíces over WhatsApp; in the demo, the `FakeChannelAdapter` stands in for the provider. Post an inbound message the way the provider would:

```sh
curl -s -X POST http://localhost:3000/webhooks/channel \
  -H 'content-type: application/json' \
  -H 'x-webhook-signature: test-signature' \
  -d '{"messageId":"demo-1","kind":"inbound","from":"+50255550100","to":"+13055550100","body":"Gracias!"}' \
  -w '\n%{http_code}\n'
# {"ok":true,"deduped":false}
# 202
```

Post the exact same payload again: you get `{"ok":true,"deduped":true}` with a 200. Providers retry webhooks; the same provider message id is never processed twice. That's the at-least-once dedupe from K2.28, and it's what makes retries safe.

**5. Settlement is mocked, the interface is the contract.** `packages/settlement` defines `SettlementProvider` — quote, initiate, track status — and `MockSettlementProvider` implements it deterministically with no network. The API doesn't settle directly; reconciliation consumes the provider interface, so swapping the mock for the real partner changes no business logic. That's the seam the whole architecture hangs on: **no business logic branches on partner identity.**

## What's fake and what's real

| Piece | Demo | Production |
|---|---|---|
| Channel (WhatsApp) | `FakeChannelAdapter` — accepts the documented test signature | Real provider adapter, real signature verification on raw bytes |
| Settlement | `MockSettlementProvider` — deterministic, in-memory | Real partner via `SettlementProvider` |
| Dedupe store | In-memory set (lost on restart) | Durable store (Phase 3) |
| Ledger | Real Postgres, real triggers, real append-only | Same — this part isn't faked |
| Money math | Real `bigint` minor units | Same |

The fakes exist so the **product logic** — the ledger rules, the idempotency, the purpose-and-approval flow — can be exercised end to end without credentials or network. When the real adapters land, the routes and their contracts don't change.

## Stopping

`Ctrl-C` stops the API. The database keeps running (`docker compose down` to remove it, `-v` to drop the data too). Re-running `pnpm demo` is idempotent: migrations and seeds are safe to repeat.
