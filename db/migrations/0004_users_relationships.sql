-- P2.2 — Users and relationships.
--
-- The table is `app_user`, not `user`. `user` is a reserved word: unquoted it
-- is a syntax error, and `select * from user` does not error at all — it
-- silently returns the current database username instead of the table's rows.
-- A forgotten quote would then produce a wrong answer rather than a failure,
-- which is not a trade worth making anywhere, least of all here.
--
-- Status changes on `relationship` are governed by 0003's mechanism: the
-- constraint trigger at the bottom refuses any status change that does not
-- carry an audit row written in the same transaction.

-- ---------------------------------------------------------------------------
-- Value shapes
-- ---------------------------------------------------------------------------

-- E.164: a plus, a non-zero country digit, then up to fourteen more. Stored
-- exactly as dialled with no separators, so the unique index below actually
-- catches the same number written two ways.
create or replace function user_is_e164(value text) returns boolean
language sql immutable parallel safe as $$
  select value ~ '^\+[1-9][0-9]{1,14}$'
$$;

-- ---------------------------------------------------------------------------
-- Users
-- ---------------------------------------------------------------------------

create table app_user (
  id          uuid        primary key default gen_random_uuid(),

  phone       text        not null unique
    constraint app_user_phone_e164 check (user_is_e164(phone)),

  -- PRD section 2 names exactly two personas. A user can hold both: the
  -- number that receives from one family member and sends to another is one
  -- user, not two (PRD feature 1, edge cases). Adding a role is deliberately
  -- a migration, as adding a currency is in 0001.
  roles       text[]      not null
    constraint app_user_roles_known check (roles <@ array['sender', 'recipient']::text[])
    -- cardinality, not array_length: array_length of an empty array is NULL,
    -- and a CHECK passes when its expression is NULL, so the obvious spelling
    -- of this constraint accepts exactly the value it is meant to reject.
    constraint app_user_roles_present check (cardinality(roles) >= 1),

  locale      text        not null default 'es'
    constraint app_user_locale_known check (locale in ('es', 'en')),

  preferred_channel text  not null default 'whatsapp'
    constraint app_user_channel_known check (preferred_channel in ('app', 'whatsapp', 'sms')),

  -- Neither the PRD nor the ticket enumerates the values for these two, so
  -- there is no value list to check against — only the identifier shape that
  -- keeps free text, and therefore PII, out of them. Same treatment as
  -- audit_log.assurance_level in 0003.
  identity_assurance_level text
    constraint app_user_assurance_shape
      check (identity_assurance_level is null or audit_is_identifier(identity_assurance_level)),
  kyc_status  text        not null default 'not_started'
    constraint app_user_kyc_shape check (audit_is_identifier(kyc_status)),

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Relationships
-- ---------------------------------------------------------------------------

create table relationship (
  id          uuid        primary key default gen_random_uuid(),
  seq         bigserial   not null unique,

  user_a_id   uuid        not null references app_user (id),
  user_b_id   uuid        not null references app_user (id),
  role_of_a   text        not null
    constraint relationship_role_of_a_known check (role_of_a in ('sender', 'recipient')),
  role_of_b   text        not null
    constraint relationship_role_of_b_known check (role_of_b in ('sender', 'recipient')),

  status      text        not null default 'invited'
    constraint relationship_status_known
      check (status in ('invited', 'active', 'paused', 'terminated')),

  invited_at  timestamptz not null default now(),
  activated_at timestamptz,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- Nobody is in a relationship with themselves. Enforced here rather than in
  -- application code, per the ticket.
  constraint relationship_not_self check (user_a_id <> user_b_id),

  -- One side sends and the other receives. With only two roles declared,
  -- both sides holding the same one is not a relationship this product has.
  constraint relationship_roles_differ check (role_of_a <> role_of_b),

  -- An invitation nobody has accepted has no activation time.
  constraint relationship_activated_at_absent_while_invited
    check (status <> 'invited' or activated_at is null)
);

-- Both directions are first-class, so both get an index. Neither is the
-- "real" one: a sender's recipients and a recipient's senders are read
-- equally often, and assuming otherwise is the one-sided thinking the PRD
-- warns against.
create index relationship_user_a_idx on relationship (user_a_id, status);
create index relationship_user_b_idx on relationship (user_b_id, status);

-- ---------------------------------------------------------------------------
-- Invitation expiry, derived
-- ---------------------------------------------------------------------------

-- The window lives in one place, as a function, so the database and the
-- application cannot drift on how long an invitation lasts.
create or replace function relationship_invitation_window() returns interval
language sql immutable parallel safe as $$
  select interval '14 days'
$$;

create or replace function relationship_invitation_expires_at(p_invited_at timestamptz)
returns timestamptz
language sql stable parallel safe as $$
  select p_invited_at + relationship_invitation_window()
$$;

-- Expiry is a reading of invited_at, never a stored flag a sweeper sets.
-- There is nothing to schedule and therefore nothing that can silently stop:
-- an invitation is expired exactly when the clock says so, and the guard runs
-- on the write that would matter.
--
-- Resending is what reopens the window, by moving invited_at forward. That is
-- not a status change, so it does not need an audit row to satisfy the
-- trigger below — though transition() writes one anyway.
create or replace function relationship_reject_expired_activation() returns trigger
language plpgsql as $$
begin
  if new.status = 'active'
     and old.status = 'invited'
     and now() > relationship_invitation_expires_at(old.invited_at) then
    raise exception
      'invitation for relationship % expired at %; resend it to open a new window',
      new.id, relationship_invitation_expires_at(old.invited_at)
      using errcode = 'RL001';
  end if;
  return new;
end
$$;

create trigger relationship_no_expired_activation
  before update on relationship
  for each row execute function relationship_reject_expired_activation();

-- ---------------------------------------------------------------------------
-- Keep updated_at honest
-- ---------------------------------------------------------------------------

create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end
$$;

create trigger app_user_set_updated_at
  before update on app_user
  for each row execute function set_updated_at();

create trigger relationship_set_updated_at
  before update on relationship
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Every status change carries its audit row (0003)
-- ---------------------------------------------------------------------------

select audit_enforce_transitions('relationship', 'status', 'relationship');

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

-- Unlike the ledger, these rows are meant to change: a status moves, a KYC
-- status moves. UPDATE is granted and the audit trigger governs how it may be
-- used. DELETE is not: a terminated relationship is retained and stays
-- viewable by both parties (PRD section 10), so there is nothing to delete.
grant select, insert, update on app_user, relationship to app;
grant usage, select on sequence relationship_seq_seq to app;
revoke delete, truncate on app_user, relationship from app;
