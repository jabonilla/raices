import { money } from "@raices/money";
import fc from "fast-check";
import { Kysely, PostgresDialect, sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { post, requestHashOf, type PostRequest } from "../src/ledger/post.js";
import type { Database } from "../src/db/schema.js";
import { startTestPostgres, type TestPostgres } from "../../../tests/pg.js";

/**
 * The concurrency guarantees, against real Postgres. A mock cannot produce a
 * serialization failure, a duplicate-key race or a deferred constraint, which
 * are the only things these tests are about.
 */

let pgx: TestPostgres;
let db: Kysely<Database>;
let pool: pg.Pool;

const runId = crypto.randomUUID().slice(0, 8);
let cashUsd: string;
let revenueUsd: string;

/** Derived balance in minor units: debits minus credits, exact, from the rows. */
async function derivedBalance(accountId: string): Promise<bigint> {
  const result = await sql<{ balance: string }>`
    select coalesce(sum(
      case when direction = 'debit' then amount_minor else -amount_minor end
    ), 0)::text as balance
    from ledger_entry
    where account_id = ${accountId}
  `.execute(db);
  return BigInt(result.rows[0]?.balance ?? "0");
}

async function globalImbalance(): Promise<{ currency: string; delta: string }[]> {
  const result = await sql<{ currency: string; delta: string }>`
    select currency,
           sum(case when direction = 'debit' then amount_minor else -amount_minor end)::text as delta
    from ledger_entry
    group by currency
    having sum(case when direction = 'debit' then amount_minor else -amount_minor end) <> 0
  `.execute(db);
  return result.rows;
}

beforeAll(async () => {
  pgx = await startTestPostgres();

  // A pool wide enough that "50 parallel" means 50 in flight, not 10 at a
  // time queueing behind the default pool size.
  pool = new pg.Pool({ connectionString: pgx.connectionString, max: 30 });
  db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });

  const cash = await db
    .insertInto("ledger_account")
    .values({ code: `conc.cash.${runId}`, type: "asset", currency: "USD" })
    .returning("id")
    .executeTakeFirstOrThrow();
  const revenue = await db
    .insertInto("ledger_account")
    .values({ code: `conc.revenue.${runId}`, type: "revenue", currency: "USD" })
    .returning("id")
    .executeTakeFirstOrThrow();

  cashUsd = cash.id;
  revenueUsd = revenue.id;
});

afterAll(async () => {
  await db.destroy();
  await pgx.stop();
});

function request(key: string, amount: bigint): PostRequest {
  return {
    idempotencyKey: key,
    description: "concurrent posting",
    occurredAt: new Date("2026-09-22T00:00:00.000Z"),
    entries: [
      { accountId: cashUsd, direction: "debit", amount: money(amount, "USD"), entryType: "conc" },
      {
        accountId: revenueUsd,
        direction: "credit",
        amount: money(amount, "USD"),
        entryType: "conc",
      },
    ],
  };
}

describe("two concurrent calls racing on a brand-new key", () => {
  it("both return the same transaction, and exactly one is a replay", async () => {
    const key = crypto.randomUUID();

    const [a, b] = await Promise.all([
      post(db, request(key, 1000n)),
      post(db, request(key, 1000n)),
    ]);

    // The loser's duplicate-key collision must resolve to a replay, never an
    // error surfaced to the caller.
    expect(a.transactionId).toBe(b.transactionId);
    expect(a.seq).toBe(b.seq);
    expect([a.replayed, b.replayed].filter(Boolean)).toHaveLength(1);

    const written = await sql<{ n: number }>`
      select count(*)::int as n from ledger_transaction where idempotency_key = ${key}
    `.execute(db);
    expect(written.rows[0]?.n).toBe(1);
  });

  it("holds over repeated races", async () => {
    for (let round = 0; round < 10; round += 1) {
      const key = crypto.randomUUID();
      const results = await Promise.all([
        post(db, request(key, 500n)),
        post(db, request(key, 500n)),
      ]);

      const ids = new Set(results.map((r) => r.transactionId));
      expect(ids.size).toBe(1);
      expect(results.filter((r) => r.replayed)).toHaveLength(1);
    }
  });
});

describe("losing the race to a key committed after our snapshot", () => {
  /**
   * The hard case, staged deterministically rather than hoped for.
   *
   * A rival transaction inserts the key and holds it open, so post() blocks
   * on the unique index. When the rival commits, post()'s ON CONFLICT writes
   * nothing — and post()'s snapshot was taken before that commit, so the row
   * is invisible to it. It cannot replay from inside that transaction; only a
   * fresh one can see the winner. If that is not handled, the caller gets an
   * error instead of a replay.
   */
  it("resolves to a replay rather than surfacing an error", async () => {
    const key = crypto.randomUUID();
    const req = request(key, 4242n);
    const rival = new pg.Client({ connectionString: pgx.connectionString });
    await rival.connect();

    try {
      await rival.query("begin isolation level serializable");
      const rivalTx = await rival.query<{ id: string; seq: string }>(
        `insert into ledger_transaction (idempotency_key, request_hash, description, occurred_at)
         values ($1, $2, $3, $4) returning id, seq`,
        [key, requestHashOf(req), req.description, req.occurredAt],
      );
      const rivalId = rivalTx.rows[0]?.id;
      const rivalSeq = rivalTx.rows[0]?.seq;
      expect(rivalId).toBeDefined();

      for (const entry of req.entries) {
        await rival.query(
          `insert into ledger_entry
             (transaction_id, account_id, direction, amount_minor, currency, entry_type)
           values ($1,$2,$3,$4,$5,$6)`,
          [
            rivalId,
            entry.accountId,
            entry.direction,
            entry.amount.amount.toString(),
            entry.amount.currency,
            entry.entryType,
          ],
        );
      }

      // post() starts now and blocks on the held key.
      const pending = post(db, req);
      await new Promise((resolve) => setTimeout(resolve, 250));

      // The rival wins. post() must recover, not fail.
      await rival.query("commit");

      const result = await pending;
      expect(result.replayed).toBe(true);
      expect(result.transactionId).toBe(rivalId);
      expect(result.seq).toBe(BigInt(rivalSeq ?? "0"));
    } finally {
      await rival.end();
    }
  });
});

