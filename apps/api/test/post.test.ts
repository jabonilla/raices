import { money } from "@raices/money";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  IdempotencyConflictError,
  UnbalancedPostingError,
  post,
  type PostRequest,
} from "../src/ledger/post.js";
import type { Database } from "../src/db/schema.js";
import { startTestPostgres, type TestPostgres } from "../../../tests/pg.js";
import { sql, type Kysely } from "kysely";

/**
 * Everything here runs against real Postgres: the guarantees under test are
 * the deferred balance trigger, the unique idempotency key and SERIALIZABLE
 * behaviour, none of which a mock would exercise.
 */

let pgx: TestPostgres;
let db: Kysely<Database>;

const runId = crypto.randomUUID().slice(0, 8);
let cashUsd: string;
let revenueUsd: string;
let cashGtq: string;
let revenueGtq: string;

async function makeAccount(name: string, type: string, currency: string): Promise<string> {
  const row = await db
    .insertInto("ledger_account")
    .values({
      code: `${name}.${runId}`,
      type: type as "asset",
      currency,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

/**
 * Row counts scoped to this file's own accounts.
 *
 * "Writes nothing" is the claim under test, and a global count would also
 * move when another test file shares the database — which happens locally
 * via TEST_DATABASE_URL, where vitest runs files in parallel. Every
 * transaction has at least one entry (the database enforces it), so counting
 * through entries misses nothing.
 */
async function countRows(): Promise<{ transactions: number; entries: number }> {
  const ours = [cashUsd, revenueUsd, cashGtq, revenueGtq];
  const result = await sql<{ transactions: number; entries: number }>`
    select count(distinct transaction_id)::int as transactions,
           count(*)::int                       as entries
    from ledger_entry
    where account_id = any(${ours}::uuid[])
  `.execute(db);
  return result.rows[0] ?? { transactions: 0, entries: 0 };
}

function balanced(key: string, amount = 1000n): PostRequest {
  return {
    idempotencyKey: key,
    description: "balanced posting",
    occurredAt: new Date("2026-09-22T00:00:00.000Z"),
    entries: [
      {
        accountId: cashUsd,
        direction: "debit",
        amount: money(amount, "USD"),
        entryType: "test.debit",
      },
      {
        accountId: revenueUsd,
        direction: "credit",
        amount: money(amount, "USD"),
        entryType: "test.credit",
      },
    ],
  };
}

beforeAll(async () => {
  pgx = await startTestPostgres();
  db = pgx.kysely<Database>();

  cashUsd = await makeAccount("post.cash.usd", "asset", "USD");
  revenueUsd = await makeAccount("post.revenue.usd", "revenue", "USD");
  cashGtq = await makeAccount("post.cash.gtq", "asset", "GTQ");
  revenueGtq = await makeAccount("post.revenue.gtq", "revenue", "GTQ");
});

afterAll(async () => {
  await pgx.stop();
});

describe("a balanced posting", () => {
  it("succeeds and returns the transaction id and seq", async () => {
    const result = await post(db, balanced(crypto.randomUUID()));

    expect(result.replayed).toBe(false);
    expect(result.transactionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(typeof result.seq).toBe("bigint");
    expect(result.seq).toBeGreaterThan(0n);
  });

  it("writes exactly the entries it was given", async () => {
    const result = await post(db, balanced(crypto.randomUUID(), 2500n));

    const entries = await db
      .selectFrom("ledger_entry")
      .select(["direction", "amount_minor", "currency", "entry_type", "account_id"])
      .where("transaction_id", "=", result.transactionId)
      .orderBy("seq")
      .execute();

    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.direction)).toEqual(["debit", "credit"]);
    expect(entries.map((e) => BigInt(e.amount_minor))).toEqual([2500n, 2500n]);
    expect(entries.map((e) => e.entry_type)).toEqual(["test.debit", "test.credit"]);
    expect(entries.map((e) => e.account_id)).toEqual([cashUsd, revenueUsd]);
  });

  it("stores the business time it was given, not the write time", async () => {
    const occurredAt = new Date("2020-01-02T03:04:05.000Z");
    const result = await post(db, {
      ...balanced(crypto.randomUUID()),
      occurredAt,
    });

    const row = await db
      .selectFrom("ledger_transaction")
      .select(["occurred_at", "created_at"])
      .where("id", "=", result.transactionId)
      .executeTakeFirstOrThrow();

    expect(row.occurred_at.toISOString()).toBe(occurredAt.toISOString());
    expect(row.created_at.getTime()).toBeGreaterThan(occurredAt.getTime());
  });

  it("accepts a posting balanced independently in two currencies", async () => {
    const result = await post(db, {
      idempotencyKey: crypto.randomUUID(),
      description: "multi-currency",
      occurredAt: new Date(),
      entries: [
        { accountId: cashUsd, direction: "debit", amount: money(100n, "USD"), entryType: "t" },
        { accountId: revenueUsd, direction: "credit", amount: money(100n, "USD"), entryType: "t" },
        { accountId: cashGtq, direction: "debit", amount: money(700n, "GTQ"), entryType: "t" },
        { accountId: revenueGtq, direction: "credit", amount: money(700n, "GTQ"), entryType: "t" },
      ],
    });

    expect(result.replayed).toBe(false);
  });
});

describe("an unbalanced posting", () => {
  it("throws and writes nothing", async () => {
    const before = await countRows();

    await expect(
      post(db, {
        idempotencyKey: crypto.randomUUID(),
        description: "unbalanced",
        occurredAt: new Date(),
        entries: [
          { accountId: cashUsd, direction: "debit", amount: money(1000n, "USD"), entryType: "t" },
          {
            accountId: revenueUsd,
            direction: "credit",
            amount: money(999n, "USD"),
            entryType: "t",
          },
        ],
      }),
      // Asserting the TypeScript error type, not just a message containing
      // "balance": the deferred database trigger raises a message that also
      // says "does not balance", so a looser assertion would still pass with
      // the TypeScript check removed and prove nothing about it.
    ).rejects.toThrow(UnbalancedPostingError);

    expect(await countRows()).toEqual(before);
  });

  it("rejects a posting that only balances when currencies are pooled", async () => {
    await expect(
      post(db, {
        idempotencyKey: crypto.randomUUID(),
        description: "cross-currency",
        occurredAt: new Date(),
        entries: [
          { accountId: cashUsd, direction: "debit", amount: money(1000n, "USD"), entryType: "t" },
          {
            accountId: revenueGtq,
            direction: "credit",
            amount: money(1000n, "GTQ"),
            entryType: "t",
          },
        ],
      }),
    ).rejects.toThrow(UnbalancedPostingError);
  });

  it("is still rejected by the database when the TypeScript check is bypassed", async () => {
    // The ticket requires both checks. This one proves the database backstop
    // holds on its own, for any writer that does not come through post().
    const before = await countRows();

    await expect(
      db.transaction().execute(async (trx) => {
        const tx = await trx
          .insertInto("ledger_transaction")
          .values({
            idempotency_key: crypto.randomUUID(),
            request_hash: "bypass",
            description: "bypassing post()",
            occurred_at: new Date(),
          })
          .returning("id")
          .executeTakeFirstOrThrow();

        await trx
          .insertInto("ledger_entry")
          .values([
            {
              transaction_id: tx.id,
              account_id: cashUsd,
              direction: "debit",
              amount_minor: 1000n,
              currency: "USD",
              entry_type: "bypass",
            },
            {
              transaction_id: tx.id,
              account_id: revenueUsd,
              direction: "credit",
              amount_minor: 1n,
              currency: "USD",
              entry_type: "bypass",
            },
          ])
          .execute();
      }),
    ).rejects.toMatchObject({ code: "LG002" });

    expect(await countRows()).toEqual(before);
  });

  it("rejects fewer than two entries", async () => {
    await expect(
      post(db, {
        idempotencyKey: crypto.randomUUID(),
        description: "single",
        occurredAt: new Date(),
        entries: [
          { accountId: cashUsd, direction: "debit", amount: money(1000n, "USD"), entryType: "t" },
        ],
      }),
    ).rejects.toThrow();
  });
});

describe("validation", () => {
  const cases: [string, () => unknown][] = [
    [
      "a non-bigint amount",
      () => ({
        ...balanced("x"),
        entries: [
          {
            accountId: cashUsd,
            direction: "debit",
            amount: { amount: 10.5, currency: "USD" },
            entryType: "t",
          },
          {
            accountId: revenueUsd,
            direction: "credit",
            amount: money(1000n, "USD"),
            entryType: "t",
          },
        ],
      }),
    ],
    [
      "a zero amount",
      () => ({
        ...balanced("x"),
        entries: [
          { accountId: cashUsd, direction: "debit", amount: money(0n, "USD"), entryType: "t" },
          { accountId: revenueUsd, direction: "credit", amount: money(0n, "USD"), entryType: "t" },
        ],
      }),
    ],
    [
      "a negative amount",
      () => ({
        ...balanced("x"),
        entries: [
          { accountId: cashUsd, direction: "debit", amount: money(-1n, "USD"), entryType: "t" },
          { accountId: revenueUsd, direction: "credit", amount: money(-1n, "USD"), entryType: "t" },
        ],
      }),
    ],
    [
      "an unknown direction",
      () => ({
        ...balanced("x"),
        entries: [
          { accountId: cashUsd, direction: "sideways", amount: money(1n, "USD"), entryType: "t" },
          { accountId: revenueUsd, direction: "credit", amount: money(1n, "USD"), entryType: "t" },
        ],
      }),
    ],
    ["an empty idempotency key", () => ({ ...balanced("") })],
    ["an empty description", () => ({ ...balanced("x"), description: "" })],
    [
      "a non-uuid account id",
      () => ({
        ...balanced("x"),
        entries: [
          { accountId: "not-a-uuid", direction: "debit", amount: money(1n, "USD"), entryType: "t" },
          { accountId: revenueUsd, direction: "credit", amount: money(1n, "USD"), entryType: "t" },
        ],
      }),
    ],
    ["an invalid occurredAt", () => ({ ...balanced("x"), occurredAt: new Date("nonsense") })],
  ];

  it.each(cases)("rejects %s before touching the database", async (_label, build) => {
    const before = await countRows();
    await expect(post(db, build() as PostRequest)).rejects.toThrow();
    expect(await countRows()).toEqual(before);
  });
});

describe("idempotency", () => {
  it("same key and same payload replays, writing nothing", async () => {
    const key = crypto.randomUUID();
    const first = await post(db, balanced(key));

    const before = await countRows();
    const second = await post(db, balanced(key));

    expect(second.replayed).toBe(true);
    expect(second.transactionId).toBe(first.transactionId);
    expect(second.seq).toBe(first.seq);
    expect(await countRows()).toEqual(before);
  });

  it("replays regardless of the order the entries arrive in", async () => {
    const key = crypto.randomUUID();
    const request = balanced(key);
    const first = await post(db, request);

    const reversed: PostRequest = { ...request, entries: [...request.entries].reverse() };
    const second = await post(db, reversed);

    expect(second.replayed).toBe(true);
    expect(second.transactionId).toBe(first.transactionId);
  });

  it("same key and a different payload throws IdempotencyConflictError", async () => {
    const key = crypto.randomUUID();
    await post(db, balanced(key, 1000n));

    const before = await countRows();
    await expect(post(db, balanced(key, 2000n))).rejects.toThrow(IdempotencyConflictError);
    expect(await countRows()).toEqual(before);
  });

  it.each([
    ["a different description", (r: PostRequest) => ({ ...r, description: "different" })],
    [
      "a different occurredAt",
      (r: PostRequest) => ({ ...r, occurredAt: new Date("1999-01-01T00:00:00.000Z") }),
    ],
    [
      "a different account",
      (r: PostRequest) => ({
        ...r,
        entries: r.entries.map((e, i) => (i === 0 ? { ...e, accountId: cashGtq } : e)),
      }),
    ],
    [
      "a different entry type",
      (r: PostRequest) => ({
        ...r,
        entries: r.entries.map((e, i) => (i === 0 ? { ...e, entryType: "other" } : e)),
      }),
    ],
  ])("detects %s as a conflict", async (_label, mutate) => {
    const key = crypto.randomUUID();
    const request = balanced(key);
    await post(db, request);

    await expect(post(db, mutate(request) as PostRequest)).rejects.toThrow(
      IdempotencyConflictError,
    );
  });

  it("carries the key on the conflict error", async () => {
    const key = crypto.randomUUID();
    await post(db, balanced(key, 1000n));

    await expect(post(db, balanced(key, 3000n))).rejects.toMatchObject({
      idempotencyKey: key,
    });
  });

  it("a conflicting replay does not disturb the original", async () => {
    const key = crypto.randomUUID();
    const first = await post(db, balanced(key, 1000n));

    await expect(post(db, balanced(key, 4000n))).rejects.toThrow(IdempotencyConflictError);

    const entries = await db
      .selectFrom("ledger_entry")
      .select("amount_minor")
      .where("transaction_id", "=", first.transactionId)
      .execute();

    expect(entries.map((e) => BigInt(e.amount_minor))).toEqual([1000n, 1000n]);
  });
});
