import type { ColumnType } from "kysely";

import type { AuditDatabase } from "../audit/schema.js";
import type { LedgerAccountTable, LedgerEntryTable, LedgerTransactionTable } from "../db/schema.js";
import type { PlanDatabase } from "../plans/schema.js";
import type { RelationshipDatabase } from "../relationships/schema.js";
import type { RequestTable } from "../requests/schema.js";

/**
 * The typed shape of `transaction`, mirroring `db/migrations/0007_transactions.sql`.
 *
 * CLAUDE.md rule 4 lives here as much as in the schema. `IntentState` and
 * `SettlementState` are disjoint unions with no member in common, so a value
 * of one does not type-check where the other belongs, and there is no
 * combined field to reach for. That is the compile-time half of "never
 * collapse them"; the database half is in 0007 and its tests.
 */

/** A column supplied on insert but never updated. */
type Immutable<Select, Insert = Select> = ColumnType<Select, Insert, never>;

/** A column the database fills in and that is never updated. */
type DefaultedImmutable<T> = ColumnType<T, T | undefined, never>;

/** A column the database fills in that may still be updated. */
type Generated<T> = ColumnType<T, T | undefined, T>;

/**
 * What the two parties agreed to do.
 *
 * Answers "is this transfer still meant to happen?" and nothing else. It says
 * nothing about whether money moved.
 */
export type IntentState = "committed" | "cancelled";

/**
 * What the money actually did.
 *
 * Answers "where is it?" and nothing else. It says nothing about whether the
 * transfer was still wanted — a payout can fail on a commitment nobody
 * withdrew, and that is two facts, not one.
 */
export type SettlementState =
  "not_started" | "instructed" | "in_flight" | "settled" | "failed" | "reversed";

export interface TransactionTable {
  id: DefaultedImmutable<string>;
  /** bigserial. node-postgres returns int8 as a string, never a lossy number. */
  seq: ColumnType<string, never, never>;

  request_id: Immutable<string>;
  relationship_id: Immutable<string>;

  /** Minor units, read as a string so nothing is rounded on the way out. */
  amount_minor: Immutable<string, bigint | string>;
  amount_currency: Immutable<string>;

  intent_state: Generated<IntentState>;
  settlement_state: Generated<SettlementState>;

  approved_by: Immutable<string>;
  approved_at: DefaultedImmutable<Date>;
  /** What was known about the approver at the moment they approved. */
  assurance_level_at_approval: Immutable<string | null, string | null | undefined>;

  settlement_provider: ColumnType<string | null, string | null | undefined, string | null>;
  provider_reference_id: ColumnType<string | null, string | null | undefined, string | null>;

  /**
   * A ratio, not money: exact numeric, read as a string. Never a float — the
   * disclosed rate and the applied rate have to be the same number.
   */
  fx_rate_applied: ColumnType<string | null, string | null | undefined, string | null>;

  fee_minor: ColumnType<string | null, bigint | string | null | undefined, bigint | string | null>;
  fee_currency: ColumnType<string | null, string | null | undefined, string | null>;
  recipient_amount_minor: ColumnType<
    string | null,
    bigint | string | null | undefined,
    bigint | string | null
  >;
  recipient_amount_currency: ColumnType<string | null, string | null | undefined, string | null>;

  created_at: DefaultedImmutable<Date>;
  updated_at: Generated<Date>;
}

/**
 * The slice of the schema the transactions module works against.
 *
 * Unlike `RequestDatabase`, this one does include the ledger tables: writing
 * the posting alongside the transaction row is the whole job of this module,
 * and it is the only place outside `ledger/` that may do it.
 */
export interface TransactionDatabase extends AuditDatabase, PlanDatabase, RelationshipDatabase {
  request: RequestTable;
  transaction: TransactionTable;
  ledger_account: LedgerAccountTable;
  ledger_transaction: LedgerTransactionTable;
  ledger_entry: LedgerEntryTable;
}
