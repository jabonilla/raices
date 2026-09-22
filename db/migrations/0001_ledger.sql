-- P1.2 — Ledger schema and append-only enforcement.
--
-- The guarantees here live in the database, not in application code. Triggers
-- stop everyone including the table owner; the revoked grants stop the `app`
-- role a layer earlier, at the permission check. Both are required: a grant
-- alone would not stop a migration or a console session, and a trigger alone
-- can be bypassed by a superuser setting session_replication_role.

-- ---------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------

-- Roles are cluster-wide, so this migration may meet an `app` that already
-- exists from another database in the same cluster.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app') then
    create role app;
  end if;
end
$$;

grant usage on schema public to app;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table ledger_account (
  id          uuid        primary key default gen_random_uuid(),
  code        text        not null unique,
  type        text        not null check (type in ('asset', 'liability', 'equity', 'revenue', 'expense')),
  currency    char(3)     not null,
  created_at  timestamptz not null default now(),

  -- Redundant against the primary key, but a composite foreign key needs a
  -- unique constraint on exactly these columns to point at.
  constraint ledger_account_id_currency_key unique (id, currency)
);

create table ledger_transaction (
  id               uuid        primary key default gen_random_uuid(),
  seq              bigserial   not null unique,
  idempotency_key  text        not null unique,
  request_hash     text        not null,   -- sha256 of the canonical request
  description      text        not null,
  occurred_at      timestamptz not null,   -- business time, not write time
  created_at       timestamptz not null default now()
);

create table ledger_entry (
  id              uuid        primary key default gen_random_uuid(),
  seq             bigserial   not null unique,
  transaction_id  uuid        not null references ledger_transaction (id),
  account_id      uuid        not null,
  direction       text        not null check (direction in ('debit', 'credit')),
  amount_minor    bigint      not null check (amount_minor > 0),
  currency        char(3)     not null,
  entry_type      text        not null,
  created_at      timestamptz not null default now(),

  -- An entry cannot claim a currency its account does not hold. Enforced
  -- structurally rather than by a trigger, so it cannot be deferred away.
  constraint ledger_entry_account_currency_fkey
    foreign key (account_id, currency) references ledger_account (id, currency)
);

create index ledger_entry_transaction_id_idx on ledger_entry (transaction_id);
create index ledger_entry_account_id_seq_idx on ledger_entry (account_id, seq);

-- ---------------------------------------------------------------------------
-- Append-only
-- ---------------------------------------------------------------------------

create or replace function ledger_reject_mutation() returns trigger
language plpgsql as $$
begin
  raise exception
    'ledger tables are append-only: % on % is not permitted. Corrections are new compensating transactions.',
    tg_op, tg_table_name
    using errcode = 'LG001';
end
$$;

-- Statement-level rather than row-level, so a statement is refused even when
-- it would match no rows. A row-level trigger never fires on an empty table,
-- which would let `delete from ledger_entry` silently succeed.
create trigger ledger_account_append_only
  before update or delete on ledger_account
  for each statement execute function ledger_reject_mutation();

create trigger ledger_account_no_truncate
  before truncate on ledger_account
  for each statement execute function ledger_reject_mutation();

create trigger ledger_transaction_append_only
  before update or delete on ledger_transaction
  for each statement execute function ledger_reject_mutation();

create trigger ledger_transaction_no_truncate
  before truncate on ledger_transaction
  for each statement execute function ledger_reject_mutation();

create trigger ledger_entry_append_only
  before update or delete on ledger_entry
  for each statement execute function ledger_reject_mutation();

create trigger ledger_entry_no_truncate
  before truncate on ledger_entry
  for each statement execute function ledger_reject_mutation();

-- ---------------------------------------------------------------------------
-- Balance, checked at commit
-- ---------------------------------------------------------------------------

create or replace function ledger_assert_transaction_balanced() returns trigger
language plpgsql as $$
declare
  entry_count    bigint;
  unbalanced_ccy text;
begin
  select count(*) into entry_count
  from ledger_entry
  where transaction_id = new.transaction_id;

  if entry_count < 2 then
    raise exception
      'ledger transaction % has % entry(ies); double-entry requires at least 2',
      new.transaction_id, entry_count
      using errcode = 'LG003';
  end if;

  -- Debits must equal credits within each currency. Summing across currencies
  -- would let a USD leg cancel a GTQ leg.
  select currency into unbalanced_ccy
  from ledger_entry
  where transaction_id = new.transaction_id
  group by currency
  having sum(case when direction = 'debit'  then amount_minor else 0 end)
      <> sum(case when direction = 'credit' then amount_minor else 0 end)
  limit 1;

  if unbalanced_ccy is not null then
    raise exception
      'ledger transaction % does not balance in %: debits <> credits',
      new.transaction_id, unbalanced_ccy
      using errcode = 'LG002';
  end if;

  return null;
end
$$;

-- Deferred to commit: the entries of one transaction are written as a group,
-- so the books are only required to balance once that group is complete.
create constraint trigger ledger_entry_balanced
  after insert on ledger_entry
  deferrable initially deferred
  for each row execute function ledger_assert_transaction_balanced();

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

grant select, insert on ledger_account, ledger_transaction, ledger_entry to app;

-- bigserial columns need the sequence to be usable by whoever inserts.
grant usage, select on sequence ledger_transaction_seq_seq, ledger_entry_seq_seq to app;

-- CLAUDE.md: the app role has no UPDATE, DELETE or TRUNCATE grant on ledger
-- tables. Explicit, so the intent survives a future blanket GRANT.
revoke update, delete, truncate on ledger_account, ledger_transaction, ledger_entry from app;
