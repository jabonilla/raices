-- Red-team findings RED-1 (#99) and RED-2 (#100).
--
-- Both are the same class of defect: a guarantee that held for the path the
-- application takes, but not for the database. Append-only stopped existing
-- rows changing and said nothing about new rows joining an old parent; the
-- relationship state machine checked a source state it had read outside the
-- transaction that used it. In both cases the rule was a property of the
-- code rather than of the data, so anything that reached the table another
-- way — a compromised app writer, a mistaken SQL path, or just unlucky
-- timing — was not bound by it.

-- ---------------------------------------------------------------------------
-- RED-2: a leg is written with its parent, or not at all
-- ---------------------------------------------------------------------------

-- 0001 made ledger rows append-only: no UPDATE, no DELETE, no TRUNCATE. That
-- protects the rows that exist. It does not stop a NEW pair of balanced legs
-- being attached to a transaction that committed last week.
--
-- The damage is not an unbalanced ledger — the attacker's legs balance, which
-- is why the deferred balance trigger waves them through. It is that the
-- committed posting's membership and account impact change while its
-- `request_hash` stays what it was. Replaying the original idempotency key
-- then returns a transaction whose entries no longer match the request that
-- created it, so idempotency quietly stops meaning what it promises.
--
-- The rule this encodes: entries are written by the transaction that wrote
-- their parent. `xmin` is the parent row's inserting transaction id, so
-- comparing it against the current one is that sentence, exactly. This is the
-- same mechanism 0003 uses to require an audit row from the same transaction.
--
-- Compensating postings are unaffected, and must stay that way: a correction
-- is a NEW ledger_transaction with its own legs, written in its own
-- transaction, so its parent's xmin is always the current one. Reversals are
-- how this ledger corrects itself (CLAUDE.md rule 2) and closing that off
-- would be a worse bug than the one being fixed. There is a test.
create or replace function ledger_entry_assert_written_with_parent() returns trigger
language plpgsql as $$
declare
  v_parent_xmin xid;
begin
  select t.xmin into v_parent_xmin
    from ledger_transaction t
   where t.id = new.transaction_id;

  -- No visible parent. Either the transaction id is bogus or it belongs to a
  -- concurrent uncommitted transaction; the foreign key is the right thing to
  -- report both, so leave its error intact rather than masking it here.
  if v_parent_xmin is null then
    return new;
  end if;

  if v_parent_xmin is distinct from pg_current_xact_id()::xid then
    raise exception
      'ledger transaction % already committed: entries are written with their parent, never after it',
      new.transaction_id
      using errcode = 'LG004',
            hint = 'Corrections are new compensating transactions, not new legs on an old one.';
  end if;

  return new;
end
$$;

-- AFTER INSERT rather than BEFORE, deliberately, for two reasons the
-- BEFORE version got wrong:
--
--  * Column constraints are evaluated between the BEFORE triggers and the
--    AFTER ones. A BEFORE trigger here answered "late leg" for a row whose
--    real problem was a negative amount or an unknown direction, masking
--    23514 and making the diagnostic worse than before the fix.
--  * BEFORE triggers fire ahead of ON CONFLICT resolution, so an idempotent
--    `insert ... on conflict do nothing` that re-states legs already present
--    was refused rather than skipped. AFTER triggers do not fire for a row
--    the conflict clause dropped, which is the right answer: nothing was
--    written, so nothing was appended to a committed posting.
--
-- Raising from an AFTER trigger aborts the statement just as firmly, so the
-- guarantee is identical; only the ordering against other checks changes.
create trigger ledger_entry_written_with_parent
  after insert on ledger_entry
  for each row execute function ledger_entry_assert_written_with_parent();

-- ---------------------------------------------------------------------------
-- RED-1: terminated is terminal, in the data
-- ---------------------------------------------------------------------------

-- The application fix is in changeStatus: read the current state inside the
-- transaction that writes, and make the write a compare-and-swap. This is the
-- half that does not depend on the application being right.
--
-- Termination is how someone leaves a financial relationship, and in this
-- product that may be someone leaving a controlling situation. A relationship
-- that silently comes back is a safety failure, not a state-machine tidiness
-- issue, so the last word belongs to the database.
create or replace function relationship_reject_revival() returns trigger
language plpgsql as $$
begin
  if old.status = 'terminated' and new.status is distinct from 'terminated' then
    raise exception
      'relationship % is terminated: it cannot be moved to %', old.id, new.status
      using errcode = 'RL002',
            hint = 'Termination is final. The two parties start a new relationship instead.';
  end if;

  return new;
end
$$;

create trigger relationship_terminated_is_terminal
  before update on relationship
  for each row execute function relationship_reject_revival();
