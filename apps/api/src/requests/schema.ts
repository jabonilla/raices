import type { ColumnType } from "kysely";

import type { AuditDatabase, Channel } from "../audit/schema.js";
import type { PlanDatabase } from "../plans/schema.js";
import type { RelationshipDatabase } from "../relationships/schema.js";
import type { Tier } from "./tier/index.js";

/**
 * The typed shape of `request`, mirroring `db/migrations/0006_requests.sql`.
 *
 * The columns that make up the ask declare their update type as `never`, so
 * rewriting an amount, a category or a tier does not compile. The trigger in
 * 0006 remains the real enforcement; this moves the failure to the keystroke.
 */

/** A column supplied on insert but never updated. */
type Immutable<Select, Insert = Select> = ColumnType<Select, Insert, never>;

/** A column the database fills in and that is never updated. */
type DefaultedImmutable<T> = ColumnType<T, T | undefined, never>;

/** A column the database fills in that may still be updated. */
type Generated<T> = ColumnType<T, T | undefined, T>;

export type RequestStatus = "pending" | "approved" | "declined" | "expired";

export interface RequestTable {
  id: DefaultedImmutable<string>;
  /** bigserial. node-postgres returns int8 as a string, never a lossy number. */
  seq: ColumnType<string, never, never>;

  relationship_id: Immutable<string>;
  requested_by: Immutable<string>;

  /** Minor units, read as a string so nothing is rounded on the way out. */
  amount_minor: Immutable<string, bigint | string>;
  amount_currency: Immutable<string>;

  /** Null when the request names no category from any plan. */
  category_id: Immutable<string | null, string | null | undefined>;

  description: Immutable<string>;
  /** Decided at submission by the pure classifier, then never rewritten. */
  tier: Immutable<Tier>;
  /** PRD: emergency status cannot be applied retroactively, or removed. */
  is_emergency: Immutable<boolean, boolean | undefined>;
  channel_of_origin: Immutable<Channel>;

  status: Generated<RequestStatus>;
  /** Null while pending, and for an expiry, which no person decided. */
  resolved_by: ColumnType<string | null, string | null | undefined, string | null>;
  resolved_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
  /** Set if and only if the status is `declined`. */
  decline_reason: ColumnType<string | null, string | null | undefined, string | null>;

  created_at: DefaultedImmutable<Date>;
  updated_at: Generated<Date>;
}

/**
 * The slice of the schema the requests module works against.
 *
 * It deliberately omits the ledger tables. PRD invariant 3 says a declined
 * request never becomes a transaction; this module cannot post one for any
 * request, declined or not, because the tables are not in its type at all.
 * A guardrail test in tests/guardrails/ fails if that is ever widened.
 */
export interface RequestDatabase extends AuditDatabase, PlanDatabase, RelationshipDatabase {
  request: RequestTable;
}
