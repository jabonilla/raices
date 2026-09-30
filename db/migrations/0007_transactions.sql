-- P2.5 — The transaction record: the join between an approved request and
-- the ledger.
--
-- CLAUDE.md rule 4, and the reason this table exists at all: intent state and
-- settlement state are separate columns. "What the two of them agreed to do"
-- and "what the money actually did" are different facts that move at
-- different times and can disagree. A payout can fail on a commitment nobody
-- withdrew; a commitment can be cancelled before any money moves. Collapsing
-- them into one status means one of those two truths gets overwritten by the
-- other, and the one that loses is usually the one the customer is asking
-- about.
--
-- Neither column is derived from the other, there is no third column holding
-- a blend, and no generated column or view may reintroduce one. Tests in
-- apps/api/test/transactions-schema.test.ts fail if any of that changes.

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

create table transaction (
  id              uuid        primary key default gen_random_uuid(),
  seq             bigserial   not null unique,

  -- One transaction per request, enforced by the unique constraint rather
  -- than by whoever remembers to check first. This is what makes approving
  -- twice safe even if the ledger's own idempotency were bypassed.
  request_id      uuid        not null unique references request (id),
  relationship_id uuid        not null references relationship (id),

  amount_minor    bigint      not null,
  amount_currency char(3)     not null,

  -- The two states. Note there is no `status`.
  intent_state    text        not null default 'committed',
  settlement_state text       not null default 'not_started',

  approved_by     uuid        not null references app_user (id),
  approved_at     timestamptz not null default now(),
  -- What we knew about who approved, at the time they approved. Recorded
  -- here rather than read from app_user later, because assurance changes and
  -- the question this answers is about the moment of approval.
  assurance_level_at_approval text,

  -- Filled in when a provider is actually called. P2.5 calls none.
  settlement_provider   text,
  provider_reference_id text,

  -- A rate is a ratio, not money, so it is numeric rather than bigint minor
  -- units. Exact decimal, never double precision: the disclosed rate and the
  -- applied rate must be the same number, and a float would make them differ
  -- in the last place a customer can check.
  fx_rate_applied numeric(20, 10),

  -- Money, so bigint minor units plus a currency (CLAUDE.md rule 1).
  fee_minor       bigint,
  fee_currency    char(3),
  -- What lands on the other side, after fees and FX.
  recipient_amount_minor    bigint,
  recipient_amount_currency char(3),

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint transaction_amount_positive check (amount_minor > 0),
  constraint transaction_currency_supported check (amount_currency in ('USD', 'GTQ')),

  constraint transaction_intent_state_known check (
    intent_state in ('committed', 'cancelled')
  ),
  constraint transaction_settlement_state_known check (
    settlement_state in ('not_started', 'instructed', 'in_flight', 'settled', 'failed', 'reversed')
  ),

  constraint transaction_assurance_level_shape check (
    assurance_level_at_approval is null
    or assurance_level_at_approval ~ '^[a-z][a-z0-9_]*$'
  ),

  constraint transaction_fx_rate_positive check (
    fx_rate_applied is null or fx_rate_applied > 0
  ),

  constraint transaction_fee_complete check (
    (fee_minor is null and fee_currency is null)
    or (fee_minor is not null and fee_currency is not null)
  ),
  constraint transaction_fee_non_negative check (fee_minor is null or fee_minor >= 0),
  constraint transaction_fee_currency_supported check (
    fee_currency is null or fee_currency in ('USD', 'GTQ')
  ),

  constraint transaction_recipient_amount_complete check (
    (recipient_amount_minor is null and recipient_amount_currency is null)
    or (recipient_amount_minor is not null and recipient_amount_currency is not null)
  ),
  constraint transaction_recipient_amount_positive check (
    recipient_amount_minor is null or recipient_amount_minor > 0
  ),
  constraint transaction_recipient_amount_currency_supported check (
    recipient_amount_currency is null or recipient_amount_currency in ('USD', 'GTQ')
  ),

  -- The pair guard, as a constraint for the rows that are born wrong. The
  -- trigger below covers the ones that are updated wrong.
  constraint transaction_cancelled_intent_has_no_settlement check (
    intent_state = 'committed' or settlement_state = 'not_started'
  )
);

