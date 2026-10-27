-- ---------------------------------------------------------------------------
-- 0012 — HTTP request receipts
-- ---------------------------------------------------------------------------
--
-- Promotes docs/http-idempotency-proposal.sql, which K3.5 wrote as a proposal
-- and never migrated. `PostgresReceiptStore` reads and writes this table on
-- every write route, so without it the routes S2 wires up would be registered
-- and reachable and would fail on first use — CLAUDE.md rule 15 in its least
-- useful form. The proposal's shape is unchanged; only its status is.
--
-- This is at-most-once admission, not exactly-once. The receipt is claimed in
-- its own transaction before the domain work runs and completed in another
-- after it commits, so a crash in between leaves a row in 'started' that no
-- replay will ever resolve: the store answers 503 and deliberately does not
-- re-run the mutation. Choosing the stuck receipt over the double charge is
-- the whole point. Reconciling those rows is an operator's job, and there is
-- no sweeper here that would quietly make the choice the other way.

create table http_request_receipt (
  -- HMAC of (actor, idempotency key) under a server-side pepper, so a raw
  -- phone number, OTP code or bearer token never becomes a primary key.
  scope_hash text primary key check (scope_hash ~ '^[0-9a-f]{64}$'),
  -- sha256 of the canonical request. Same key, different request is a caller
  -- bug, and the store answers 409 rather than replaying the wrong outcome.
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  state text not null check (state in ('started','completed')),
  outcome jsonb,
  created_at timestamptz not null default clock_timestamp(),
  -- A completed receipt without an outcome has nothing to replay, and a
  -- started one with an outcome has replayed something that never finished.
  check ((state='started' and outcome is null) or (state='completed' and outcome is not null))
);

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

-- UPDATE is granted because 'started' -> 'completed' is the table's reason to
-- exist. DELETE and TRUNCATE are never granted: a receipt that can be deleted
-- is a replay that can be re-executed, and that is the double charge.
grant select, insert, update on http_request_receipt to app;
