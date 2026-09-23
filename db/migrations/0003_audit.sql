-- P2.1 — Audit log and the state-transition mechanism.
--
-- CLAUDE.md rule 5: every state transition writes an audit event row. Phase 2
-- adds four state machines, so the mechanism comes first and they all use it.
--
-- The guarantees here live in the database, not in application code, for the
-- same reasons as the ledger in 0001: triggers stop everyone including the
-- table owner, while the revoked grants stop the `app` role a layer earlier at
-- the permission check. A grant alone would not stop a migration or a console
-- session; a trigger alone can be bypassed by a superuser setting
-- session_replication_role.

-- ---------------------------------------------------------------------------
-- No PII, enforced rather than asked for
-- ---------------------------------------------------------------------------

-- The ticket says audit rows store entity ids and state names, never phone
-- numbers, names or amounts in free text. Every column that could carry free
-- text is therefore constrained to an identifier shape. A phone number cannot
-- match (it does not start with a letter), and neither can a person's name or
-- a sentence (both contain spaces or capitals). This turns a rule that would
-- otherwise rely on reviewer vigilance into one the database keeps.

/** A lower_snake_case identifier: the shape of a state name or an entity type. */
create or replace function audit_is_identifier(value text) returns boolean
language sql immutable parallel safe as $$
  select value ~ '^[a-z][a-z0-9_]*$'
$$;

/** A dotted identifier, e.g. `relationship.activate`. */
create or replace function audit_is_action(value text) returns boolean
language sql immutable parallel safe as $$
  select value ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'
$$;

/**
 * A state snapshot: exactly `{"state": "<identifier>"}`, or null.
 *
 * Restricting the shape is what keeps PII out of the jsonb columns. A caller
 * cannot smuggle a phone number in beside the state name, because any key but
 * `state` is refused.
 */
create or replace function audit_is_state(value jsonb) returns boolean
language sql immutable parallel safe as $$
  select value is null
     or (
       jsonb_typeof(value) = 'object'
       and (select count(*) from jsonb_object_keys(value)) = 1
       and value ? 'state'
       and jsonb_typeof(value -> 'state') = 'string'
       and audit_is_identifier(value ->> 'state')
     )
$$;

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

create table audit_log (
  id              uuid        primary key default gen_random_uuid(),
  seq             bigserial   not null unique,

  -- Null only for the system actor: a scheduled expiry has no person behind
  -- it. A user or an agent always has an id.
  actor_id        uuid,
  actor_kind      text        not null
    constraint audit_log_actor_kind_known check (actor_kind in ('user', 'system', 'agent')),

  action          text        not null
    constraint audit_log_action_shape check (audit_is_action(action)),
  entity_type     text        not null
    constraint audit_log_entity_type_shape check (audit_is_identifier(entity_type)),
  entity_id       uuid        not null,

  -- PRD section 3's channel model: App, WhatsApp, SMS. Null for a transition
  -- no channel originated, such as an expiry. Adding a channel is deliberately
  -- a migration, as adding a currency is in 0001.
  channel         text
    constraint audit_log_channel_known check (channel in ('app', 'whatsapp', 'sms')),

  -- PRD section 9 lists assurance_level on AuditLog; the P2.1 ticket's column
  -- list omits it. Because this table is append-only, a column added later can
  -- never be backfilled for rows already written, so it is created now and
  -- left nullable. Feature 5 defines its values; the PRD does not enumerate
  -- them, so there is no CHECK against a value list here — only the identifier
  -- shape that keeps free text out.
  assurance_level text
    constraint audit_log_assurance_level_shape
      check (assurance_level is null or audit_is_identifier(assurance_level)),

  -- Null when there is no prior state, i.e. a creation event.
  before_state    jsonb
    constraint audit_log_before_state_shape check (audit_is_state(before_state)),
  after_state     jsonb       not null
    constraint audit_log_after_state_shape check (audit_is_state(after_state)),

  created_at      timestamptz not null default now(),

  constraint audit_log_actor_id_present_for_people
    check (actor_kind = 'system' or actor_id is not null)
);

