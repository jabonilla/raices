-- P2.3 — Money plans and immutable plan versions.
--
-- A plan is a pointer; its versions are the history. `plan_version` and
-- `category` are immutable in the same way the ledger is (0001): statement-
-- level triggers that stop everyone including the owner, plus grants the
-- `app` role never receives. `money_plan` is deliberately mutable, because
-- current_version_id is the pointer that moves forward.
--
-- Editing a plan writes a whole new version with its own category rows. That
-- is what lets a request reference the category of the version in force when
-- it was made: the row it points at can never be edited out from under it.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table money_plan (
  id              uuid        primary key default gen_random_uuid(),
  relationship_id uuid        not null references relationship (id),
  -- Null only in the instant between inserting the plan and its first
  -- version, inside one transaction. The foreign key is added below, once
  -- plan_version exists.
  current_version_id uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index money_plan_relationship_idx on money_plan (relationship_id);

create table plan_version (
  id             uuid        primary key default gen_random_uuid(),
  seq            bigserial   not null unique,
  plan_id        uuid        not null references money_plan (id),

  -- Gapless per plan, starting at 1. The unique constraint is what makes
  -- that safe under concurrency: two racing edits both compute the same next
  -- number, one commits, and the other is refused and retried by
  -- withSerializableTx with a fresh snapshot.
  version_number integer     not null
    constraint plan_version_number_positive check (version_number >= 1),

  created_by     uuid        not null references app_user (id),
  created_at     timestamptz not null default now(),

  constraint plan_version_number_unique unique (plan_id, version_number)
);

create table category (
  id              uuid        primary key default gen_random_uuid(),
  plan_version_id uuid        not null references plan_version (id),
  name            text        not null,
  icon            text        not null,

  -- Money is bigint minor units plus a currency (CLAUDE.md rule 1), never a
  -- float and never a bare number. Both columns are null together or set
  -- together: an amount without a currency is not money.
  --
  -- Null means no cap. Zero means a cap of zero, which forbids spending in
  -- this category. They are different answers and are stored differently.
  monthly_cap_minor    bigint,
  monthly_cap_currency char(3),

  is_system       boolean     not null default false,
  created_at      timestamptz not null default now(),

  constraint category_cap_complete check (
    (monthly_cap_minor is null and monthly_cap_currency is null)
    or (monthly_cap_minor is not null and monthly_cap_currency is not null)
  ),
  constraint category_cap_non_negative check (
    monthly_cap_minor is null or monthly_cap_minor >= 0
  ),
  constraint category_cap_currency_supported check (
    monthly_cap_currency is null or monthly_cap_currency in ('USD', 'GTQ')
  )
);

create index category_plan_version_idx on category (plan_version_id);

alter table money_plan
  add constraint money_plan_current_version_fkey
  foreign key (current_version_id) references plan_version (id);

-- ---------------------------------------------------------------------------
-- Immutability
-- ---------------------------------------------------------------------------

create or replace function plan_reject_mutation() returns trigger
language plpgsql as $$
begin
  raise exception
    'plan history is immutable: % on % is not permitted. Edits create a new plan_version.',
    tg_op, tg_table_name
    using errcode = 'PL001';
end
$$;

-- Statement-level rather than row-level, so a statement is refused even when
-- it would match no rows. A row-level trigger never fires on an empty table,
-- which would let `delete from category` silently succeed.
create trigger plan_version_immutable
  before update or delete on plan_version
  for each statement execute function plan_reject_mutation();

create trigger plan_version_no_truncate
  before truncate on plan_version
  for each statement execute function plan_reject_mutation();

create trigger category_immutable
  before update or delete on category
  for each statement execute function plan_reject_mutation();

create trigger category_no_truncate
  before truncate on category
  for each statement execute function plan_reject_mutation();

create trigger money_plan_set_updated_at
  before update on money_plan
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

grant select, insert on plan_version, category to app;
grant usage, select on sequence plan_version_seq_seq to app;

-- money_plan takes UPDATE because its pointer moves; the history tables
-- never do. Explicit, so the intent survives a future blanket GRANT.
grant select, insert, update on money_plan to app;

revoke update, delete, truncate on plan_version, category from app;
revoke delete, truncate on money_plan from app;