create index transaction_relationship_idx on transaction (relationship_id);
create index transaction_settlement_state_idx on transaction (settlement_state);

-- ---------------------------------------------------------------------------
-- PRD invariant 3: a declined request never becomes a transaction
-- ---------------------------------------------------------------------------

-- P2.4 could not enforce this: there was no link in either direction between
-- a request and a transaction, so there was nothing to constrain. There is
-- now, so it is a constraint rather than a convention.
--
-- Deferred, so a transaction may be written in the same transaction that
-- approves the request, in either order.
create or replace function transaction_check_request_approved() returns trigger
language plpgsql as $$
declare
  v_status text;
begin
  select status into v_status from request where id = new.request_id;

  if v_status is distinct from 'approved' then
    raise exception
      'request % is %, so it cannot have a transaction (PRD invariant 3)',
      new.request_id, coalesce(v_status, 'missing')
      using errcode = 'TX002',
            hint = 'Only an approved request becomes a transaction. A declined one stays a request.';
  end if;

  return null;
end
$$;

create constraint trigger transaction_request_approved
  after insert or update on transaction
  deferrable initially deferred
  for each row execute function transaction_check_request_approved();

-- ---------------------------------------------------------------------------
-- The two states move independently, within limits
-- ---------------------------------------------------------------------------

-- Independent does not mean unrelated. Two pairings are incoherent rather
-- than merely unusual, and both are about money moving after the agreement
-- to move it was withdrawn.
create or replace function transaction_check_state_pair() returns trigger
language plpgsql as $$
begin
  if new.intent_state = 'cancelled' and old.intent_state <> 'cancelled'
     and old.settlement_state <> 'not_started' then
    raise exception
      'transaction %: settlement is already %, so intent cannot be cancelled',
      old.id, old.settlement_state
      using errcode = 'TX001',
            hint = 'Money has already been instructed. Reverse the settlement instead of cancelling the intent.';
  end if;

  if new.settlement_state <> old.settlement_state and new.intent_state = 'cancelled' then
    raise exception
      'transaction %: intent is cancelled, so settlement cannot advance to %',
      old.id, new.settlement_state
      using errcode = 'TX001',
            hint = 'A cancelled intent is an instruction not to move money.';
  end if;

  return new;
end
$$;

create trigger transaction_state_pair
  before update on transaction
  for each row execute function transaction_check_state_pair();

-- ---------------------------------------------------------------------------
-- The agreement is frozen; only its execution moves
-- ---------------------------------------------------------------------------

create or replace function transaction_reject_frozen_change() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' or tg_op = 'TRUNCATE' then
    raise exception
      'transactions are retained: % on % is not permitted', tg_op, tg_table_name
      using errcode = 'TX003';
  end if;

  if new.request_id      is distinct from old.request_id
  or new.relationship_id is distinct from old.relationship_id
  or new.amount_minor    is distinct from old.amount_minor
  or new.amount_currency is distinct from old.amount_currency
  or new.approved_by     is distinct from old.approved_by
  or new.approved_at     is distinct from old.approved_at
  or new.created_at      is distinct from old.created_at
  then
    raise exception
      'transaction %: what was agreed is immutable. Only the state columns and the '
      'settlement details may change.', old.id
      using errcode = 'TX003';
  end if;

  return new;
end
$$;

create trigger transaction_agreement_frozen
  before update on transaction
  for each row execute function transaction_reject_frozen_change();

-- Statement-level for removal, so a statement matching no rows is still
-- refused: `delete from transaction` on an empty table must not succeed.
create trigger transaction_no_delete
  before delete on transaction
  for each statement execute function transaction_reject_frozen_change();

create trigger transaction_no_truncate
  before truncate on transaction
  for each statement execute function transaction_reject_frozen_change();

create trigger transaction_set_updated_at
  before update on transaction
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Audit
-- ---------------------------------------------------------------------------

-- Both fields, separately. Each gets its own entity type, so an audit row
-- for one cannot authorise a change to the other and each field's history is
-- readable on its own.
select audit_enforce_transitions('transaction', 'intent_state', 'transaction_intent');
select audit_enforce_transitions('transaction', 'settlement_state', 'transaction_settlement');

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

grant select, insert, update on transaction to app;
grant usage, select on sequence transaction_seq_seq to app;

revoke delete, truncate on transaction from app;
