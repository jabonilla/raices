import type { ColumnType } from "kysely";

/**
 * The database as reconciliation is allowed to see it.
 *
 * The ledger tables are deliberately absent. Reconciliation records
 * disagreement between our intent and a provider's statement; it never
 * resolves that disagreement by moving money, and a correction is a new
 * posting made deliberately elsewhere. Leaving the ledger out of the type
 * means `db.insertInto("ledger_entry")` does not compile here, rather than
 * relying on everyone remembering the rule.
 */

/** Supplied on insert, never updated. */
type Immutable<Select, Insert = Select> = ColumnType<Select, Insert, never>;

/** Filled in by the database, never updated. */
type DefaultedImmutable<T> = ColumnType<T, T | undefined, never>;

export type DiscrepancyKind =
  "missing" | "unexpected" | "amount_mismatch" | "state_mismatch" | "timing";

export interface ExpectedSettlementTable {
  id: DefaultedImmutable<string>;
  seq: ColumnType<string, never, never>;
  provider: Immutable<string>;
  provider_ref: Immutable<string>;
  amount_minor: Immutable<string, bigint | string>;
  currency: Immutable<string>;
  expected_state: Immutable<string>;
  expected_by: Immutable<Date>;
  ledger_transaction_id: Immutable<string>;
  supersedes_id: Immutable<string | null, string | null | undefined>;
  created_at: DefaultedImmutable<Date>;
}

export interface ProviderStatementLineTable {
  id: DefaultedImmutable<string>;
  seq: ColumnType<string, never, never>;
  provider: Immutable<string>;
  statement_id: Immutable<string>;
  line_ref: Immutable<string>;
  provider_ref: Immutable<string>;
  amount_minor: Immutable<string, bigint | string>;
  currency: Immutable<string>;
  state: Immutable<string>;
  settled_at: Immutable<Date | null, Date | null | undefined>;
  raw: Immutable<unknown, string>;
  created_at: DefaultedImmutable<Date>;
}

export interface ReconciliationRunTable {
  id: DefaultedImmutable<string>;
  seq: ColumnType<string, never, never>;
  provider: Immutable<string>;
  statement_id: Immutable<string>;
  started_at: DefaultedImmutable<Date>;
  /** The one mutable column in this model: a run is opened, then stamped. */
  finished_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
  input_hash: Immutable<string>;
}

export interface ReconciliationDiscrepancyTable {
  id: DefaultedImmutable<string>;
  seq: ColumnType<string, never, never>;
  run_id: Immutable<string>;
  kind: Immutable<DiscrepancyKind>;
  expected_id: Immutable<string | null, string | null | undefined>;
  statement_line_id: Immutable<string | null, string | null | undefined>;
  details: Immutable<unknown, string>;
  created_at: DefaultedImmutable<Date>;
}

export interface ReconciliationDatabase {
  expected_settlement: ExpectedSettlementTable;
  provider_statement_line: ProviderStatementLineTable;
  reconciliation_run: ReconciliationRunTable;
  reconciliation_discrepancy: ReconciliationDiscrepancyTable;
}
