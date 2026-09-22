import type { Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "../src/db/schema.js";
import { startTestPostgres, type TestPostgres } from "../../../tests/pg.js";

/**
 * The typed mirror of the migration: proves the Kysely schema matches the real
 * tables, and that an UPDATE against a ledger table does not compile.
 */

let pgx: TestPostgres;
let db: Kysely<Database>;

const runId = crypto.randomUUID().slice(0, 8);
let accountId: string;
let transactionId: string;

beforeAll(async () => {
  pgx = await startTestPostgres();
  db = pgx.kysely<Database>();

  const account = await db
    .insertInto("ledger_account")
    .values({ code: `kysely.cash.${runId}`, type: "asset", currency: "USD" })
    .returning("id")
    .executeTakeFirstOrThrow();

  const counter = await db
    .insertInto("ledger_account")
    .values({ code: `kysely.revenue.${runId}`, type: "revenue", currency: "USD" })
    .returning("id")
    .executeTakeFirstOrThrow();

  accountId = account.id;

  await db.transaction().execute(async (trx) => {
    const tx = await trx
      .insertInto("ledger_transaction")
      .values({
        idempotency_key: `kysely-${runId}`,
        request_hash: "sha256:test",
        description: "typed insert",
        occurred_at: new Date(),
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    transactionId = tx.id;

    await trx
      .insertInto("ledger_entry")
      .values([
        {
          transaction_id: tx.id,
          account_id: account.id,
          direction: "debit",
          amount_minor: 4200n,
          currency: "USD",
          entry_type: "typed",
        },
        {
          transaction_id: tx.id,
          account_id: counter.id,
          direction: "credit",
          amount_minor: 4200n,
          currency: "USD",
          entry_type: "typed",
        },
      ])
      .execute();
  });
});

afterAll(async () => {
  await pgx.stop();
});

describe("typed ledger access", () => {
  it("reads entries back by transaction", async () => {
    const rows = await db
      .selectFrom("ledger_entry")
      .select(["direction", "amount_minor", "currency"])
      .where("transaction_id", "=", transactionId)
      .orderBy("seq")
      .execute();

    expect(rows).toHaveLength(2);
    // Amounts come back as strings, so a bigint round-trip is exact.
    expect(rows.map((row) => row.amount_minor)).toEqual(["4200", "4200"]);
    expect(rows.map((row) => BigInt(row.amount_minor))).toEqual([4200n, 4200n]);
  });

  it("reads entries back by account", async () => {
    const rows = await db
      .selectFrom("ledger_entry")
      .innerJoin("ledger_account", "ledger_account.id", "ledger_entry.account_id")
      .select(["ledger_entry.direction", "ledger_account.code"])
      .where("ledger_entry.account_id", "=", accountId)
      .orderBy("ledger_entry.seq")
      .execute();

    expect(rows).toHaveLength(1);
    expect(rows[0]?.direction).toBe("debit");
    expect(rows[0]?.code).toBe(`kysely.cash.${runId}`);
  });

  it("does not compile an UPDATE against a ledger table", () => {
    expect(() => {
      db.updateTable("ledger_entry")
        // @ts-expect-error ledger columns declare `never` as their update type.
        .set({ entry_type: "rewritten" })
        .where("transaction_id", "=", transactionId);
    }).not.toThrow();
  });
});
