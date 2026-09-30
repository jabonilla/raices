import { isCurrency, money, type Money } from "@raices/money";
import { sql, type Kysely, type Transaction } from "kysely";

import { withSerializableTx } from "../db/serializable.js";
import type { PlanDatabase } from "./schema.js";

/**
 * The categories every new plan starts with, per the ticket. Stored as
 * stable names; display and translation belong to the client.
 */
export const SYSTEM_CATEGORY_NAMES = ["Housing", "Food", "Business", "Savings", "Other"] as const;

const SYSTEM_CATEGORY_ICONS: Readonly<Record<(typeof SYSTEM_CATEGORY_NAMES)[number], string>> = {
  Housing: "home",
  Food: "food",
  Business: "tools",
  Savings: "piggy",
  Other: "dots",
};

export interface CategoryInput {
  readonly name: string;
  readonly icon: string;
  /** Null is no cap. `money(0n, …)` is a cap of zero. They differ. */
  readonly monthlyCap: Money | null;
  readonly isSystem?: boolean;
}

export interface CategoryRecord {
  readonly id: string;
  readonly name: string;
  readonly icon: string;
  readonly monthlyCap: Money | null;
  readonly isSystem: boolean;
}

export interface PlanVersionRecord {
  readonly id: string;
  readonly planId: string;
  readonly versionNumber: number;
  readonly createdBy: string;
  /** The IANA zone the cap window is measured in (issue #92). */
  readonly capTimezone: string;
  readonly categories: readonly CategoryRecord[];
}

/** SQLSTATE raised by the timezone guard in 0008. */
const INVALID_TIMEZONE = "TZ001";

/**
 * Thrown when a plan version names something that is not an IANA zone.
 *
 * Distinct from a generic constraint error because the remedy is specific:
 * a zone name, not a fixed offset. "-06:00" is Guatemala today and wrong the
 * moment any rule changes; "America/Guatemala" carries its own history, so a
 * window computed over a past month stays correct.
 */
export class InvalidCapTimezoneError extends Error {
  readonly capTimezone: string;

  constructor(capTimezone: string, options?: { cause?: unknown }) {
    super(
      `${JSON.stringify(capTimezone)} is not an IANA timezone name. Use a zone such as ` +
        `"America/Guatemala" or "America/New_York", never a fixed offset.`,
      options,
    );
    this.name = "InvalidCapTimezoneError";
    this.capTimezone = capTimezone;
  }
}

function isInvalidTimezone(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === INVALID_TIMEZONE;
}

export interface PlanRecord {
  readonly planId: string;
  readonly relationshipId: string;
  readonly currentVersionId: string | null;
  readonly currentVersionNumber: number | null;
}

export interface CreatedVersion {
  readonly planId: string;
  readonly versionId: string;
  readonly versionNumber: number;
}

/**
 * Rebuild a Money from the two columns it is stored in.
 *
 * Both null is no cap. Anything half-set would have been refused by the
 * database, so it can only mean the row was written by something that
 * bypassed the constraint.
 */
function capFromColumns(minor: string | null, currency: string | null): Money | null {
  if (minor === null && currency === null) return null;
  if (minor === null || currency === null) {
    throw new Error(
      "Category cap is half-set: an amount without a currency, or a currency without an amount.",
    );
  }
  if (!isCurrency(currency)) {
    throw new Error(`Category cap has unsupported currency ${JSON.stringify(currency)}.`);
  }
  return money(BigInt(minor), currency);
}

async function insertCategories(
  trx: Transaction<PlanDatabase>,
  versionId: string,
  categories: readonly CategoryInput[],
): Promise<void> {
  if (categories.length === 0) return;
  await trx
    .insertInto("category")
    .values(
      categories.map((c) => ({
        plan_version_id: versionId,
        name: c.name,
        icon: c.icon,
        // The amount goes in as a bigint and comes back as a string. It is
        // never a JS number anywhere on this path.
        monthly_cap_minor: c.monthlyCap === null ? null : c.monthlyCap.amount,
        monthly_cap_currency: c.monthlyCap === null ? null : c.monthlyCap.currency,
        is_system: c.isSystem ?? false,
      })),
    )
    .execute();
}

/**
 * Append a version to a plan and point the plan at it.
 *
 * The next number is `max + 1`, read and written inside one SERIALIZABLE
 * transaction. Two racing edits compute the same number; the unique
 * constraint refuses the loser, and withSerializableTx replays it against a
 * fresh snapshot where the winner is visible. That is what keeps the sequence
 * gapless: nothing is reserved in advance, so nothing can be reserved and
 * abandoned.
 */
async function appendVersion<DB extends PlanDatabase>(
  db: Kysely<DB>,
  input: {
    planId: string;
    createdBy: string;
    capTimezone: string;
    categories: readonly CategoryInput[];
  },
): Promise<CreatedVersion> {
  try {
    return await appendVersionUnchecked(db, input);
  } catch (error) {
    if (isInvalidTimezone(error)) {
      throw new InvalidCapTimezoneError(input.capTimezone, { cause: error });
    }
    throw error;
  }
}

