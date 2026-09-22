import type { ColumnType } from "kysely";

/**
 * The typed database schema Kysely builds against, mirroring
 * `db/migrations/0001_ledger.sql`.
 *
 * Every ledger column declares its update type as `never`, so an UPDATE
 * against these tables does not compile (CLAUDE.md rule 2). The database
 * triggers remain the real enforcement — this only moves the failure earlier,
 * to the keystroke rather than the commit.
 */

/** A column supplied on insert but never updated. */
type Immutable<Select, Insert = Select> = ColumnType<Select, Insert, never>;

/** A column the database fills in and that is never updated. */
type DefaultedImmutable<T> = ColumnType<T, T | undefined, never>;

export type LedgerAccountType = "asset" | "liability" | "equity" | "revenue" | "expense";
export type LedgerDirection = "debit" | "credit";

export interface LedgerAccountTable {
  id: DefaultedImmutable<string>;
  code: Immutable<string>;
  type: Immutable<LedgerAccountType>;
  currency: Immutable<string>;
  created_at: DefaultedImmutable<Date>;
}

export interface LedgerTransactionTable {
  id: DefaultedImmutable<string>;
  /** bigserial. node-postgres returns int8 as a string, never a lossy number. */
  seq: ColumnType<string, never, never>;
  idempotency_key: Immutable<string>;
  /** sha256 of the canonical request. */
  request_hash: Immutable<string>;
  description: Immutable<string>;
  /** Business time, distinct from created_at. */
  occurred_at: Immutable<Date>;
  created_at: DefaultedImmutable<Date>;
}

export interface LedgerEntryTable {
  id: DefaultedImmutable<string>;
  seq: ColumnType<string, never, never>;
  transaction_id: Immutable<string>;
  account_id: Immutable<string>;
  direction: Immutable<LedgerDirection>;
  /** Minor units. Read as a string so nothing is rounded on the way out. */
  amount_minor: Immutable<string, bigint | string>;
  currency: Immutable<string>;
  entry_type: Immutable<string>;
  created_at: DefaultedImmutable<Date>;
}

export interface Database {
  ledger_account: LedgerAccountTable;
  ledger_transaction: LedgerTransactionTable;
  ledger_entry: LedgerEntryTable;
}
