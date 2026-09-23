-- P1.5 — Reconciliation model.
--
-- Our ledger is authoritative for intent; the provider is authoritative for
-- settlement. Nothing here writes to a ledger table, and nothing here is a
-- ledger table: reconciliation records disagreement, it never resolves it by
-- moving money. A correction is a new posting, made deliberately elsewhere.

-- ---------------------------------------------------------------------------
-- What we intended to happen with a provider
-- ---------------------------------------------------------------------------

create table expected_settlement (
  id                     uuid        primary key default gen_random_uuid(),
  seq                    bigserial   not null unique,

  -- Which provider this expectation is with. Data, not a branch: no logic
  -- keys off the value (CLAUDE.md rule 7). Without it a run for one provider
  -- would read every other provider's expectations and report them missing.
  provider               text        not null,
  provider_ref           text        not null,

  amount_minor           bigint      not null check (amount_minor > 0),
  currency               char(3)     not null
    constraint expected_settlement_currency_supported check (currency in ('USD', 'GTQ')),

  expected_state         text        not null,
  expected_by            timestamptz not null,

  ledger_transaction_id  uuid        not null references ledger_transaction (id),

  -- Append-only: a change is a new row pointing at the one it replaces.
  supersedes_id          uuid        references expected_settlement (id),

  created_at             timestamptz not null default now()
);

create index expected_settlement_provider_ref_idx
  on expected_settlement (provider, provider_ref);
create index expected_settlement_transaction_idx
  on expected_settlement (ledger_transaction_id);
-- A row may only be superseded once, so history stays a chain rather than a tree.
create unique index expected_settlement_supersedes_unique_idx
  on expected_settlement (supersedes_id)
  where supersedes_id is not null;

-- ---------------------------------------------------------------------------
-- What the provider says happened
-- ---------------------------------------------------------------------------

create table provider_statement_line (
  id            uuid        primary key default gen_random_uuid(),
  seq           bigserial   not null unique,

  provider      text        not null,
  statement_id  text        not null,
  line_ref      text        not null,

  provider_ref  text        not null,
  amount_minor  bigint      not null check (amount_minor > 0),
  currency      char(3)     not null
    constraint provider_statement_line_currency_supported check (currency in ('USD', 'GTQ')),
  state         text        not null,
  settled_at    timestamptz,

  -- The provider's own payload, kept verbatim so a disagreement can always be
  -- traced back to what they actually sent.
  raw           jsonb       not null,

  created_at    timestamptz not null default now(),

  constraint provider_statement_line_identity unique (provider, statement_id, line_ref)
);

create index provider_statement_line_statement_idx
  on provider_statement_line (provider, statement_id);
create index provider_statement_line_provider_ref_idx
  on provider_statement_line (provider, provider_ref);

-- ---------------------------------------------------------------------------
-- Runs and what they found
-- ---------------------------------------------------------------------------

create table reconciliation_run (
  id            uuid        primary key default gen_random_uuid(),
  seq           bigserial   not null unique,

  provider      text        not null,
  statement_id  text        not null,

  started_at    timestamptz not null default now(),
  finished_at   timestamptz,

  -- sha256 over the canonical inputs. Unique, so re-running the same inputs
  -- returns the existing run instead of producing a second set of findings.
  input_hash    text        not null unique
);

create table reconciliation_discrepancy (
  id                 uuid        primary key default gen_random_uuid(),
  seq                bigserial   not null unique,

  run_id             uuid        not null references reconciliation_run (id),
  kind               text        not null check (
    kind in ('missing', 'unexpected', 'amount_mismatch', 'state_mismatch', 'timing')
  ),

  expected_id        uuid        references expected_settlement (id),
  statement_line_id  uuid        references provider_statement_line (id),

  details            jsonb       not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),

  -- Every kind points at something. `missing` has no line, `unexpected` has
  -- no expectation, and the three match-based kinds have both.
  constraint reconciliation_discrepancy_refs check (
    case kind
      when 'missing'    then expected_id is not null and statement_line_id is null
      when 'unexpected' then expected_id is null     and statement_line_id is not null
      else                   expected_id is not null and statement_line_id is not null
    end
  )
);

create index reconciliation_discrepancy_run_idx on reconciliation_discrepancy (run_id, seq);

-- ---------------------------------------------------------------------------
-- Append-only
-- ---------------------------------------------------------------------------

-- Reuses the function 0001 installed: these tables are evidence, and evidence
-- that can be edited is not evidence. Statement-level, so a statement is
-- refused even when it would match no rows.
create trigger expected_settlement_append_only
  before update or delete on expected_settlement
  for each statement execute function ledger_reject_mutation();

create trigger expected_settlement_no_truncate
  before truncate on expected_settlement
  for each statement execute function ledger_reject_mutation();

create trigger provider_statement_line_append_only
  before update or delete on provider_statement_line
  for each statement execute function ledger_reject_mutation();

create trigger provider_statement_line_no_truncate
  before truncate on provider_statement_line
  for each statement execute function ledger_reject_mutation();

create trigger reconciliation_discrepancy_append_only
  before update or delete on reconciliation_discrepancy
  for each statement execute function ledger_reject_mutation();

create trigger reconciliation_discrepancy_no_truncate
  before truncate on reconciliation_discrepancy
  for each statement execute function ledger_reject_mutation();

-- reconciliation_run is deliberately NOT append-only for UPDATE: a run is
-- opened, then stamped with finished_at when it completes. DELETE and
-- TRUNCATE are still refused.
create or replace function reconciliation_run_only_finishes() returns trigger
language plpgsql as $$
begin
  if new.id is distinct from old.id
     or new.provider is distinct from old.provider
     or new.statement_id is distinct from old.statement_id
     or new.input_hash is distinct from old.input_hash
     or new.started_at is distinct from old.started_at
     or new.seq is distinct from old.seq then
    raise exception
      'reconciliation_run is immutable except for finished_at'
      using errcode = 'LG001';
  end if;
  return new;
end
$$;

create trigger reconciliation_run_immutable_except_finished_at
  before update on reconciliation_run
  for each row execute function reconciliation_run_only_finishes();

create trigger reconciliation_run_no_delete
  before delete on reconciliation_run
  for each statement execute function ledger_reject_mutation();

create trigger reconciliation_run_no_truncate
  before truncate on reconciliation_run
  for each statement execute function ledger_reject_mutation();

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

grant select, insert on
  expected_settlement, provider_statement_line, reconciliation_run, reconciliation_discrepancy
  to app;

-- Only the finished_at stamp.
grant update (finished_at) on reconciliation_run to app;

grant usage, select on sequence
  expected_settlement_seq_seq,
  provider_statement_line_seq_seq,
  reconciliation_run_seq_seq,
  reconciliation_discrepancy_seq_seq
  to app;

revoke delete, truncate on
  expected_settlement, provider_statement_line, reconciliation_run, reconciliation_discrepancy
  from app;

revoke update on
  expected_settlement, provider_statement_line, reconciliation_discrepancy
  from app;