async function appendVersionUnchecked<DB extends PlanDatabase>(
  db: Kysely<DB>,
  input: {
    planId: string;
    createdBy: string;
    capTimezone: string;
    categories: readonly CategoryInput[];
  },
): Promise<CreatedVersion> {
  return withSerializableTx(db, async (raw) => {
    const trx = raw as unknown as Transaction<PlanDatabase>;

    const { rows } = await sql<{ next: number }>`
      select coalesce(max(version_number), 0) + 1 as next
        from plan_version where plan_id = ${input.planId}
    `.execute(trx);
    const versionNumber = rows[0]?.next ?? 1;

    const version = await trx
      .insertInto("plan_version")
      .values({
        plan_id: input.planId,
        version_number: versionNumber,
        created_by: input.createdBy,
        cap_timezone: input.capTimezone,
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    await insertCategories(trx, version.id, input.categories);

    await trx
      .updateTable("money_plan")
      .set({ current_version_id: version.id })
      .where("id", "=", input.planId)
      .execute();

    return { planId: input.planId, versionId: version.id, versionNumber };
  });
}

/** Create a plan for a relationship, with version 1 and the system categories. */
export async function createPlan<DB extends PlanDatabase>(
  db: Kysely<DB>,
  input: { relationshipId: string; createdBy: string; capTimezone: string },
): Promise<CreatedVersion> {
  const planId = await withSerializableTx(db, async (raw) => {
    const trx = raw as unknown as Transaction<PlanDatabase>;
    const plan = await trx
      .insertInto("money_plan")
      .values({ relationship_id: input.relationshipId })
      .returning("id")
      .executeTakeFirstOrThrow();
    return plan.id;
  });

  // Uncapped, not capped at zero: a new plan should not silently forbid all
  // spending before the sender has set anything.
  return appendVersion(db, {
    planId,
    createdBy: input.createdBy,
    capTimezone: input.capTimezone,
    categories: SYSTEM_CATEGORY_NAMES.map((name) => ({
      name,
      icon: SYSTEM_CATEGORY_ICONS[name],
      monthlyCap: null,
      isSystem: true,
    })),
  });
}

/**
 * Edit a plan, which appends version N+1.
 *
 * Nothing about version N changes. The new version gets its own category
 * rows, so anything already pointing at an old category keeps pointing at
 * exactly what it did.
 */
export async function editPlan<DB extends PlanDatabase>(
  db: Kysely<DB>,
  input: {
    planId: string;
    editedBy: string;
    capTimezone: string;
    categories: readonly CategoryInput[];
  },
): Promise<CreatedVersion> {
  return appendVersion(db, {
    planId: input.planId,
    createdBy: input.editedBy,
    capTimezone: input.capTimezone,
    categories: input.categories,
  });
}

export async function readPlan<DB extends PlanDatabase>(
  db: Kysely<DB>,
  planId: string,
): Promise<PlanRecord> {
  const { rows } = await sql<{
    id: string;
    relationship_id: string;
    current_version_id: string | null;
    current_version_number: number | null;
  }>`
    select p.id, p.relationship_id, p.current_version_id, v.version_number as current_version_number
      from money_plan p
      left join plan_version v on v.id = p.current_version_id
     where p.id = ${planId}
  `.execute(db);

  const row = rows[0];
  if (row === undefined) throw new Error(`No plan ${planId}`);

  return {
    planId: row.id,
    relationshipId: row.relationship_id,
    currentVersionId: row.current_version_id,
    currentVersionNumber: row.current_version_number,
  };
}

export async function readVersion<DB extends PlanDatabase>(
  db: Kysely<DB>,
  versionId: string,
): Promise<PlanVersionRecord> {
  const trx = db as unknown as Kysely<PlanDatabase>;

  const version = await trx
    .selectFrom("plan_version")
    .select(["id", "plan_id", "version_number", "created_by", "cap_timezone"])
    .where("id", "=", versionId)
    .executeTakeFirstOrThrow();

  const categories = await trx
    .selectFrom("category")
    .select(["id", "name", "icon", "monthly_cap_minor", "monthly_cap_currency", "is_system"])
    .where("plan_version_id", "=", versionId)
    .orderBy("name")
    .execute();

  return {
    id: version.id,
    planId: version.plan_id,
    versionNumber: version.version_number,
    createdBy: version.created_by,
    capTimezone: version.cap_timezone,
    categories: categories.map((c) => ({
      id: c.id,
      name: c.name,
      icon: c.icon,
      monthlyCap: capFromColumns(c.monthly_cap_minor, c.monthly_cap_currency),
      isSystem: c.is_system,
    })),
  };
}
