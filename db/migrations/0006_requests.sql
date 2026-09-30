-- P2.4 — Requests and trust tier classification.
--
-- A request is the record of what somebody asked for. The ask is immutable:
-- once made, only its resolution moves. That is what lets the audit log and
-- the tier mean anything later — a tier that could be edited after the fact
-- would record the decision somebody wished they had made.
--
-- The tier itself is decided outside the database, by the pure classifier in
-- apps/api/src/requests/tier/. This table stores the answer and constrains it
-- to the four the PRD names; it does not re-derive it. Two implementations of
-- one business rule is one too many.
--
-- PRD invariant 3 — a declined request never becomes a transaction — has no
-- constraint here, because after this migration there is nothing to constrain:
-- no foreign key exists in either direction between `request` and the ledger
-- tables, so no transaction can be attributed to a request at all. P2.5
-- introduces the transaction record and that link; the invariant becomes
-- enforceable there. Until then it is held by the row-count test and by
-- `RequestDatabase`, which omits the ledger tables so that requests code
-- cannot post even by mistake.

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

create table request (
  id              uuid        primary key default gen_random_uuid(),
  seq             bigserial   not null unique,

  relationship_id uuid        not null references relationship (id),
  requested_by    uuid        not null references app_user (id),

  -- Money is bigint minor units plus a currency (CLAUDE.md rule 1).
  amount_minor    bigint      not null,
  amount_currency char(3)     not null,

  -- Null is a request that names no category from any plan, which is how a
  -- request made before the sender has a plan is stored. It classifies as
  -- unrecognized and waits for a person, rather than being refused at the
  -- door: a recipient asking for help should never hit a schema error.
  --
  -- A set category points at a `category` row, which belongs to one immutable
  -- plan_version. So a request records the category *as it was worded when
  -- the request was made*, and a later plan edit cannot move it.
  category_id     uuid        references category (id),

  description     text        not null,
  tier            text        not null,
  is_emergency    boolean     not null default false,
  channel_of_origin text      not null,

  status          text        not null default 'pending',
  resolved_by     uuid        references app_user (id),
  resolved_at     timestamptz,
  decline_reason  text,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint request_amount_positive check (amount_minor > 0),

  constraint request_currency_supported check (amount_currency in ('USD', 'GTQ')),

  -- Feature 1: a description of at most 200 characters. Empty or blank is not
  -- a purpose, and "every transaction stores its purpose" is the feature.
  constraint request_description_length check (
    length(description) <= 200 and length(btrim(description)) >= 1
  ),

  constraint request_tier_known check (
    tier in ('recurring', 'planned_investment', 'emergency', 'unrecognized')
  ),

  -- PRD section 3: the app is additive. A request may arrive on any channel.
  constraint request_channel_known check (channel_of_origin in ('app', 'whatsapp', 'sms')),

  constraint request_status_known check (
    status in ('pending', 'approved', 'declined', 'expired')
  ),

  -- Feature 1: "Declining requires a reason — selected or written (<=200
  -- chars)." Enforced here rather than only in the service, so a decline
  -- written by any path carries one. A reason on a request that was not
  -- declined is equally wrong: it would read as a decline in the history.
  constraint request_decline_reason_matches_status check (
    case
      when status = 'declined' then
        decline_reason is not null
        and length(decline_reason) <= 200
        and length(btrim(decline_reason)) >= 1
      else decline_reason is null
    end
  ),

  -- Pending means nobody has decided. Approved and declined are somebody's
  -- decision, so they name that person. Expired is nobody's: it is the
  -- absence of a decision, so it has a time but no actor, and attributing it
  -- to a person would put a choice in their mouth they never made.
  constraint request_resolution_matches_status check (
    case status
      when 'pending' then resolved_at is null and resolved_by is null
      when 'expired' then resolved_at is not null and resolved_by is null
      else resolved_at is not null and resolved_by is not null
    end
  )
);

create index request_relationship_idx on request (relationship_id);
create index request_requested_by_idx on request (requested_by);

-- Spend to date is summed per relationship and category over a window, which
-- is the read the classifier's caller makes on every submission.
create index request_spend_idx on request (relationship_id, category_id, status, created_at);

-- ---------------------------------------------------------------------------
-- The ask is frozen; only its resolution moves
-- ---------------------------------------------------------------------------

create or replace function request_reject_frozen_change() returns trigger
language plpgsql as $$
begin
  if new.relationship_id   is distinct from old.relationship_id
  or new.requested_by      is distinct from old.requested_by
  or new.amount_minor      is distinct from old.amount_minor
  or new.amount_currency   is distinct from old.amount_currency
  or new.category_id       is distinct from old.category_id
  or new.description       is distinct from old.description
  or new.tier              is distinct from old.tier
  or new.is_emergency      is distinct from old.is_emergency
  or new.channel_of_origin is distinct from old.channel_of_origin
  or new.created_at        is distinct from old.created_at
  then
    raise exception
      'request %: the ask is immutable. Only status, resolved_by, resolved_at and '
      'decline_reason may change. Submit a new request instead.', old.id
      using errcode = 'RQ001';
  end if;

  return new;
end
$$;

-- `tier` is in that list because Feature 1 classifies "at submission". A tier
-- that could be rewritten afterwards would let a request be reclassified into
-- auto-approval after the fact.
--
-- `is_emergency` is in it because of PRD line 221: "Emergency status cannot
-- be applied retroactively." Clearing one is the same rewrite in the other
-- direction, so neither is permitted.
create trigger request_ask_frozen
  before update on request
  for each row execute function request_reject_frozen_change();

create or replace function request_reject_removal() returns trigger
language plpgsql as $$
begin
  raise exception
    'requests are retained: % on % is not permitted. A declined request remains a request.',
    tg_op, tg_table_name
    using errcode = 'RQ001';
end
$$;

-- Statement-level, so a statement is refused even when it matches no rows: a
-- row-level trigger never fires on an empty table, which would let
-- `delete from request` silently succeed.
create trigger request_no_delete
  before delete on request
  for each statement execute function request_reject_removal();

create trigger request_no_truncate
  before truncate on request
  for each statement execute function request_reject_removal();

create trigger request_set_updated_at
  before update on request
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- A request's category belongs to the same relationship's plan
-- ---------------------------------------------------------------------------

-- The foreign key proves the category exists. It cannot prove it is one of
-- *this* relationship's categories, and without that a request in one
-- relationship could be filed against another's plan — and then counted
-- against that plan's cap.
create or replace function request_check_category_relationship() returns trigger
language plpgsql as $$
declare
  v_relationship uuid;
begin
  if new.category_id is null then
    return null;
  end if;

  select p.relationship_id into v_relationship
    from category c
    join plan_version v on v.id = c.plan_version_id
    join money_plan p on p.id = v.plan_id
   where c.id = new.category_id;

  if v_relationship is distinct from new.relationship_id then
    raise exception
      'request %: category % belongs to another relationship''s plan', new.id, new.category_id
      using errcode = 'RQ002';
  end if;

  return null;
end
$$;

create constraint trigger request_category_same_relationship
  after insert or update on request
  deferrable initially deferred
  for each row execute function request_check_category_relationship();

-- ---------------------------------------------------------------------------
-- Audit
-- ---------------------------------------------------------------------------

-- Every status change writes an audit row in the same transaction, or the
-- change is refused at commit (0003_audit.sql, AU002).
select audit_enforce_transitions('request', 'status', 'request');

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

grant select, insert, update on request to app;
grant usage, select on sequence request_seq_seq to app;

revoke delete, truncate on request from app;