-- An entity's history, in order. CLAUDE.md: order by seq, never created_at.
create index audit_log_entity_idx on audit_log (entity_type, entity_id, seq);

-- ---------------------------------------------------------------------------
-- Append-only
-- ---------------------------------------------------------------------------

create or replace function audit_reject_mutation() returns trigger
language plpgsql as $$
begin
  raise exception
    'audit_log is append-only: % on % is not permitted. The audit trail is the record of what happened, so it is never edited.',
    tg_op, tg_table_name
    using errcode = 'AU001';
end
$$;

-- Statement-level rather than row-level, so a statement is refused even when
-- it would match no rows. A row-level trigger never fires on an empty table,
-- which would let `delete from audit_log` silently succeed.
create trigger audit_log_append_only
  before update or delete on audit_log
  for each statement execute function audit_reject_mutation();

create trigger audit_log_no_truncate
  before truncate on audit_log
  for each statement execute function audit_reject_mutation();

-- ---------------------------------------------------------------------------
-- A state change cannot commit without its audit row
-- ---------------------------------------------------------------------------

-- transition() writes both inside one transaction, which makes them atomic for
-- code that calls transition(). That is not the same as impossible: a bare
-- UPDATE elsewhere would still move an entity silently. This trigger closes
-- that gap in the database, so the rule holds regardless of how the write
-- arrives.
--
-- It is attached per state table by audit_enforce_transitions() below, and
-- fires on UPDATE only. Creating a row is not a transition: there is no prior
-- state to move from, and the table that owns the column is responsible for
-- constraining which state a row may be born in.
--
-- The table it is attached to must have a uuid `id` primary key, which every
-- table in this schema does.
create or replace function audit_require_row() returns trigger
language plpgsql as $$
declare
  v_state_column text := tg_argv[0];
  v_entity_type  text := tg_argv[1];
  v_new_state    text;
  v_old_state    text;
  v_matches      bigint;
begin
  execute format('select ($1).%I::text', v_state_column) into v_new_state using new;
  execute format('select ($1).%I::text', v_state_column) into v_old_state using old;

  -- An update that leaves the state alone is not a transition.
  if v_old_state is not distinct from v_new_state then
    return null;
  end if;

  -- The audit row must have been written by this transaction. Accepting any
  -- matching row would let an old one authorise a later change back to a state
  -- the entity has already been in.
  select count(*) into v_matches
  from audit_log a
  where a.entity_type = v_entity_type
    and a.entity_id = new.id
    and a.after_state ->> 'state' = v_new_state
    and a.xmin = pg_current_xact_id()::xid;

  if v_matches = 0 then
    raise exception
      'state change on %.% from "%" to "%" has no audit_log row in this transaction',
      v_entity_type, new.id, v_old_state, v_new_state
      using errcode = 'AU002',
            hint = 'Write state changes through transition(), which records the audit row alongside the change.';
  end if;

  return null;
end
$$;

/**
 * Require an audit row for every change to `p_state_column` on `p_table`.
 *
 * Deferred to commit, so the state change and its audit row may be written in
 * either order within the transaction.
 */
create or replace function audit_enforce_transitions(
  p_table        regclass,
  p_state_column text,
  p_entity_type  text
) returns void
language plpgsql as $$
begin
  if not audit_is_identifier(p_entity_type) then
    raise exception 'entity type "%" is not a lower_snake_case identifier', p_entity_type;
  end if;

  execute format(
    'create constraint trigger %I
       after update on %s
       deferrable initially deferred
       for each row execute function audit_require_row(%L, %L)',
    'audit_required_on_' || p_entity_type,
    p_table,
    p_state_column,
    p_entity_type
  );
end
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

grant select, insert on audit_log to app;
grant usage, select on sequence audit_log_seq_seq to app;

-- CLAUDE.md: the app role has no UPDATE, DELETE or TRUNCATE grant on the audit
-- log. Explicit, so the intent survives a future blanket GRANT.
revoke update, delete, truncate on audit_log from app;
