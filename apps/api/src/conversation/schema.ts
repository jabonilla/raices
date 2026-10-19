import type { ColumnType } from "kysely";

import type { AuditDatabase, Channel } from "../audit/schema.js";

/**
 * The typed shape of `conversation`, mirroring
 * `db/migrations/0011_conversation.sql`.
 *
 * Unlike the ledger, this table is not append-only: a conversation's whole
 * job is to move between states. The columns that identify which
 * conversation it is are still immutable, so a row cannot be repointed at a
 * different relationship or channel after the fact.
 */

/** A column supplied on insert but never updated. */
type Immutable<Select, Insert = Select> = ColumnType<Select, Insert, never>;

/** A column the database fills in and that is never updated. */
type DefaultedImmutable<T> = ColumnType<T, T | undefined, never>;

/** A column the database fills in that may still be updated. */
type Generated<T> = ColumnType<T, T | undefined, T>;

/**
 * Every state but `idle` means "we asked something and are waiting for an
 * answer". There is deliberately no state for "expired": expiry is a
 * property of the deadline, and a context that has gone stale is resolved
 * back to `idle` through an audited transition rather than parked in a state
 * of its own where a later message could still find it.
 */
export type ConversationState =
  "idle" | "awaiting_disambiguation" | "awaiting_confirmation" | "awaiting_arrival_confirmation";

/** Any state in which something is pending. */
export type PendingState = Exclude<ConversationState, "idle">;

export interface ConversationTable {
  id: DefaultedImmutable<string>;
  /** bigserial. node-postgres returns int8 as a string, never a lossy number. */
  seq: ColumnType<string, never, never>;
  relationship_id: Immutable<string>;
  channel: Immutable<Channel>;
  state: Generated<ConversationState>;
  /**
   * What the pending question was about. Null exactly when nothing pends —
   * the database enforces the "exactly".
   */
  pending_payload: ColumnType<unknown, string | null | undefined, string | null>;
  /** When the pending context goes stale. Null exactly when nothing pends. */
  expires_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
  last_message_at: Generated<Date>;
  created_at: DefaultedImmutable<Date>;
}

/**
 * The slice of the schema the conversation functions need.
 *
 * Extends AuditDatabase because every state change here goes through
 * `transition()`, which writes the audit row alongside it.
 */
export interface ConversationDatabase extends AuditDatabase {
  conversation: ConversationTable;
}
