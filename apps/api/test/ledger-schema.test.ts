import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SUPPORTED_CURRENCIES } from "@raices/money";

import { startTestPostgres, type TestPostgres } from "../../../tests/pg.js";

/**
 * Every assertion here runs against a real Postgres 16 (Testcontainers in CI).
 * The guards under test are database triggers, grants and constraints; a mock
 * would assert nothing about whether they exist.
 *
 * Each guard is proven by attempting the forbidden operation and requiring it
 * to fail, never by assuming the trigger fired.
 */

const LEDGER_TABLES = ["ledger_account", "ledger_transaction", "ledger_entry"] as const;

/** SQLSTATEs the migration raises, plus the standard ones it relies on. */
const APPEND_ONLY_VIOLATION = "LG001";
const UNBALANCED_TRANSACTION = "LG002";
const TOO_FEW_ENTRIES = "LG003";
const INSUFFICIENT_PRIVILEGE = "42501";
const FOREIGN_KEY_VIOLATION = "23503";
const CHECK_VIOLATION = "23514";
const UNIQUE_VIOLATION = "23505";

interface PostgresError extends Error {
  readonly code?: string;
}

function errorCode(error: unknown): string | undefined {
  return (error as PostgresError | undefined)?.code;
}

let pgx: TestPostgres;

