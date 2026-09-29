import type { ColumnType } from "kysely";

import type { Channel } from "../audit/schema.js";

/**
 * The typed shape of `app_user` and `relationship`, mirroring
 * `db/migrations/0004_users_relationships.sql`.
 *
 * The table is `app_user` rather than `user`: `user` is reserved, and an
 * unquoted `select * from user` silently returns the current username instead
 * of the table's rows.
 */

/** A column the database fills in and the application may not set. */
type Generated<T> = ColumnType<T, T | undefined, T>;

/** PRD section 2 names two personas, and a user may hold both. */
export type UserRole = "sender" | "recipient";

export type Locale = "es" | "en";

export type RelationshipStatus = "invited" | "active" | "paused" | "terminated";

export interface AppUserTable {
  id: Generated<string>;
  phone: string;
  roles: UserRole[];
  locale: Generated<Locale>;
  preferred_channel: Generated<Channel>;
  identity_assurance_level: ColumnType<string | null, string | null | undefined, string | null>;
  kyc_status: Generated<string>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface RelationshipTable {
  id: Generated<string>;
  /** bigserial. node-postgres returns int8 as a string. */
  seq: ColumnType<string, never, never>;
  user_a_id: ColumnType<string, string, never>;
  user_b_id: ColumnType<string, string, never>;
  role_of_a: ColumnType<UserRole, UserRole, never>;
  role_of_b: ColumnType<UserRole, UserRole, never>;
  status: Generated<RelationshipStatus>;
  invited_at: Generated<Date>;
  activated_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface RelationshipDatabase {
  app_user: AppUserTable;
  relationship: RelationshipTable;
}
