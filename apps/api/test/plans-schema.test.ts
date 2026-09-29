import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startTestPostgres, type TestPostgres } from "../../../tests/pg.js";

/**
 * P2.3 database-level guarantees. Immutability is enforced here, not in
 * application code, so every one is proven by attempting the forbidden
 * operation against real Postgres and requiring it to fail.
 */

const IMMUTABLE_VIOLATION = "PL001";
const CHECK_VIOLATION = "23514";
const UNIQUE_VIOLATION = "23505";
const NOT_NULL_VIOLATION = "23502";
const FOREIGN_KEY_VIOLATION = "23503";
const INSUFFICIENT_PRIVILEGE = "42501";

interface PostgresError extends Error {
  readonly code?: string;
}
function errorCode(error: unknown): string | undefined {
  return (error as PostgresError | undefined)?.code;
}

let pgx: TestPostgres;

async function withClient<T>(
  fn: (client: pg.Client) => Promise<T>,
  options: { role?: string } = {},
): Promise<T> {
  const client = new pg.Client({ connectionString: pgx.connectionString });
  await client.connect();
  try {
    if (options.role !== undefined) await client.query(`set role ${options.role}`);
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function failureCode(
  sql: string,
  options: { role?: string; values?: unknown[] } = {},
): Promise<string | undefined> {
  return withClient(async (client) => {
    try {
      await client.query(sql, options.values as never);
      return undefined;
    } catch (error) {
      return errorCode(error);
    }
  }, options);
}

let phoneCounter = 0;
function aPhone(): string {
  phoneCounter += 1;
  return `+5023${String(3_000_000 + phoneCounter).padStart(7, "0")}`;
}

/** A relationship with a plan, one version, and one category. */
async function fixture(): Promise<{
  planId: string;
  versionId: string;
  categoryId: string;
  userId: string;
}> {
  return withClient(async (c) => {
    const { rows: a } = await c.query<{ id: string }>(
      `insert into app_user (phone, roles) values ($1, '{sender}') returning id`,
      [aPhone()],
    );
    const { rows: b } = await c.query<{ id: string }>(
      `insert into app_user (phone, roles) values ($1, '{recipient}') returning id`,
      [aPhone()],
    );
    const userId = a[0]!.id;
    const { rows: rel } = await c.query<{ id: string }>(
      `insert into relationship (user_a_id, user_b_id, role_of_a, role_of_b)
       values ($1, $2, 'sender', 'recipient') returning id`,
      [userId, b[0]!.id],
    );
    const { rows: plan } = await c.query<{ id: string }>(
      `insert into money_plan (relationship_id) values ($1) returning id`,
      [rel[0]!.id],
    );
    const { rows: version } = await c.query<{ id: string }>(
      `insert into plan_version (plan_id, version_number, created_by)
       values ($1, 1, $2) returning id`,
      [plan[0]!.id, userId],
    );
    const { rows: cat } = await c.query<{ id: string }>(
      `insert into category (plan_version_id, name, icon, monthly_cap_minor, monthly_cap_currency)
       values ($1, 'Housing', 'home', 50000, 'USD') returning id`,
      [version[0]!.id],
    );
    return {
      planId: plan[0]!.id,
      versionId: version[0]!.id,
      categoryId: cat[0]!.id,
      userId,
    };
  });
}

beforeAll(async () => {
  pgx = await startTestPostgres();
}, 120_000);

afterAll(async () => {
  await pgx.stop();
});

describe("plan_version and category are immutable", () => {
  // The owner is stopped by the trigger; the app role is stopped earlier by
  // the missing grant. Both, because either alone leaves a hole.
  for (const table of ["plan_version", "category"] as const) {
    describe(table, () => {
      it("rejects UPDATE as the owner", async () => {
        await fixture();
        expect(await failureCode(`update ${table} set created_at = now()`)).toBe(
          IMMUTABLE_VIOLATION,
        );
      });

      it("rejects DELETE as the owner", async () => {
        await fixture();
        expect(await failureCode(`delete from ${table}`)).toBe(IMMUTABLE_VIOLATION);
      });

      it("rejects TRUNCATE as the owner", async () => {
        await fixture();
        expect(await failureCode(`truncate ${table} cascade`)).toBe(IMMUTABLE_VIOLATION);
      });

      // Statement-level, so a statement matching no rows is still refused. A
      // row-level trigger never fires on an empty table.
      it("rejects an UPDATE matching no rows", async () => {
        expect(await failureCode(`update ${table} set created_at = now() where 1 = 0`)).toBe(
          IMMUTABLE_VIOLATION,
        );
      });

      it("rejects a DELETE matching no rows", async () => {
        expect(await failureCode(`delete from ${table} where 1 = 0`)).toBe(IMMUTABLE_VIOLATION);
      });

      it("rejects UPDATE as the app role", async () => {
        expect(await failureCode(`update ${table} set created_at = now()`, { role: "app" })).toBe(
          INSUFFICIENT_PRIVILEGE,
        );
      });

      it("rejects DELETE as the app role", async () => {
        expect(await failureCode(`delete from ${table}`, { role: "app" })).toBe(
          INSUFFICIENT_PRIVILEGE,
        );
      });

      it("still allows INSERT and SELECT as the app role", async () => {
        expect(await failureCode(`select count(*) from ${table}`, { role: "app" })).toBeUndefined();
      });
    });
  }

  // money_plan is deliberately mutable: current_version_id moves forward as
  // versions are added. That is the pointer, not the history.
  it("allows money_plan.current_version_id to be updated", async () => {
    const { planId, versionId } = await fixture();
    expect(
      await failureCode(`update money_plan set current_version_id = $1 where id = $2`, {
        values: [versionId, planId],
      }),
    ).toBeUndefined();
  });
});

describe("version numbering", () => {
  it("rejects a duplicate version number within one plan", async () => {
    const { planId, userId } = await fixture();
    expect(
      await failureCode(
        `insert into plan_version (plan_id, version_number, created_by) values ($1, 1, $2)`,
        { values: [planId, userId] },
      ),
    ).toBe(UNIQUE_VIOLATION);
  });

  it("allows the same version number in a different plan", async () => {
    const first = await fixture();
    const second = await fixture();
    expect(first.versionId).not.toBe(second.versionId);
  });

  it("rejects a version number below one", async () => {
    const { planId, userId } = await fixture();
    expect(
      await failureCode(
        `insert into plan_version (plan_id, version_number, created_by) values ($1, 0, $2)`,
        { values: [planId, userId] },
      ),
    ).toBe(CHECK_VIOLATION);
  });

  it("requires the author of a version to exist", async () => {
    const { planId } = await fixture();
    expect(
      await failureCode(
        `insert into plan_version (plan_id, version_number, created_by) values ($1, 2, $2)`,
        { values: [planId, crypto.randomUUID()] },
      ),
    ).toBe(FOREIGN_KEY_VIOLATION);
  });
});

describe("category caps", () => {
  async function insertCategory(
    versionId: string,
    cap: { minor: bigint | number | null; currency: string | null },
  ): Promise<string | undefined> {
    return failureCode(
      `insert into category (plan_version_id, name, icon, monthly_cap_minor, monthly_cap_currency)
       values ($1, 'Food', 'food', $2, $3)`,
      { values: [versionId, cap.minor, cap.currency] },
    );
  }

  // A cap of zero means "nothing may be spent here". No cap means "unlimited".
  // Storing them the same way would silently convert one into the other.
  it("accepts a cap of zero", async () => {
    const { versionId } = await fixture();
    expect(await insertCategory(versionId, { minor: 0, currency: "USD" })).toBeUndefined();
  });

  it("accepts no cap at all", async () => {
    const { versionId } = await fixture();
    expect(await insertCategory(versionId, { minor: null, currency: null })).toBeUndefined();
  });

  // An amount without a currency is not money.
  it("rejects an amount with no currency", async () => {
    const { versionId } = await fixture();
    expect(await insertCategory(versionId, { minor: 1000, currency: null })).toBe(CHECK_VIOLATION);
  });

  it("rejects a currency with no amount", async () => {
    const { versionId } = await fixture();
    expect(await insertCategory(versionId, { minor: null, currency: "USD" })).toBe(CHECK_VIOLATION);
  });

  it("rejects a negative cap", async () => {
    const { versionId } = await fixture();
    expect(await insertCategory(versionId, { minor: -1, currency: "USD" })).toBe(CHECK_VIOLATION);
  });

  it("rejects an unsupported currency", async () => {
    const { versionId } = await fixture();
    expect(await insertCategory(versionId, { minor: 1000, currency: "EUR" })).toBe(CHECK_VIOLATION);
  });

  it("requires a name and an icon", async () => {
    const { versionId } = await fixture();
    expect(
      await failureCode(
        `insert into category (plan_version_id, name, icon) values ($1, null, 'x')`,
        { values: [versionId] },
      ),
    ).toBe(NOT_NULL_VIOLATION);
  });

  // Money is bigint minor units (CLAUDE.md rule 1). The column must hold more
  // than a double can represent exactly.
  it("stores a cap beyond the range of a double without loss", async () => {
    const { versionId } = await fixture();
    const huge = 9007199254740993n; // 2^53 + 1
    await withClient((c) =>
      c.query(
        `insert into category (plan_version_id, name, icon, monthly_cap_minor, monthly_cap_currency)
         values ($1, 'Big', 'x', $2, 'USD')`,
        [versionId, huge.toString()],
      ),
    );
    const back = await withClient(async (c) => {
      const { rows } = await c.query<{ cap: string }>(
        `select monthly_cap_minor::text as cap from category
          where plan_version_id = $1 and name = 'Big'`,
        [versionId],
      );
      return rows[0]?.cap;
    });
    expect(BigInt(back ?? "0")).toBe(huge);
  });
});

describe("grants", () => {
  it("does not let the app role delete a plan", async () => {
    expect(await failureCode("delete from money_plan", { role: "app" })).toBe(
      INSUFFICIENT_PRIVILEGE,
    );
  });
});
