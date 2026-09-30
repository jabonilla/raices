import type { ColumnType } from "kysely";

/**
 * The typed shape of the plan tables, mirroring `db/migrations/0005_plans.sql`.
 *
 * `plan_version` and `category` declare their update type as `never`, so an
 * UPDATE against plan history does not compile. The database triggers remain
 * the real enforcement; this only moves the failure to the keystroke.
 */

/** A column supplied on insert but never updated. */
type Immutable<Select, Insert = Select> = ColumnType<Select, Insert, never>;

/** A column the database fills in and that is never updated. */
type DefaultedImmutable<T> = ColumnType<T, T | undefined, never>;

/** A column the database fills in that may still be updated. */
type Generated<T> = ColumnType<T, T | undefined, T>;

export interface MoneyPlanTable {
  id: Generated<string>;
  relationship_id: ColumnType<string, string, never>;
  /** Moves forward with each version. The pointer, not the history. */
  current_version_id: ColumnType<string | null, string | null | undefined, string | null>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface PlanVersionTable {
  id: DefaultedImmutable<string>;
  seq: ColumnType<string, never, never>;
  plan_id: Immutable<string>;
  version_number: Immutable<number>;
  created_by: Immutable<string>;
  /**
   * The IANA zone the monthly cap window is measured in (issue #92).
   *
   * On the version, not the plan, so changing it appends a version like any
   * other plan change and cannot reclassify requests already made. Never
   * inferred from a device: a recipient on a plane must not move the
   * boundary.
   */
  cap_timezone: Immutable<string>;
  created_at: DefaultedImmutable<Date>;
}

export interface CategoryTable {
  id: DefaultedImmutable<string>;
  plan_version_id: Immutable<string>;
  name: Immutable<string>;
  icon: Immutable<string>;
  /**
   * Minor units, read as a string so nothing is rounded on the way out.
   * Null means no cap; "0" means a cap of zero.
   */
  monthly_cap_minor: Immutable<string | null, bigint | string | null | undefined>;
  monthly_cap_currency: Immutable<string | null, string | null | undefined>;
  is_system: ColumnType<boolean, boolean | undefined, never>;
  created_at: DefaultedImmutable<Date>;
}

export interface PlanDatabase {
  money_plan: MoneyPlanTable;
  plan_version: PlanVersionTable;
  category: CategoryTable;
}
