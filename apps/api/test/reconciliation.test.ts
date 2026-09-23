import { money } from "@raices/money";
import { sql, type Kysely } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "../src/db/schema.js";
import { post } from "../src/ledger/post.js";
import { reconcile } from "../src/reconciliation/reconcile.js";
import type { ReconciliationDatabase } from "../src/reconciliation/schema.js";
import {
  cleanStatement,
  syntheticStatement,
  type SyntheticStatement,
} from "../../../tests/fixtures/synthetic-statement.js";
import { startTestPostgres, type TestPostgres } from "../../../tests/pg.js";

/**
 * Reconciliation against real Postgres. The guarantees under test are
 * append-only tables, a unique input hash and a deferred ledger that must not
 * move; none of that exists in a mock.
 */

let pgx: TestPostgres;
/** Full schema, used only to seed the ledger and to count its rows. */
let seedDb: Kysely<Database>;
/** What reconciliation itself is handed: no ledger tables in the type. */
let reconDb: Kysely<ReconciliationDatabase>;

const runId = crypto.randomUUID().slice(0, 8);
let cashUsd: string;
let counterUsd: string;

async function ledgerRowCounts(): Promise<{
  accounts: number;
  transactions: number;
  entries: number;
}> {
  const r = await sql<{ accounts: number; transactions: number; entries: number }>`
    select (select count(*)::int from ledger_account)     as accounts,
           (select count(*)::int from ledger_transaction) as transactions,
           (select count(*)::int from ledger_entry)       as entries
  `.execute(seedDb);
  return r.rows[0] ?? { accounts: 0, transactions: 0, entries: 0 };
}

/** A real ledger transaction for expectations to point at. */
async function aLedgerTransaction(): Promise<string> {
  const result = await post(seedDb, {
    idempotencyKey: crypto.randomUUID(),
    description: "reconciliation fixture",
    occurredAt: new Date(),
    entries: [
      { accountId: cashUsd, direction: "debit", amount: money(1000n, "USD"), entryType: "recon" },
      {
        accountId: counterUsd,
        direction: "credit",
        amount: money(1000n, "USD"),
        entryType: "recon",
      },
    ],
  });
  return result.transactionId;
}

interface Loaded {
  readonly statement: SyntheticStatement;
  /** fixture key -> expected_settlement.id */
  readonly expectationIds: Map<string, string>;
  /** fixture key -> provider_statement_line.id */
  readonly lineIds: Map<string, string>;
}

