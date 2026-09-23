import { equals, money, type Currency } from "@raices/money";
import fc from "fast-check";
import { sql, type Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database, LedgerAccountType } from "../src/db/schema.js";
import { AccountNotFoundError, balance, trialBalance } from "../src/ledger/balance.js";
import { post } from "../src/ledger/post.js";
import { startTestPostgres, type TestPostgres } from "../../../tests/pg.js";

/**
 * Balances are derived, never cached (P1.4), so every assertion here reads
 * real rows out of real Postgres. A mock would be asserting against the
 * fixture rather than against the ledger.
 */

let pgx: TestPostgres;
let db: Kysely<Database>;

const runId = crypto.randomUUID().slice(0, 8);

/** One account of each of the five types, so normal sides can be compared. */
const TYPES: LedgerAccountType[] = ["asset", "expense", "liability", "equity", "revenue"];
const accounts = new Map<LedgerAccountType, string>();

/** A counterpart per currency, used to keep every posting balanced. */
let counterUsd: string;
let counterGtq: string;

async function makeAccount(
  name: string,
  type: LedgerAccountType,
  currency: Currency,
): Promise<string> {
  const row = await db
    .insertInto("ledger_account")
    .values({ code: `${name}.${runId}`, type, currency })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

/**
 * Move `amount` onto `accountId`, balanced against a counterpart, and return
 * the seq of the entry written **on `accountId` itself**.
 *
 * Deliberately not the global max(seq): each posting writes two entries, so
 * the global max is the counterpart's, one higher. An as-of boundary built
 * from that would be satisfied by `seq < asOfSeq` just as well as by
 * `seq <= asOfSeq`, and would not test the boundary at all.
 */
async function move(
  accountId: string,
  direction: "debit" | "credit",
  amount: bigint,
  currency: Currency = "USD",
): Promise<bigint> {
  const counter = currency === "USD" ? counterUsd : counterGtq;
  const opposite = direction === "debit" ? "credit" : "debit";

  const result = await post(db, {
    idempotencyKey: crypto.randomUUID(),
    description: "balance fixture",
    occurredAt: new Date(),
    entries: [
      { accountId, direction, amount: money(amount, currency), entryType: "fixture" },
      {
        accountId: counter,
        direction: opposite,
        amount: money(amount, currency),
        entryType: "fixture",
      },
    ],
  });

  const own = await sql<{ seq: string }>`
    select seq::text as seq
    from ledger_entry
    where transaction_id = ${result.transactionId} and account_id = ${accountId}
  `.execute(db);

  const seq = own.rows[0]?.seq;
  if (seq === undefined) throw new Error("posting wrote no entry on the target account");
  return BigInt(seq);
}

/** The highest entry seq currently in the ledger. */
async function latestEntrySeq(): Promise<bigint> {
  const r = await sql<{ seq: string | null }>`
    select max(seq)::text as seq from ledger_entry
  `.execute(db);
  return BigInt(r.rows[0]?.seq ?? "0");
}

beforeAll(async () => {
  pgx = await startTestPostgres();
  db = pgx.kysely<Database>();

  counterUsd = await makeAccount("bal.counter.usd", "equity", "USD");
  counterGtq = await makeAccount("bal.counter.gtq", "equity", "GTQ");

  for (const type of TYPES) {
    accounts.set(type, await makeAccount(`bal.${type}`, type, "USD"));
  }
});

afterAll(async () => {
  await pgx.stop();
});

describe("normal-side signs", () => {
  // Debit-normal accounts grow with debits; credit-normal accounts grow with
  // credits. Getting this backwards flips the reported sign of every balance
  // sheet line, so each of the five types is pinned explicitly.
  const DEBIT_NORMAL: LedgerAccountType[] = ["asset", "expense"];
  const CREDIT_NORMAL: LedgerAccountType[] = ["liability", "equity", "revenue"];

  it.each(DEBIT_NORMAL)("%s is debit-normal: a debit is positive", async (type) => {
    const id = accounts.get(type);
    expect(id).toBeDefined();
    await move(id ?? "", "debit", 500n);

    const result = await balance(db, id ?? "");
    expect(equals(result, money(500n, "USD"))).toBe(true);
  });

  it.each(CREDIT_NORMAL)("%s is credit-normal: a credit is positive", async (type) => {
    const id = accounts.get(type);
    expect(id).toBeDefined();
    await move(id ?? "", "credit", 700n);

    const result = await balance(db, id ?? "");
    expect(equals(result, money(700n, "USD"))).toBe(true);
  });

  it.each(DEBIT_NORMAL)("%s goes negative on a net credit", async (type) => {
    const id = await makeAccount(`neg.${type}`, type, "USD");
    await move(id, "credit", 300n);

    const result = await balance(db, id);
    expect(result.amount).toBe(-300n);
  });

  it.each(CREDIT_NORMAL)("%s goes negative on a net debit", async (type) => {
    const id = await makeAccount(`neg2.${type}`, type, "USD");
    await move(id, "debit", 300n);

    const result = await balance(db, id);
    expect(result.amount).toBe(-300n);
  });

  it("the two normal sides disagree on identical activity", async () => {
    // The same entry on an asset and on a revenue account must not produce
    // the same signed balance; if it does, normal side is being ignored.
    const asset = await makeAccount("cmp.asset", "asset", "USD");
    const revenue = await makeAccount("cmp.revenue", "revenue", "USD");

    await move(asset, "debit", 100n);
    await move(revenue, "debit", 100n);

    const assetBalance = await balance(db, asset);
    const revenueBalance = await balance(db, revenue);

    expect(assetBalance.amount).toBe(100n);
    expect(revenueBalance.amount).toBe(-100n);
  });
});

describe("balance basics", () => {
  it("is zero for an account with no entries", async () => {
    const id = await makeAccount("empty", "asset", "USD");
    const result = await balance(db, id);
    expect(result.amount).toBe(0n);
    expect(result.currency).toBe("USD");
  });

  it("reports the account's own currency", async () => {
    const id = await makeAccount("gtq.asset", "asset", "GTQ");
    await move(id, "debit", 250n, "GTQ");

    const result = await balance(db, id);
    expect(result.currency).toBe("GTQ");
    expect(result.amount).toBe(250n);
  });

  it("nets many entries", async () => {
    const id = await makeAccount("netting", "asset", "USD");
    await move(id, "debit", 1000n);
    await move(id, "credit", 250n);
    await move(id, "debit", 75n);

    const result = await balance(db, id);
    expect(result.amount).toBe(825n);
  });

  it("throws for an unknown account", async () => {
    await expect(balance(db, crypto.randomUUID())).rejects.toThrow(AccountNotFoundError);
  });
});

describe("as-of-seq", () => {
  it("includes an entry at exactly that seq, and excludes the next", async () => {
    // The boundary is inclusive: asOfSeq is "as of and including".
    const id = await makeAccount("asof.boundary", "asset", "USD");

    const firstSeq = await move(id, "debit", 100n);
    const secondSeq = await move(id, "debit", 30n);

    // Exactly at the first entry's own seq: it counts.
    expect(await balance(db, id, { asOfSeq: firstSeq })).toMatchObject({ amount: 100n });
    // One below it: it does not. This pair is what makes <= distinguishable
    // from <.
    expect(await balance(db, id, { asOfSeq: firstSeq - 1n })).toMatchObject({ amount: 0n });
    // Exactly at the second entry's own seq: both count.
    expect(await balance(db, id, { asOfSeq: secondSeq })).toMatchObject({ amount: 130n });
    expect(await balance(db, id, { asOfSeq: secondSeq - 1n })).toMatchObject({ amount: 100n });
  });

  it("is zero before the account had any entries", async () => {
    const before = await latestEntrySeq();
    const id = await makeAccount("asof.zero", "asset", "USD");
    await move(id, "debit", 999n);

    const result = await balance(db, id, { asOfSeq: before });
    expect(result.amount).toBe(0n);
  });

  it("replays history step by step", async () => {
    const id = await makeAccount("asof.walk", "asset", "USD");
    const steps: { seq: bigint; expected: bigint }[] = [];
    let running = 0n;

    for (const amount of [10n, 20n, 30n, 40n]) {
      const seq = await move(id, "debit", amount);
      running += amount;
      steps.push({ seq, expected: running });
    }

    for (const step of steps) {
      const result = await balance(db, id, { asOfSeq: step.seq });
      expect(result.amount).toBe(step.expected);
    }
  });

  it("without asOfSeq equals the balance at the latest seq", async () => {
    const id = await makeAccount("asof.latest", "asset", "USD");
    await move(id, "debit", 42n);

    const live = await balance(db, id);
    const asOf = await balance(db, id, { asOfSeq: await latestEntrySeq() });
    expect(equals(live, asOf)).toBe(true);
  });
});

describe("trial balance", () => {
  it("nets to zero per currency", async () => {
    const result = await trialBalance(db);

    expect(result.totals.length).toBeGreaterThan(0);
    for (const total of result.totals) {
      expect(total.net.amount).toBe(0n);
    }
  });

  it("lists every account, including ones with no entries", async () => {
    const id = await makeAccount("tb.empty", "asset", "USD");
    const result = await trialBalance(db);

    const row = result.rows.find((r) => r.accountId === id);
    expect(row).toBeDefined();
    expect(row?.balance.amount).toBe(0n);
  });

  it("reports each row on its account's normal side", async () => {
    const asset = await makeAccount("tb.asset", "asset", "USD");
    const revenue = await makeAccount("tb.revenue", "revenue", "USD");
    await move(asset, "debit", 600n);
    await move(revenue, "credit", 600n);

    const result = await trialBalance(db);
    const assetRow = result.rows.find((r) => r.accountId === asset);
    const revenueRow = result.rows.find((r) => r.accountId === revenue);

    // Both are positive on their own normal side, despite opposite directions.
    expect(assetRow?.balance.amount).toBe(600n);
    expect(revenueRow?.balance.amount).toBe(600n);
  });

  it("agrees with balance() for every account it lists", async () => {
    const result = await trialBalance(db);

    for (const row of result.rows.slice(0, 12)) {
      const direct = await balance(db, row.accountId);
      expect(equals(direct, row.balance)).toBe(true);
    }
  });

  it("honours asOfSeq", async () => {
    const before = await latestEntrySeq();
    const id = await makeAccount("tb.asof", "asset", "USD");
    await move(id, "debit", 5000n);

    const historical = await trialBalance(db, { asOfSeq: before });
    const row = historical.rows.find((r) => r.accountId === id);
    expect(row?.balance.amount).toBe(0n);

    for (const total of historical.totals) {
      expect(total.net.amount).toBe(0n);
    }
  });
});

describe("properties", () => {
  it("balance at any seq equals the sum of entries up to that seq", async () => {
    const id = await makeAccount("prop.walk", "asset", "USD");

    const movesArb = fc.array(
      fc.record({
        direction: fc.constantFrom<"debit" | "credit">("debit", "credit"),
        amount: fc.bigInt({ min: 1n, max: 10n ** 6n }),
      }),
      { minLength: 1, maxLength: 6 },
    );

    await fc.assert(
      fc.asyncProperty(movesArb, async (moves) => {
        const checkpoints: { seq: bigint; expected: bigint }[] = [];
        let running = (await balance(db, id)).amount;

        for (const m of moves) {
          const seq = await move(id, m.direction, m.amount);
          running += m.direction === "debit" ? m.amount : -m.amount;
          checkpoints.push({ seq, expected: running });
        }

        for (const checkpoint of checkpoints) {
          const derived = await balance(db, id, { asOfSeq: checkpoint.seq });
          expect(derived.amount).toBe(checkpoint.expected);
        }
      }),
      { numRuns: 8 },
    );
  });

  it("the trial balance nets to zero after any random sequence", async () => {
    const pairs: { currency: Currency; account: string }[] = [
      { currency: "USD", account: await makeAccount("prop.tb.usd", "asset", "USD") },
      { currency: "GTQ", account: await makeAccount("prop.tb.gtq", "asset", "GTQ") },
    ];

    const postingArb = fc.record({
      which: fc.nat({ max: 1 }),
      direction: fc.constantFrom<"debit" | "credit">("debit", "credit"),
      amount: fc.bigInt({ min: 1n, max: 10n ** 6n }),
    });

    await fc.assert(
      fc.asyncProperty(fc.array(postingArb, { minLength: 1, maxLength: 5 }), async (postings) => {
        for (const p of postings) {
          const pair = pairs[p.which] ?? pairs[0];
          if (pair === undefined) continue;
          await move(pair.account, p.direction, p.amount, pair.currency);
        }

        const result = await trialBalance(db);
        for (const total of result.totals) {
          expect(total.net.amount).toBe(0n);
        }
      }),
      { numRuns: 8 },
    );
  });
});