/** A dedicated connection, so BEGIN/COMMIT and SET ROLE stay on one session. */
async function withClient<T>(
  fn: (client: pg.Client) => Promise<T>,
  options: { role?: string } = {},
): Promise<T> {
  const client = new pg.Client({ connectionString: pgx.connectionString });
  await client.connect();
  try {
    if (options.role !== undefined) {
      await client.query(`set role ${options.role}`);
    }
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** Run `sql` and return the SQLSTATE it fails with, or undefined if it succeeds. */
async function failureCode(
  sql: string,
  options: { role?: string } = {},
): Promise<string | undefined> {
  return withClient(async (client) => {
    try {
      await client.query(sql);
      return undefined;
    } catch (error) {
      return errorCode(error);
    }
  }, options);
}

async function createAccount(code: string, type: string, currency: string): Promise<string> {
  return withClient(async (client) => {
    const result = await client.query<{ id: string }>(
      `insert into ledger_account (code, type, currency) values ($1, $2, $3) returning id`,
      [code, type, currency],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error("account insert returned nothing");
    return row.id;
  });
}

interface EntrySpec {
  accountId: string;
  direction: "debit" | "credit";
  amountMinor: bigint;
  currency: string;
  entryType?: string;
}

/**
 * Insert a transaction plus its entries inside one explicit transaction and
 * commit. Returns the transaction id, or throws with the SQLSTATE that the
 * deferred constraint raised at COMMIT.
 */
async function postTransaction(entries: EntrySpec[], key = crypto.randomUUID()): Promise<string> {
  return withClient(async (client) => {
    await client.query("begin");
    try {
      const tx = await client.query<{ id: string }>(
        `insert into ledger_transaction (idempotency_key, request_hash, description, occurred_at)
         values ($1, $2, $3, now()) returning id`,
        [key, "hash-".concat(key), "test posting"],
      );
      const transactionId = tx.rows[0]?.id;
      if (transactionId === undefined) throw new Error("transaction insert returned nothing");

      for (const entry of entries) {
        await client.query(
          `insert into ledger_entry
             (transaction_id, account_id, direction, amount_minor, currency, entry_type)
           values ($1, $2, $3, $4, $5, $6)`,
          [
            transactionId,
            entry.accountId,
            entry.direction,
            entry.amountMinor.toString(),
            entry.currency,
            entry.entryType ?? "test",
          ],
        );
      }

      await client.query("commit");
      return transactionId;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    }
  });
}

/**
 * Fixtures are scoped to this run. A container is fresh every time, but the
 * TEST_DATABASE_URL escape hatch points at a database that persists between
 * runs, and fixed codes would collide with the previous run's rows.
 */
const runId = crypto.randomUUID().slice(0, 8);
const accountCode = (name: string) => `${name}.${runId}`;

let cashUsd: string;
let revenueUsd: string;
let cashGtq: string;
let revenueGtq: string;
let seededTransaction: string;

/**
 * Counts scoped to this run's own accounts.
 *
 * "Writes nothing" is the claim under test. A global count also moves when
 * another test file shares the database, which is what happens locally via
 * TEST_DATABASE_URL, where vitest runs files in parallel. In CI each file
 * gets its own container, so this only ever bit the local `make verify`.
 */
function ourAccounts(): string[] {
  return [cashUsd, revenueUsd, cashGtq, revenueGtq];
}

async function ourEntryCount(): Promise<number> {
  return withClient(async (client) => {
    const r = await client.query<{ n: number }>(
      "select count(*)::int as n from ledger_entry where account_id = any($1::uuid[])",
      [ourAccounts()],
    );
    return r.rows[0]?.n ?? 0;
  });
}

async function ourTransactionCount(): Promise<number> {
  return withClient(async (client) => {
    const r = await client.query<{ n: number }>(
      `select count(distinct transaction_id)::int as n
         from ledger_entry where account_id = any($1::uuid[])`,
      [ourAccounts()],
    );
    return r.rows[0]?.n ?? 0;
  });
}

beforeAll(async () => {
  pgx = await startTestPostgres();

  cashUsd = await createAccount(accountCode("cash.usd"), "asset", "USD");
  revenueUsd = await createAccount(accountCode("revenue.usd"), "revenue", "USD");
  cashGtq = await createAccount(accountCode("cash.gtq"), "asset", "GTQ");
  revenueGtq = await createAccount(accountCode("revenue.gtq"), "revenue", "GTQ");

  seededTransaction = await postTransaction([
    { accountId: cashUsd, direction: "debit", amountMinor: 1000n, currency: "USD" },
    { accountId: revenueUsd, direction: "credit", amountMinor: 1000n, currency: "USD" },
  ]);
});

afterAll(async () => {
  await pgx.stop();
});

describe("append-only enforcement", () => {
  // The owner is stopped by the trigger; the app role is stopped earlier, by
  // the missing grant. Both must fail, and for the stated reason.
  describe.each(LEDGER_TABLES)("%s", (table) => {
    it("rejects UPDATE as the owner", async () => {
      const code = await failureCode(`update ${table} set created_at = now()`);
      expect(code).toBe(APPEND_ONLY_VIOLATION);
    });

    it("rejects UPDATE as the app role", async () => {
      const code = await failureCode(`update ${table} set created_at = now()`, { role: "app" });
      expect(code).toBe(INSUFFICIENT_PRIVILEGE);
    });

    it("rejects DELETE as the owner", async () => {
      const code = await failureCode(`delete from ${table}`);
      expect(code).toBe(APPEND_ONLY_VIOLATION);
    });

    it("rejects DELETE as the app role", async () => {
      const code = await failureCode(`delete from ${table}`, { role: "app" });
      expect(code).toBe(INSUFFICIENT_PRIVILEGE);
    });

    it("rejects TRUNCATE as the owner", async () => {
      const code = await failureCode(`truncate ${table} cascade`);
      expect(code).toBe(APPEND_ONLY_VIOLATION);
    });

    it("rejects TRUNCATE as the app role", async () => {
      const code = await failureCode(`truncate ${table} cascade`, { role: "app" });
      expect(code).toBe(INSUFFICIENT_PRIVILEGE);
    });

    it("rejects DELETE even when it would match no rows", async () => {
      // A row-level trigger never fires on a statement that matches nothing,
      // so this is what distinguishes a statement-level guard from one that
      // only protects tables that happen to be non-empty.
      const code = await failureCode(`delete from ${table} where false`);
      expect(code).toBe(APPEND_ONLY_VIOLATION);
    });

    it("rejects UPDATE even when it would match no rows", async () => {
      const code = await failureCode(`update ${table} set created_at = now() where false`);
      expect(code).toBe(APPEND_ONLY_VIOLATION);
    });
  });

  it("leaves every row intact after all of those attempts", async () => {
    const counts = await withClient(async (client) => {
      const result = await client.query<{
        accounts: number;
        transactions: number;
        entries: number;
      }>(
        `select (select count(*)::int from ledger_account)     as accounts,
                (select count(*)::int from ledger_transaction) as transactions,
                (select count(*)::int from ledger_entry)       as entries`,
      );
      return result.rows[0];
    });

    expect(counts?.accounts).toBeGreaterThanOrEqual(4);
    expect(counts?.transactions).toBeGreaterThanOrEqual(1);
    expect(counts?.entries).toBeGreaterThanOrEqual(2);
  });

  it("still allows the app role to INSERT and SELECT", async () => {
    const code = await failureCode(
      `insert into ledger_account (code, type, currency)
       values ('app.inserted.${crypto.randomUUID()}', 'asset', 'USD')`,
      { role: "app" },
    );
    expect(code).toBeUndefined();

    const selectCode = await failureCode("select count(*) from ledger_entry", { role: "app" });
    expect(selectCode).toBeUndefined();
  });
});

describe("balance enforced at the database, at commit", () => {
  it("accepts a balanced two-entry transaction", async () => {
    const id = await postTransaction([
      { accountId: cashUsd, direction: "debit", amountMinor: 250n, currency: "USD" },
      { accountId: revenueUsd, direction: "credit", amountMinor: 250n, currency: "USD" },
    ]);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("rejects an unbalanced transaction at COMMIT", async () => {
    await expect(
      postTransaction([
        { accountId: cashUsd, direction: "debit", amountMinor: 1000n, currency: "USD" },
        { accountId: revenueUsd, direction: "credit", amountMinor: 999n, currency: "USD" },
      ]),
    ).rejects.toMatchObject({ code: UNBALANCED_TRANSACTION });
  });

  it("rejects a transaction with a single entry", async () => {
    await expect(
      postTransaction([
        { accountId: cashUsd, direction: "debit", amountMinor: 1000n, currency: "USD" },
      ]),
    ).rejects.toMatchObject({ code: TOO_FEW_ENTRIES });
  });

  it("balances per currency, not in aggregate", async () => {
    // Debit 1000 USD against a credit of 1000 GTQ nets to zero only if the
    // currencies are wrongly pooled. Per currency, neither side balances.
    await expect(
      postTransaction([
        { accountId: cashUsd, direction: "debit", amountMinor: 1000n, currency: "USD" },
        { accountId: revenueGtq, direction: "credit", amountMinor: 1000n, currency: "GTQ" },
      ]),
    ).rejects.toMatchObject({ code: UNBALANCED_TRANSACTION });
  });

  it("accepts a transaction balanced independently in two currencies", async () => {
    const id = await postTransaction([
      { accountId: cashUsd, direction: "debit", amountMinor: 1000n, currency: "USD" },
      { accountId: revenueUsd, direction: "credit", amountMinor: 1000n, currency: "USD" },
      { accountId: cashGtq, direction: "debit", amountMinor: 500n, currency: "GTQ" },
      { accountId: revenueGtq, direction: "credit", amountMinor: 500n, currency: "GTQ" },
    ]);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("writes nothing when the commit is rejected", async () => {
    const before = await ourEntryCount();

    await expect(
      postTransaction([
        { accountId: cashUsd, direction: "debit", amountMinor: 7n, currency: "USD" },
        { accountId: revenueUsd, direction: "credit", amountMinor: 8n, currency: "USD" },
      ]),
    ).rejects.toThrow();

    const after = await ourEntryCount();

    expect(after).toBe(before);
  });
});

describe("entry currency must match its account", () => {
  it("rejects an entry whose currency differs from the account currency", async () => {
    await expect(
      postTransaction([
        // cashUsd is a USD account; claiming GTQ here must not be storable.
        { accountId: cashUsd, direction: "debit", amountMinor: 1000n, currency: "GTQ" },
        { accountId: revenueGtq, direction: "credit", amountMinor: 1000n, currency: "GTQ" },
      ]),
    ).rejects.toMatchObject({ code: FOREIGN_KEY_VIOLATION });
  });
});

describe("column constraints", () => {
  it("rejects a non-positive amount", async () => {
    for (const amount of ["0", "-1"]) {
      const code = await failureCode(
        `insert into ledger_entry (transaction_id, account_id, direction, amount_minor, currency, entry_type)
         values ('${seededTransaction}', '${cashUsd}', 'debit', ${amount}, 'USD', 'test')`,
      );
      expect(code).toBe(CHECK_VIOLATION);
    }
  });

  it("rejects an unknown direction", async () => {
    const code = await failureCode(
      `insert into ledger_entry (transaction_id, account_id, direction, amount_minor, currency, entry_type)
       values ('${seededTransaction}', '${cashUsd}', 'sideways', 1, 'USD', 'test')`,
    );
    expect(code).toBe(CHECK_VIOLATION);
  });

  it("rejects an unknown account type", async () => {
    const code = await failureCode(
      `insert into ledger_account (code, type, currency) values ('bad.${crypto.randomUUID()}', 'slush', 'USD')`,
    );
    expect(code).toBe(CHECK_VIOLATION);
  });

  it("rejects a duplicate idempotency key", async () => {
    const key = crypto.randomUUID();
    await postTransaction(
      [
        { accountId: cashUsd, direction: "debit", amountMinor: 10n, currency: "USD" },
        { accountId: revenueUsd, direction: "credit", amountMinor: 10n, currency: "USD" },
      ],
      key,
    );

    await expect(
      postTransaction(
        [
          { accountId: cashUsd, direction: "debit", amountMinor: 10n, currency: "USD" },
          { accountId: revenueUsd, direction: "credit", amountMinor: 10n, currency: "USD" },
        ],
        key,
      ),
    ).rejects.toMatchObject({ code: UNIQUE_VIOLATION });
  });

  it("rejects a duplicate account code", async () => {
    const code = await failureCode(
      `insert into ledger_account (code, type, currency)
       values ('${accountCode("cash.usd")}', 'asset', 'USD')`,
    );
    expect(code).toBe(UNIQUE_VIOLATION);
  });
});

describe("a transaction must have entries", () => {
  it("rejects a transaction with no entries at all, at COMMIT", async () => {
    // The balance trigger hangs off ledger_entry, so with zero entries it
    // never fires. Without a guard on ledger_transaction itself an orphaned
    // transaction row would be perfectly legal.
    const code = await withClient(async (client) => {
      await client.query("begin");
      try {
        await client.query(
          `insert into ledger_transaction (idempotency_key, request_hash, description, occurred_at)
           values ($1, 'hash', 'orphan', now())`,
          [crypto.randomUUID()],
        );
        await client.query("commit");
        return undefined;
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        return errorCode(error);
      }
    });

    expect(code).toBe(TOO_FEW_ENTRIES);
  });

  it("writes no transaction row when that commit is rejected", async () => {
    const before = await ourTransactionCount();

    await withClient(async (client) => {
      await client.query("begin");
      try {
        await client.query(
          `insert into ledger_transaction (idempotency_key, request_hash, description, occurred_at)
           values ($1, 'hash', 'orphan', now())`,
          [crypto.randomUUID()],
        );
        await client.query("commit");
      } catch {
        await client.query("rollback").catch(() => undefined);
      }
    });

    const after = await ourTransactionCount();

    expect(after).toBe(before);
  });
});

describe("currency is restricted to what packages/money supports", () => {
  it.each([["EUR"], ["XYZ"], ["   "], ["usd"]])("rejects an account in %p", async (currency) => {
    const code = await failureCode(
      `insert into ledger_account (code, type, currency)
         values ('bad.${crypto.randomUUID()}', 'asset', '${currency}')`,
    );
    expect(code).toBe(CHECK_VIOLATION);
  });

  it("rejects an entry in an unsupported currency", async () => {
    const code = await failureCode(
      `insert into ledger_entry (transaction_id, account_id, direction, amount_minor, currency, entry_type)
       values ('${seededTransaction}', '${cashUsd}', 'debit', 1, 'EUR', 'test')`,
    );
    // The CHECK is evaluated as the row is formed, before the composite
    // foreign key's after-row trigger, so this is the check speaking.
    expect(code).toBe(CHECK_VIOLATION);
  });

  it.each(SUPPORTED_CURRENCIES)("accepts %s, which packages/money supports", async (currency) => {
    const code = await failureCode(
      `insert into ledger_account (code, type, currency)
       values ('ok.${currency}.${crypto.randomUUID()}', 'asset', '${currency}')`,
    );
    expect(code).toBeUndefined();
  });

  it("stays in sync with packages/money", async () => {
    // A currency added to the union but not to the migration would be
    // accepted by the type system and rejected by the database.
    const definitions = await withClient(async (client) => {
      const r = await client.query<{ definition: string }>(
        `select pg_get_constraintdef(oid) as definition
         from pg_constraint
         where conname in ('ledger_account_currency_supported', 'ledger_entry_currency_supported')`,
      );
      return r.rows.map((row) => row.definition);
    });

    expect(definitions).toHaveLength(2);
    for (const definition of definitions) {
      for (const currency of SUPPORTED_CURRENCIES) {
        expect(definition).toContain(currency);
      }
      // Nothing beyond the supported set is listed.
      const listed = [...definition.matchAll(/'([A-Za-z ]{3})'/g)].map((m) => m[1]);
      expect(new Set(listed)).toEqual(new Set(SUPPORTED_CURRENCIES));
    }
  });
});

describe("entries are queryable", () => {
  it("by transaction", async () => {
    const rows = await withClient(async (client) => {
      const r = await client.query<{ direction: string; amount_minor: string }>(
        `select direction, amount_minor::text from ledger_entry
         where transaction_id = $1 order by seq`,
        [seededTransaction],
      );
      return r.rows;
    });

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.direction)).toEqual(["debit", "credit"]);
    expect(rows.every((row) => row.amount_minor === "1000")).toBe(true);
  });

  it("by account, ordered by seq", async () => {
    const rows = await withClient(async (client) => {
      // The cast is aliased: naming the output column `seq` would make
      // ORDER BY resolve to the text column and sort 10 before 3.
      const r = await client.query<{ seq_text: string }>(
        `select seq::text as seq_text from ledger_entry where account_id = $1 order by seq`,
        [cashUsd],
      );
      return r.rows;
    });

    expect(rows.length).toBeGreaterThanOrEqual(2);
    const seqs = rows.map((row) => BigInt(row.seq_text));
    expect([...seqs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))).toEqual(seqs);
  });

  it("has the indexes the ticket names", async () => {
    const indexes = await withClient(async (client) => {
      const r = await client.query<{ indexdef: string }>(
        `select indexdef from pg_indexes where tablename = 'ledger_entry'`,
      );
      return r.rows.map((row) => row.indexdef);
    });

    expect(indexes.some((def) => /\(transaction_id\)/.test(def))).toBe(true);
    expect(indexes.some((def) => /\(account_id, seq\)/.test(def))).toBe(true);
  });
});
