-- P3.1 — Durable inbound message dedupe.
--
-- K2.28's deduplicator is an in-memory Set, so a restart replays every
-- message it had already seen. At-least-once delivery plus a forgetful store
-- is double-processing, and double-processing an inbound message is how a
-- request gets created twice.
--
-- The ticket numbers this migration 0009, which 0009_redteam_fixes.sql
-- already took in Phase 2. Migrations are forward-only and never edited after
-- merge, so this is 0010.
--
-- WHY THERE IS NO 'pending' STATE
--
-- The claim is taken in the same transaction as the processing it guards, so
-- a row that is visible is a message whose work committed. There is no window
-- in which a claim exists and its work does not — that window is precisely
-- the bug this table prevents, and leaving a state name for it would invite
-- somebody to reintroduce it. Every state here is therefore terminal at
-- insert, which is also what lets the table be append-only: nothing ever
-- needs to move a row forward.
--
-- A transient failure rolls the claim back with the work and the provider
-- redelivers. A message that fails permanently will therefore be retried for
-- as long as the provider retries it; parking poison messages needs a second
-- transaction and is deliberately not in this ticket.

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

create table channel_inbound_message (
  id                  uuid        primary key default gen_random_uuid(),

  -- bigserial, for a total order that does not depend on a clock. Two
  -- messages can share a received_at; they cannot share a seq.
  seq                 bigserial   not null unique,

  provider            text        not null
    constraint channel_inbound_message_provider_len
      check (length(provider) between 1 and 64),

  -- The provider's own id for the message. Bounded so a hostile or broken
  -- provider cannot push an unbounded key into a unique index.
  provider_message_id text        not null
    constraint channel_inbound_message_provider_message_id_len
      check (length(provider_message_id) between 1 and 200),

  -- When we received it, supplied by the caller.
  received_at         timestamptz not null,

  -- The provider's payload, stored verbatim for audit. This is PII: it is
  -- never logged, never attached to a span, and never echoed in an error.
  -- Postgres puts the whole failing row in the DETAIL of a constraint
  -- violation, so the application layer strips DETAIL from anything raised
  -- against this table (see apps/api/src/webhooks/inbound.ts).
  payload             jsonb       not null,

  -- Terminal at insert. See the note above on why 'pending' does not exist.
  --   processed — the work ran and committed with this row
  --   ignored   — deliberately accepted and not acted on
  processing_state    text        not null
    constraint channel_inbound_message_state_known
      check (processing_state in ('processed', 'ignored')),

  processed_at        timestamptz not null default now(),
  created_at          timestamptz not null default now(),

  -- The dedupe key. Providers number their own messages, so the pair is
  -- unique, never the id alone: two providers both starting at "1" must not
  -- swallow each other's traffic.
  constraint channel_inbound_message_provider_id_unique
    unique (provider, provider_message_id)
);

-- ---------------------------------------------------------------------------
-- Append-only, same discipline as the ledger
-- ---------------------------------------------------------------------------

create or replace function channel_inbound_reject_mutation() returns trigger
language plpgsql as $$
begin
  raise exception
    'channel_inbound_message is append-only: % is not permitted. An inbound message is a record of what arrived; it is never rewritten.',
    tg_op
    using errcode = 'CH001';
end
$$;

-- Statement-level rather than row-level, so a statement is refused even when
-- it matches no rows. A row-level trigger never fires on an empty table,
-- which would let `delete from channel_inbound_message` silently succeed and
-- report that it worked.
create trigger channel_inbound_message_append_only
  before update or delete on channel_inbound_message
  for each statement execute function channel_inbound_reject_mutation();

create trigger channel_inbound_message_no_truncate
  before truncate on channel_inbound_message
  for each statement execute function channel_inbound_reject_mutation();

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

grant select, insert on channel_inbound_message to app;

-- bigserial needs its sequence usable by whoever inserts.
grant usage, select on sequence channel_inbound_message_seq_seq to app;

-- Belt and braces, as on the ledger: the trigger stops everyone including the
-- owner, the revoked grant stops the app role a layer earlier at the
-- permission check. A grant alone would not stop a migration or a console
-- session; a trigger alone can be bypassed by a superuser setting
-- session_replication_role.
revoke update, delete, truncate on channel_inbound_message from app;
