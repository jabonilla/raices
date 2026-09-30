import { money } from "@raices/money";
import fc from "fast-check";
import type { Kysely } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { Database } from "../../apps/api/src/db/schema.js";
import { balance, trialBalance } from "../../apps/api/src/ledger/balance.js";
import {
  IdempotencyConflictError,
  post,
  type PostRequest,
} from "../../apps/api/src/ledger/post.js";
import { startTestPostgres, type TestPostgres } from "../pg.js";

let server: TestPostgres;
let db: Kysely<Database>;
let pool: pg.Pool;
const pairs: Record<"USD" | "GTQ", { debit: string; credit: string }> = {
  USD: { debit: "", credit: "" },
  GTQ: { debit: "", credit: "" },
};
beforeAll(async () => {
  server = await startTestPostgres();
  db = server.kysely<Database>();
  pool = new pg.Pool({ connectionString: server.connectionString });
  for (const currency of ["USD", "GTQ"] as const) {
    const debit = await db
      .insertInto("ledger_account")
      .values({ code: `redteam.asset.${currency}`, type: "asset", currency })
      .returning("id")
      .executeTakeFirstOrThrow();
    const credit = await db
      .insertInto("ledger_account")
      .values({ code: `redteam.liability.${currency}`, type: "liability", currency })
      .returning("id")
      .executeTakeFirstOrThrow();
    pairs[currency] = { debit: debit.id, credit: credit.id };
  }
});
afterAll(async () => {
  await pool.end();
  await server.stop();
});
function request(amount: bigint, currency: "USD" | "GTQ", key = crypto.randomUUID()): PostRequest {
  const pair = pairs[currency];
  return {
    idempotencyKey: key,
    description: "redteam",
    occurredAt: new Date("2026-09-29T00:00:00Z"),
    entries: [
      {
        accountId: pair.debit,
        direction: "debit",
        amount: money(amount, currency),
        entryType: "redteam",
      },
      {
        accountId: pair.credit,
        direction: "credit",
        amount: money(amount, currency),
        entryType: "redteam",
      },
    ],
  };
}

it("races conflicting payloads and reordered replays without duplicate transactions", async () => {
  await fc.assert(
    fc.asyncProperty(fc.bigInt({ min: 1n, max: 2n ** 63n - 2n }), async (amount) => {
      const key = crypto.randomUUID();
      const a = request(amount, "USD", key);
      const b = request(amount + 1n, "USD", key);
      const results = await Promise.allSettled(
        Array.from({ length: 8 }, (_, index) => post(db, index % 2 === 0 ? a : b)),
      );
      const successes = results.filter((r) => r.status === "fulfilled");
      expect(successes).toHaveLength(4);
      expect(new Set(successes.map((r) => r.value.transactionId)).size).toBe(1);
      for (const result of results)
        if (result.status === "rejected")
          expect(result.reason).toBeInstanceOf(IdempotencyConflictError);
      const stored = await pool.query<{ amount_minor: string }>(
        "select e.amount_minor from ledger_entry e join ledger_transaction t on t.id=e.transaction_id where t.idempotency_key=$1 limit 1",
        [key],
      );
      const winner = stored.rows[0]?.amount_minor === amount.toString() ? a : b;
      expect((await post(db, { ...winner, entries: [...winner.entries].reverse() })).replayed).toBe(
        true,
      );
    }),
    { numRuns: 10, seed: 3104 },
  );
});

it("fuzzes historical balance against raw entry sums at exact entry seq boundaries", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(
        fc.record({
          currency: fc.constantFrom("USD", "GTQ"),
          amount: fc.bigInt({ min: 1n, max: 2n ** 63n - 1n }),
        }),
        { minLength: 1, maxLength: 6 },
      ),
      async (items) => {
        for (const item of items) {
          const result = await post(db, request(item.amount, item.currency));
          const seqs = await pool.query<{ seq: string }>(
            "select seq from ledger_entry where transaction_id=$1 order by seq",
            [result.transactionId],
          );
          for (const row of seqs.rows) {
            const seq = BigInt(row.seq);
            for (const currency of ["USD", "GTQ"] as const) {
              const pair = pairs[currency];
              const raw = await pool.query<{ net: string }>(
                "select coalesce(sum(case when direction='debit' then amount_minor else -amount_minor end),0)::text as net from ledger_entry where account_id=$1 and seq<=$2",
                [pair.debit, seq.toString()],
              );
              expect((await balance(db, pair.debit, { asOfSeq: seq })).amount).toBe(
                BigInt(raw.rows[0]?.net ?? "0"),
              );
            }
          }
        }
        expect((await trialBalance(db)).totals.every((total) => total.net.amount === 0n)).toBe(
          true,
        );
      },
    ),
    { numRuns: 10, seed: 3105 },
  );
});

it("rejects UPDATE, DELETE and TRUNCATE CASCADE on ledger and audit as owner and app", async () => {
  for (const role of ["owner", "app"])
    for (const table of ["ledger_account", "ledger_transaction", "ledger_entry", "audit_log"]) {
      for (const statement of [
        `update ${table} set id=id where false`,
        `delete from ${table} where false`,
        `truncate ${table} cascade`,
      ]) {
        const client = await pool.connect();
        try {
          await client.query("begin");
          if (role === "app") await client.query("set local role app");
          await expect(client.query(statement)).rejects.toMatchObject({
            code: role === "app" ? "42501" : table === "audit_log" ? "AU001" : "LG001",
          });
        } finally {
          await client.query("rollback");
          client.release();
        }
      }
    }
});

it("rejects attempts to balance across currencies", async () => {
  const input = request(10n, "USD");
  const [debit, credit] = input.entries;
  if (debit === undefined || credit === undefined) throw new Error("Missing test legs");
  await expect(
    post(db, {
      ...input,
      entries: [debit, { ...credit, accountId: pairs.GTQ.credit, amount: money(10n, "GTQ") }],
    }),
  ).rejects.toMatchObject({ name: "UnbalancedPostingError" });
});

// Deliberately failing regression: a committed posting must not gain new legs.
// Keep this assertion intact and report the bug; the ledger owner fixes it.
it("refuses extra balanced legs on an already committed transaction", async () => {
  const original = await post(db, request(17n, "GTQ"));
  const client = await pool.connect();
  try {
    await client.query("begin isolation level serializable");
    await client.query("set local role app");
    let failure: unknown;
    try {
      await client.query(
        "insert into ledger_entry(transaction_id,account_id,direction,amount_minor,currency,entry_type) values ($1,$2,'debit',19,'GTQ','redteam'),($1,$3,'credit',19,'GTQ','redteam')",
        [original.transactionId, pairs.GTQ.debit, pairs.GTQ.credit],
      );
      await client.query("set constraints all immediate");
    } catch (error) {
      failure = error;
    }
    expect(failure, "app can append balanced legs to a previously committed posting").toBeDefined();
  } finally {
    await client.query("rollback");
    client.release();
  }
});