describe("the transaction post() opens", () => {
  it("is SERIALIZABLE", async () => {
    // CLAUDE.md requires every ledger write to run at SERIALIZABLE. Nothing
    // else in this suite fails if the isolation level is silently lowered,
    // so it is asserted directly, by recording what is sent to Postgres.
    const statements: string[] = [];
    const spyPool = new pg.Pool({ connectionString: pgx.connectionString, max: 2 });

    spyPool.on("connect", (client) => {
      const original = client.query.bind(client) as (...args: unknown[]) => unknown;
      const wrapped = (...args: unknown[]): unknown => {
        const [first] = args;
        if (typeof first === "string") {
          statements.push(first);
        } else if (typeof first === "object" && first !== null && "text" in first) {
          statements.push(String(first.text));
        }
        return original(...args);
      };
      // Replacing a method on the live client is the only way to see the
      // BEGIN: Kysely issues transaction control through the driver, which
      // never reaches its query logger.
      Object.defineProperty(client, "query", { value: wrapped, configurable: true });
    });

    const spyDb = new Kysely<Database>({ dialect: new PostgresDialect({ pool: spyPool }) });
    try {
      await post(spyDb, request(crypto.randomUUID(), 99n));
    } finally {
      await spyDb.destroy();
    }

    const begins = statements.filter((s) => /^\s*(begin|start transaction)/i.test(s));
    expect(begins.length).toBeGreaterThan(0);
    expect(begins.every((s) => /serializable/i.test(s))).toBe(true);
  });
});

describe("20 parallel posts with the same key", () => {
  it("writes exactly one transaction and every caller gets it", async () => {
    const key = crypto.randomUUID();

    const results = await Promise.all(
      Array.from({ length: 20 }, () => post(db, request(key, 750n))),
    );

    const ids = new Set(results.map((r) => r.transactionId));
    expect(ids.size).toBe(1);

    // Exactly one caller did the writing; the other 19 replayed.
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    expect(results.filter((r) => r.replayed)).toHaveLength(19);

    const counts = await sql<{ transactions: number; entries: number }>`
      select (select count(*)::int from ledger_transaction where idempotency_key = ${key}) as transactions,
             (select count(*)::int from ledger_entry e
                join ledger_transaction t on t.id = e.transaction_id
               where t.idempotency_key = ${key}) as entries
    `.execute(db);

    expect(counts.rows[0]?.transactions).toBe(1);
    expect(counts.rows[0]?.entries).toBe(2);
  });
});

describe("50 parallel distinct postings to one account", () => {
  it("the derived balance equals the exact expected sum", async () => {
    const before = await derivedBalance(cashUsd);

    // Distinct amounts, so a lost update cannot coincidentally still sum right.
    const amounts = Array.from({ length: 50 }, (_, i) => BigInt(i + 1) * 13n);
    const expected = amounts.reduce((sum, a) => sum + a, 0n);

    const results = await Promise.all(
      amounts.map((amount) => post(db, request(crypto.randomUUID(), amount))),
    );

    expect(results.filter((r) => r.replayed)).toHaveLength(0);
    expect(new Set(results.map((r) => r.transactionId)).size).toBe(50);

    const after = await derivedBalance(cashUsd);
    expect(after - before).toBe(expected);
  });

  it("leaves the books balanced per currency", async () => {
    expect(await globalImbalance()).toEqual([]);
  });
});

describe("property: the books balance after any sequence of valid postings", () => {
  it("global debits equal credits per currency, after every sequence", async () => {
    const accounts: Record<"USD" | "GTQ", { debit: string; credit: string }> = {
      USD: { debit: cashUsd, credit: revenueUsd },
      GTQ: { debit: "", credit: "" },
    };

    const gtqCash = await db
      .insertInto("ledger_account")
      .values({ code: `prop.cash.gtq.${runId}`, type: "asset", currency: "GTQ" })
      .returning("id")
      .executeTakeFirstOrThrow();
    const gtqRevenue = await db
      .insertInto("ledger_account")
      .values({ code: `prop.revenue.gtq.${runId}`, type: "revenue", currency: "GTQ" })
      .returning("id")
      .executeTakeFirstOrThrow();
    accounts.GTQ = { debit: gtqCash.id, credit: gtqRevenue.id };

    const postingArb = fc.record({
      currency: fc.constantFrom<"USD" | "GTQ">("USD", "GTQ"),
      amount: fc.bigInt({ min: 1n, max: 10n ** 9n }),
    });

    await fc.assert(
      fc.asyncProperty(fc.array(postingArb, { minLength: 1, maxLength: 6 }), async (postings) => {
        for (const posting of postings) {
          const pair = accounts[posting.currency];
          await post(db, {
            idempotencyKey: crypto.randomUUID(),
            description: "property posting",
            occurredAt: new Date(),
            entries: [
              {
                accountId: pair.debit,
                direction: "debit",
                amount: money(posting.amount, posting.currency),
                entryType: "prop",
              },
              {
                accountId: pair.credit,
                direction: "credit",
                amount: money(posting.amount, posting.currency),
                entryType: "prop",
              },
            ],
          });
        }

        // After every sequence, no currency may be out of balance.
        expect(await globalImbalance()).toEqual([]);
      }),
      { numRuns: 15 },
    );
  });
});
