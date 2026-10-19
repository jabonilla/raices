-- P3.2 — Conversation state.
--
-- A recipient types "necesito 200 para la renta" and the next message is
-- "sí". Something has to remember what "sí" refers to, without that memory
-- becoming a way to confuse somebody into confirming what they did not mean.
--
-- The ticket numbers this migration 0010, which 0010_channel_inbound.sql took
-- in P3.1. Migrations are forward-only and never edited after merge, so this
-- is 0011.
--
-- WHY THE EXPIRY IS A CONSTRAINT AND NOT A CLEANUP JOB
--
-- A pending context without a deadline is a "sí" waiting to land on whatever
-- was last proposed, however long ago. The check constraint below makes a
-- deadline inseparable from a pending state: there is no way to write a
-- proposal that never goes stale, including by hand on a console. Sweeping
-- expired rows in the background would be the weaker design — the sweeper
-- would race the inbound message it is supposed to protect, and the message
-- would sometimes win. Expiry is therefore evaluated where it is consumed,
-- against the database clock, inside the transaction that consumes it.

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

create table conversation (
  id               uuid        primary key default gen_random_uuid(),

  -- bigserial, for a total order that does not depend on a clock.
  seq              bigserial   not null unique,

  relationship_id  uuid        not null references relationship (id),

  channel          text        not null
    constraint conversation_channel_known check (channel in ('app', 'whatsapp', 'sms')),

  -- Every state but 'idle' means "we asked something and are waiting".
  state            text        not null default 'idle'
    constraint conversation_state_known check (state in (
      'idle',
      'awaiting_disambiguation',
      'awaiting_confirmation',
      'awaiting_arrival_confirmation'
    )),

  -- What the pending question was about. Null exactly when nothing pends.
  pending_payload  jsonb,

  -- When the pending context goes stale. Null exactly when nothing pends.
  expires_at       timestamptz,

  last_message_at  timestamptz not null default now(),
  created_at       timestamptz not null default now(),

  -- The ticket's "one active conversation per relationship per channel",
  -- enforced as one row per pair. A conversation is long-lived and its state
  -- says whether anything is pending, so a second row for the same pair is
  -- never wanted — making this a plain unique constraint rather than a
  -- partial one leaves no "active" predicate for a future change to get
  -- wrong.
  constraint conversation_one_per_relationship_channel
    unique (relationship_id, channel),

  -- The safety invariant. A pending state always has both a payload and a
  -- deadline; idle has neither. This is what makes "every proposal expires"
  -- a property of the data rather than a promise made by the code that
  -- happens to write it.
  constraint conversation_pending_context_complete check (
    (state = 'idle' and pending_payload is null and expires_at is null)
    or (state <> 'idle' and pending_payload is not null and expires_at is not null)
  )
);

create index conversation_relationship_idx on conversation (relationship_id);

-- ---------------------------------------------------------------------------
-- Born idle
-- ---------------------------------------------------------------------------

-- 0003_audit.sql's trigger fires on UPDATE only, because creating a row is
-- not a transition. That leaves one hole: a conversation inserted directly
-- into a pending state would hold a proposal that no audit row accounts for.
-- Requiring every conversation to be born idle closes it — reaching a pending
-- state is then always an UPDATE, and always audited.
create or replace function conversation_born_idle() returns trigger
language plpgsql as $$
begin
  if new.state <> 'idle' then
    raise exception
      'a conversation is born idle, not in "%". Reach a pending state through transition(), so the move is audited.',
      new.state
      using errcode = 'CV002';
  end if;
  return new;
end
$$;

create trigger conversation_born_idle_trigger
  before insert on conversation
  for each row execute function conversation_born_idle();

-- ---------------------------------------------------------------------------
-- No deletes
-- ---------------------------------------------------------------------------

-- State moves, so UPDATE is allowed here — unlike the ledger. What is not
-- allowed is erasure. ADR-002 makes our record of what was agreed the only
-- thing that can contradict a provider's version of events, and a deleted
-- conversation is a deleted part of that record.
create or replace function conversation_reject_erasure() returns trigger
language plpgsql as $$
begin
  raise exception
    'conversation rows are not erasable: % is not permitted. What was said is part of the record of what was agreed.',
    tg_op
    using errcode = 'CV001';
end
$$;

-- Statement-level, so a statement is refused even when it matches no rows.
create trigger conversation_no_delete
  before delete on conversation
  for each statement execute function conversation_reject_erasure();

create trigger conversation_no_truncate
  before truncate on conversation
  for each statement execute function conversation_reject_erasure();

-- ---------------------------------------------------------------------------
-- Audit
-- ---------------------------------------------------------------------------

-- CLAUDE.md rule 5: every state transition writes an audit event row. This
-- refuses a state change that reaches the table any other way.
select audit_enforce_transitions('conversation', 'state', 'conversation');

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

-- UPDATE is granted, unlike the ledger and channel_inbound_message: a
-- conversation's whole job is to move between states. DELETE and TRUNCATE are
-- simply never granted, and the triggers above are what actually refuse them
-- for every role including the owner.
grant select, insert, update on conversation to app;
grant usage, select on sequence conversation_seq_seq to app;
