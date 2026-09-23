import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { seedFixtures } from "../../../scripts/seed.js";
import { startTestPostgres, type TestPostgres } from "../../../tests/pg.js";

/**
 * The dev seed runs against a real Postgres 16 (Testcontainers in CI).
 * It must produce a balanced ledger and be safe to re-run.
 */
let pgx: TestPostgres;
let pool: pg.Pool;

beforeAll(async () => {
  pgx = await startTestPostgres();
  pool = new pg.Pool({ connectionString: pgx.connectionString });
});

afterAll(async () => {
  await pool.end();
  await pgx.stop();
});

async function entryCount(): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    "select count(*) as count from ledger_entry",
  );
  return Number(rows[0]?.count ?? 0);
}

describe("seedFixtures", () => {
  it("seeds two accounts and one balanced transfer", async () => {
    await seedFixtures(pool);

    const { rows: accounts } = await pool.query<{ code: string }>(
      "select code from ledger_account order by code",
    );
    expect(accounts.map((a) => a.code)).toEqual(["recipient:maria", "settlement:usd"]);

    const { rows: sums } = await pool.query<{
      direction: string;
      total: string;
    }>(
      `select direction, sum(amount_minor) as total
       from ledger_entry
       group by direction`,
    );
    const byDirection = Object.fromEntries(sums.map((r) => [r.direction, r.total]));
    expect(byDirection).toEqual({ debit: "2500", credit: "2500" });
  });

  it("is idempotent: re-running inserts nothing new", async () => {
    await seedFixtures(pool);
    const before = await entryCount();
    await seedFixtures(pool);
    expect(await entryCount()).toBe(before);
  });
});