async function load(statement: SyntheticStatement): Promise<Loaded> {
  const expectationIds = new Map<string, string>();
  const lineIds = new Map<string, string>();

  for (const expectation of statement.expectations) {
    const transactionId = await aLedgerTransaction();
    const row = await reconDb
      .insertInto("expected_settlement")
      .values({
        provider: statement.provider,
        provider_ref: expectation.providerRef,
        amount_minor: expectation.amountMinor,
        currency: expectation.currency,
        expected_state: expectation.expectedState,
        expected_by: new Date(statement.baseTime.getTime() + expectation.expectedByOffsetMs),
        ledger_transaction_id: transactionId,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    expectationIds.set(expectation.key, row.id);
  }

  for (const line of statement.lines) {
    const row = await reconDb
      .insertInto("provider_statement_line")
      .values({
        provider: statement.provider,
        statement_id: statement.statementId,
        line_ref: line.lineRef,
        provider_ref: line.providerRef,
        amount_minor: line.amountMinor,
        currency: line.currency,
        state: line.state,
        settled_at:
          line.settledAtOffsetMs === null
            ? null
            : new Date(statement.baseTime.getTime() + line.settledAtOffsetMs),
        raw: JSON.stringify(line.raw),
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    lineIds.set(line.key, row.id);
  }

  return { statement, expectationIds, lineIds };
}

beforeAll(async () => {
  pgx = await startTestPostgres();
  seedDb = pgx.kysely<Database>();
  reconDb = pgx.kysely<ReconciliationDatabase>();

  const cash = await seedDb
    .insertInto("ledger_account")
    .values({ code: `recon.cash.${runId}`, type: "asset", currency: "USD" })
    .returning("id")
    .executeTakeFirstOrThrow();
  const counter = await seedDb
    .insertInto("ledger_account")
    .values({ code: `recon.counter.${runId}`, type: "equity", currency: "USD" })
    .returning("id")
    .executeTakeFirstOrThrow();

  cashUsd = cash.id;
  counterUsd = counter.id;
});

afterAll(async () => {
  await pgx.stop();
});

describe("the synthetic statement", () => {
  it("yields exactly one discrepancy of each of the five kinds, and nothing else", async () => {
    const loaded = await load(syntheticStatement(crypto.randomUUID().slice(0, 8)));

    const result = await reconcile(reconDb, {
      provider: loaded.statement.provider,
      statementId: loaded.statement.statementId,
    });

    // Exactly five findings, one per kind.
    expect(result.discrepancies).toHaveLength(5);
    expect([...result.discrepancies].map((d) => d.kind).sort()).toEqual([
      "amount_mismatch",
      "missing",
      "state_mismatch",
      "timing",
      "unexpected",
    ]);

    // And each one points at the row the fixture says it should.
    for (const expected of loaded.statement.expectedFindings) {
      const found = result.discrepancies.filter((d) => d.kind === expected.kind);
      expect(found, `expected exactly one ${expected.kind}`).toHaveLength(1);
      const actual = found[0];

      expect(actual?.expectedId).toBe(
        expected.expectationKey === undefined
          ? null
          : (loaded.expectationIds.get(expected.expectationKey) ?? null),
      );
      expect(actual?.statementLineId).toBe(
        expected.lineKey === undefined ? null : (loaded.lineIds.get(expected.lineKey) ?? null),
      );
    }
  });

  it("says nothing about the pair that agrees", async () => {
    const loaded = await load(syntheticStatement(crypto.randomUUID().slice(0, 8)));
    const cleanExpectationId = loaded.expectationIds.get("clean");
    const cleanLineId = loaded.lineIds.get("clean");

    const result = await reconcile(reconDb, {
      provider: loaded.statement.provider,
      statementId: loaded.statement.statementId,
    });

    for (const discrepancy of result.discrepancies) {
      expect(discrepancy.expectedId).not.toBe(cleanExpectationId);
      expect(discrepancy.statementLineId).not.toBe(cleanLineId);
    }
  });

  it("records details for each finding", async () => {
    const loaded = await load(syntheticStatement(crypto.randomUUID().slice(0, 8)));
    const result = await reconcile(reconDb, {
      provider: loaded.statement.provider,
      statementId: loaded.statement.statementId,
    });

    const amount = result.discrepancies.find((d) => d.kind === "amount_mismatch");
    expect(amount?.details).toMatchObject({
      expectedAmountMinor: "50000",
      actualAmountMinor: "49999",
    });

    const timing = result.discrepancies.find((d) => d.kind === "timing");
    expect(timing?.details).toMatchObject({ lateByMs: 60 * 60 * 1000 });
  });
});

describe("a clean statement", () => {
  it("yields zero discrepancies", async () => {
    const loaded = await load(cleanStatement(crypto.randomUUID().slice(0, 8)));

    const result = await reconcile(reconDb, {
      provider: loaded.statement.provider,
      statementId: loaded.statement.statementId,
    });

    expect(result.discrepancies).toEqual([]);
    expect(result.replayed).toBe(false);
  });
});

describe("re-running", () => {
  it("is idempotent: the same run comes back and nothing new is written", async () => {
    const loaded = await load(syntheticStatement(crypto.randomUUID().slice(0, 8)));
    const request = {
      provider: loaded.statement.provider,
      statementId: loaded.statement.statementId,
    };

    const first = await reconcile(reconDb, request);
    expect(first.replayed).toBe(false);

    const before = await sql<{ runs: number; findings: number }>`
      select (select count(*)::int from reconciliation_run)           as runs,
             (select count(*)::int from reconciliation_discrepancy)   as findings
    `.execute(seedDb);

    const second = await reconcile(reconDb, request);

    const after = await sql<{ runs: number; findings: number }>`
      select (select count(*)::int from reconciliation_run)           as runs,
             (select count(*)::int from reconciliation_discrepancy)   as findings
    `.execute(seedDb);

    expect(second.replayed).toBe(true);
    expect(second.runId).toBe(first.runId);
    expect(second.inputHash).toBe(first.inputHash);
    expect(second.discrepancies).toHaveLength(first.discrepancies.length);
    expect(after.rows[0]).toEqual(before.rows[0]);
  });

  it("is a new run once the inputs change", async () => {
    const loaded = await load(syntheticStatement(crypto.randomUUID().slice(0, 8)));
    const request = {
      provider: loaded.statement.provider,
      statementId: loaded.statement.statementId,
    };

    const first = await reconcile(reconDb, request);

    // A new expectation changes what a comparison would conclude, so it must
    // change the hash rather than hand back the earlier findings.
    await reconDb
      .insertInto("expected_settlement")
      .values({
        provider: loaded.statement.provider,
        provider_ref: `added-${runId}-${crypto.randomUUID().slice(0, 6)}`,
        amount_minor: 4242n,
        currency: "USD",
        expected_state: "settled",
        expected_by: new Date(loaded.statement.baseTime.getTime() + 60 * 60 * 1000),
        ledger_transaction_id: await aLedgerTransaction(),
      })
      .execute();

    const second = await reconcile(reconDb, request);

    expect(second.replayed).toBe(false);
    expect(second.runId).not.toBe(first.runId);
    expect(second.inputHash).not.toBe(first.inputHash);
    // The added expectation has no matching line, so it is now missing too.
    expect(second.discrepancies.filter((d) => d.kind === "missing")).toHaveLength(2);
  });

  it("twenty concurrent runs over the same inputs write exactly one run", async () => {
    const loaded = await load(syntheticStatement(crypto.randomUUID().slice(0, 8)));
    const request = {
      provider: loaded.statement.provider,
      statementId: loaded.statement.statementId,
    };

    const results = await Promise.all(
      Array.from({ length: 20 }, () => reconcile(reconDb, request)),
    );

    expect(new Set(results.map((r) => r.runId)).size).toBe(1);
    for (const result of results) {
      expect(result.discrepancies).toHaveLength(5);
    }

    const count = await sql<{ n: number }>`
      select count(*)::int as n from reconciliation_run where input_hash = ${results[0]?.inputHash ?? ""}
    `.execute(seedDb);
    expect(count.rows[0]?.n).toBe(1);
  });
});

describe("the ledger is never written", () => {
  it("row counts are unchanged across a run that finds five discrepancies", async () => {
    const loaded = await load(syntheticStatement(crypto.randomUUID().slice(0, 8)));

    // Counted after loading, so only the reconcile() call is under test.
    const before = await ledgerRowCounts();

    const result = await reconcile(reconDb, {
      provider: loaded.statement.provider,
      statementId: loaded.statement.statementId,
    });
    expect(result.discrepancies).toHaveLength(5);

    expect(await ledgerRowCounts()).toEqual(before);
  });

  it("row counts are unchanged across a clean run and a replay", async () => {
    const loaded = await load(cleanStatement(crypto.randomUUID().slice(0, 8)));
    const request = {
      provider: loaded.statement.provider,
      statementId: loaded.statement.statementId,
    };

    const before = await ledgerRowCounts();
    await reconcile(reconDb, request);
    await reconcile(reconDb, request);
    expect(await ledgerRowCounts()).toEqual(before);
  });
});

describe("superseded expectations", () => {
  it("are not reported as missing", async () => {
    const provider = `mock-sup-${crypto.randomUUID().slice(0, 8)}`;
    const statementId = `stmt-sup-${runId}`;
    const providerRef = `ref-sup-${crypto.randomUUID().slice(0, 6)}`;
    const expectedBy = new Date("2026-09-23T01:00:00.000Z");

    const original = await reconDb
      .insertInto("expected_settlement")
      .values({
        provider,
        provider_ref: providerRef,
        amount_minor: 111n,
        currency: "USD",
        expected_state: "settled",
        expected_by: expectedBy,
        ledger_transaction_id: await aLedgerTransaction(),
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    // The revised expectation replaces it, and matches the statement.
    await reconDb
      .insertInto("expected_settlement")
      .values({
        provider,
        provider_ref: providerRef,
        amount_minor: 222n,
        currency: "USD",
        expected_state: "settled",
        expected_by: expectedBy,
        ledger_transaction_id: await aLedgerTransaction(),
        supersedes_id: original.id,
      })
      .execute();

    await reconDb
      .insertInto("provider_statement_line")
      .values({
        provider,
        statement_id: statementId,
        line_ref: "S-001",
        provider_ref: providerRef,
        amount_minor: 222n,
        currency: "USD",
        state: "settled",
        settled_at: new Date("2026-09-23T00:30:00.000Z"),
        raw: JSON.stringify({ line: "S-001" }),
      })
      .execute();

    const result = await reconcile(reconDb, { provider, statementId });

    // If the superseded row were still in force it would look missing, and
    // its old amount would look like a mismatch.
    expect(result.discrepancies).toEqual([]);
  });
});

describe("provider scoping", () => {
  it("one provider's expectations are not reported against another's statement", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const other = `mock-other-${suffix}`;

    await reconDb
      .insertInto("expected_settlement")
      .values({
        provider: other,
        provider_ref: `ref-other-${suffix}`,
        amount_minor: 999n,
        currency: "USD",
        expected_state: "settled",
        expected_by: new Date("2026-09-23T01:00:00.000Z"),
        ledger_transaction_id: await aLedgerTransaction(),
      })
      .execute();

    const loaded = await load(cleanStatement(suffix));
    const result = await reconcile(reconDb, {
      provider: loaded.statement.provider,
      statementId: loaded.statement.statementId,
    });

    // The other provider's dangling expectation is none of this run's business.
    expect(result.discrepancies).toEqual([]);
  });
});

/**
 * Cases the synthetic fixture deliberately does not carry: it has to yield
 * exactly one discrepancy of each kind, so anything that produces zero or
 * two belongs here instead.
 */
describe("comparison edge cases", () => {
  interface Scenario {
    readonly expectedAmount: bigint;
    readonly expectedCurrency: "USD" | "GTQ";
    readonly expectedState: string;
    readonly expectedBy: Date;
    readonly lineAmount: bigint;
    readonly lineCurrency: "USD" | "GTQ";
    readonly lineState: string;
    readonly settledAt: Date | null;
  }

  const BASE = new Date("2026-09-23T00:00:00.000Z");
  const DUE = new Date("2026-09-23T01:00:00.000Z");

  async function runScenario(scenario: Scenario) {
    const suffix = crypto.randomUUID().slice(0, 8);
    const provider = `mock-edge-${suffix}`;
    const statementId = `stmt-edge-${suffix}`;
    const providerRef = `ref-edge-${suffix}`;

    await reconDb
      .insertInto("expected_settlement")
      .values({
        provider,
        provider_ref: providerRef,
        amount_minor: scenario.expectedAmount,
        currency: scenario.expectedCurrency,
        expected_state: scenario.expectedState,
        expected_by: scenario.expectedBy,
        ledger_transaction_id: await aLedgerTransaction(),
      })
      .execute();

    await reconDb
      .insertInto("provider_statement_line")
      .values({
        provider,
        statement_id: statementId,
        line_ref: "E-001",
        provider_ref: providerRef,
        amount_minor: scenario.lineAmount,
        currency: scenario.lineCurrency,
        state: scenario.lineState,
        settled_at: scenario.settledAt,
        raw: JSON.stringify({ line: "E-001" }),
      })
      .execute();

    return reconcile(reconDb, { provider, statementId });
  }

  const agreeing = {
    expectedAmount: 1_000n,
    expectedCurrency: "USD",
    expectedState: "settled",
    expectedBy: DUE,
    lineAmount: 1_000n,
    lineCurrency: "USD",
    lineState: "settled",
    settledAt: new Date(BASE.getTime() + 30 * 60 * 1000),
  } as const satisfies Scenario;

  it("a line that has not settled is not late", async () => {
    // Not settled is a state question, not a timing one. Treating a null
    // settled_at as late would report timing on everything still in flight.
    const result = await runScenario({ ...agreeing, settledAt: null });
    expect(result.discrepancies.map((d) => d.kind)).toEqual([]);
  });

  it("settling exactly at expected_by is on time", async () => {
    // The deadline is inclusive: at expected_by is met, one millisecond
    // after is not.
    const onTheDot = await runScenario({ ...agreeing, settledAt: DUE });
    expect(onTheDot.discrepancies.map((d) => d.kind)).toEqual([]);

    const justLate = await runScenario({
      ...agreeing,
      settledAt: new Date(DUE.getTime() + 1),
    });
    expect(justLate.discrepancies.map((d) => d.kind)).toEqual(["timing"]);
  });

  it("the same number in a different currency is an amount mismatch", async () => {
    const result = await runScenario({
      ...agreeing,
      expectedCurrency: "USD",
      lineCurrency: "GTQ",
    });
    expect(result.discrepancies.map((d) => d.kind)).toEqual(["amount_mismatch"]);
    expect(result.discrepancies[0]?.details).toMatchObject({
      expectedCurrency: "USD",
      actualCurrency: "GTQ",
    });
  });

  it("a pair that is wrong in several ways reports every one of them", async () => {
    // Suppressing the later findings because an earlier one fired would hide
    // real disagreement.
    const result = await runScenario({
      ...agreeing,
      lineAmount: 999n,
      lineState: "pending",
      settledAt: new Date(DUE.getTime() + 60 * 60 * 1000),
    });

    expect([...result.discrepancies].map((d) => d.kind).sort()).toEqual([
      "amount_mismatch",
      "state_mismatch",
      "timing",
    ]);
  });

  it("only the requested statement's lines are considered", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const provider = `mock-two-${suffix}`;
    const providerRef = `ref-two-${suffix}`;

    await reconDb
      .insertInto("expected_settlement")
      .values({
        provider,
        provider_ref: providerRef,
        amount_minor: 500n,
        currency: "USD",
        expected_state: "settled",
        expected_by: DUE,
        ledger_transaction_id: await aLedgerTransaction(),
      })
      .execute();

    // The matching line lives in a different statement.
    await reconDb
      .insertInto("provider_statement_line")
      .values({
        provider,
        statement_id: `stmt-other-${suffix}`,
        line_ref: "O-001",
        provider_ref: providerRef,
        amount_minor: 500n,
        currency: "USD",
        state: "settled",
        settled_at: new Date(BASE.getTime() + 30 * 60 * 1000),
        raw: JSON.stringify({ line: "O-001" }),
      })
      .execute();

    const result = await reconcile(reconDb, {
      provider,
      statementId: `stmt-empty-${suffix}`,
    });

    // Reading across statements would match it and report nothing.
    expect(result.discrepancies.map((d) => d.kind)).toEqual(["missing"]);
  });
});

describe("append-only storage", () => {
  it("refuses UPDATE and DELETE on the reconciliation tables", async () => {
    const client = new pg.Client({ connectionString: pgx.connectionString });
    await client.connect();
    try {
      for (const table of [
        "expected_settlement",
        "provider_statement_line",
        "reconciliation_discrepancy",
      ]) {
        for (const statement of [
          `update ${table} set created_at = now()`,
          `delete from ${table}`,
          `truncate ${table} cascade`,
        ]) {
          let code: string | undefined;
          try {
            await client.query(statement);
          } catch (error) {
            code = (error as { code?: string }).code;
          }
          expect(code, `${statement} must be refused`).toBe("LG001");
        }
      }
    } finally {
      await client.end();
    }
  });

  it("allows a run to be stamped finished, but nothing else", async () => {
    const client = new pg.Client({ connectionString: pgx.connectionString });
    await client.connect();
    try {
      const run = await client.query<{ id: string }>(
        "select id from reconciliation_run order by seq desc limit 1",
      );
      const id = run.rows[0]?.id;
      expect(id).toBeDefined();

      await expect(
        client.query(`update reconciliation_run set finished_at = now() where id = $1`, [id]),
      ).resolves.toBeDefined();

      let code: string | undefined;
      try {
        await client.query(`update reconciliation_run set provider = 'tampered' where id = $1`, [
          id,
        ]);
      } catch (error) {
        code = (error as { code?: string }).code;
      }
      expect(code).toBe("LG001");
    } finally {
      await client.end();
    }
  });
});
