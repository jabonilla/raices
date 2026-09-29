import type { ColumnType } from "kysely";

/**
 * The typed shape of `audit_log`, mirroring `db/migrations/0003_audit.sql`.
 *
 * Every column declares its update type as `never`, so an UPDATE against the
 * audit log does not compile. The database triggers remain the real
 * enforcement — this only moves the failure earlier, to the keystroke.
 */

/** A column supplied on insert but never updated. */
type Immutable<Select, Insert = Select> = ColumnType<Select, Insert, never>;

/** A column the database fills in and that is never updated. */
type DefaultedImmutable<T> = ColumnType<T, T | undefined, never>;

/** Who caused a transition. `system` covers work no person initiated. */
export type ActorKind = "user" | "system" | "agent";

/** PRD section 3's channel model. The app is additive, never required. */
export type Channel = "app" | "whatsapp" | "sms";

/**
 * A state snapshot as stored in `before_state` and `after_state`.
 *
 * A state name and nothing else. This is the type-level half of "audit rows
 * carry no PII": there is no field through which a caller could pass a phone
 * number, a person's name or an amount. The database enforces the same shape.
 */
export interface AuditState {
  readonly state: string;
}

export interface AuditLogTable {
  id: DefaultedImmutable<string>;
  /** bigserial. node-postgres returns int8 as a string, never a lossy number. */
  seq: ColumnType<string, never, never>;
  /** Null only for the system actor. */
  actor_id: Immutable<string | null, string | null | undefined>;
  actor_kind: Immutable<ActorKind>;
  /** A dotted identifier, e.g. `relationship.activate`. */
  action: Immutable<string>;
  entity_type: Immutable<string>;
  entity_id: Immutable<string>;
  /** Null for a transition no channel originated. */
  channel: Immutable<Channel | null, Channel | null | undefined>;
  assurance_level: Immutable<string | null, string | null | undefined>;
  /** jsonb. Written as a JSON string; read back as a parsed object. */
  before_state: ColumnType<AuditState | null, string | null | undefined, never>;
  after_state: ColumnType<AuditState, string, never>;
  created_at: DefaultedImmutable<Date>;
}

/**
 * The slice of the schema `transition()` needs.
 *
 * Kept narrow so a state machine's own tables can be added alongside it
 * without `transition()` having to know about them.
 */
export interface AuditDatabase {
  audit_log: AuditLogTable;
}
